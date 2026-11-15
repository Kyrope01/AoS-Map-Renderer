import * as THREE from 'three';
import { RegionBounds, VoxelFormat, VoxelGrid } from './types';
import { VxlGrid } from './vxlParser';

export interface BuiltVoxelMesh {
  geometry: THREE.BufferGeometry;
  format: VoxelFormat;
  waterColorHex: string | null;
  quadCount: number;
  triangleCount: number;
  center: THREE.Vector3;
  size: THREE.Vector3;
}

interface FaceDef {
  axis: 0 | 1 | 2;       // 0=X, 1=Y, 2=Z
  dir: 1 | -1;
  uAxis: 0 | 1 | 2;
  vAxis: 0 | 1 | 2;
  normal: readonly [number, number, number];
  ccw: boolean;
}

function isFaceCcw(
  axis: 0 | 1 | 2,
  uAxis: 0 | 1 | 2,
  vAxis: 0 | 1 | 2,
  normal: readonly [number, number, number],
): boolean {
  const u = [0, 0, 0];
  const v = [0, 0, 0];
  u[uAxis] = 1;
  v[vAxis] = 1;
  const cx = u[1] * v[2] - u[2] * v[1];
  const cy = u[2] * v[0] - u[0] * v[2];
  const cz = u[0] * v[1] - u[1] * v[0];
  void axis;
  return cx * normal[0] + cy * normal[1] + cz * normal[2] > 0;
}

const FACES: FaceDef[] = [
  { axis: 1, dir: 1, uAxis: 0, vAxis: 2, normal: [0, 1, 0], ccw: isFaceCcw(1, 0, 2, [0, 1, 0]) },
  { axis: 1, dir: -1, uAxis: 0, vAxis: 2, normal: [0, -1, 0], ccw: isFaceCcw(1, 0, 2, [0, -1, 0]) },
  { axis: 0, dir: 1, uAxis: 2, vAxis: 1, normal: [1, 0, 0], ccw: isFaceCcw(0, 2, 1, [1, 0, 0]) },
  { axis: 0, dir: -1, uAxis: 2, vAxis: 1, normal: [-1, 0, 0], ccw: isFaceCcw(0, 2, 1, [-1, 0, 0]) },
  { axis: 2, dir: 1, uAxis: 0, vAxis: 1, normal: [0, 0, 1], ccw: isFaceCcw(2, 0, 1, [0, 0, 1]) },
  { axis: 2, dir: -1, uAxis: 0, vAxis: 1, normal: [0, 0, -1], ccw: isFaceCcw(2, 0, 1, [0, 0, -1]) },
];

/** Fast 4-corner voxel ambient occlusion (0..3 -> 0.42..1.0). */
function cornerAo(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0));
}

const AO_LUT = new Float32Array([0.42, 0.64, 0.83, 1.0]);

/**
 * Converts a 0..255 sRGB channel to linear RGB for Three.js vertex colors.
 */
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

const SRGB_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  SRGB_LUT[i] = srgbToLinear(i);
}

/** Inline bitmask solidity check for VxlGrid (avoids closure & method-call overhead). */
function vxlSolid(
  solidLo: Uint32Array,
  solidHi: Uint32Array,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): boolean {
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return false;
  const colIdx = z * w + x;
  if (y < 32) return ((solidLo[colIdx] >>> y) & 1) !== 0;
  return ((solidHi[colIdx] >>> (y - 32)) & 1) !== 0;
}

/**
 * Builds an optimized greedy-meshed BufferGeometry with per-vertex Voxel AO.
 * The resulting geometry is centered horizontally at X=0, Z=0 and grounded at Y=0.
 */
export function buildVoxelGeometry(
  grid: VoxelGrid,
  bounds?: RegionBounds,
): BuiltVoxelMesh {
  const minX = Math.max(0, bounds?.minX ?? 0);
  const maxX = Math.min(grid.width, bounds?.maxX ?? grid.width);
  const minY = Math.max(0, bounds?.minY ?? 0);
  const maxY = Math.min(grid.height, bounds?.maxY ?? grid.height);
  const minZ = Math.max(0, bounds?.minZ ?? 0);
  const maxZ = Math.min(grid.depth, bounds?.maxZ ?? grid.depth);

  const dims = [maxX - minX, maxY - minY, maxZ - minZ];
  const mins = [minX, minY, minZ];

  const centerX = mins[0] + dims[0] * 0.5;
  const baseY = mins[1];
  const centerZ = mins[2] + dims[2] * 0.5;

  // Size initial buffer smartly for large .vxl maps vs .kv6 models to avoid resize copies
  let quadCap = grid.format === 'vxl' ? 131072 : 4096;
  let quadCount = 0;
  let posArr = new Float32Array(quadCap * 4 * 3);
  let normArr = new Float32Array(quadCap * 4 * 3);
  let colArr = new Float32Array(quadCap * 4 * 3);
  let aoArr = new Float32Array(quadCap * 4);
  let idxArr = new Uint32Array(quadCap * 6);

  const growBuffers = () => {
    const nextCap = quadCap * 2;
    const growF = (src: Float32Array, stride: number) => {
      const dst = new Float32Array(nextCap * 4 * stride);
      dst.set(src);
      return dst;
    };
    posArr = growF(posArr, 3);
    normArr = growF(normArr, 3);
    colArr = growF(colArr, 3);
    aoArr = growF(aoArr, 1);
    const nextIdx = new Uint32Array(nextCap * 6);
    nextIdx.set(idxArr);
    idxArr = nextIdx;
    quadCap = nextCap;
  };

  // Reuse mask arrays across all 6 faces
  const maxSliceArea = Math.max(
    dims[0] * dims[1],
    dims[0] * dims[2],
    dims[1] * dims[2],
  );
  const maskColor = new Uint32Array(maxSliceArea);
  const maskAo = new Uint16Array(maxSliceArea);

  // Pre-allocated scratch arrays for non-vxl fallback & quad corner writes
  const pos = [0, 0, 0];
  const check = [0, 0, 0];
  const p0 = [0, 0, 0];
  const p1 = [0, 0, 0];
  const p2 = [0, 0, 0];
  const p3 = [0, 0, 0];

  const vxlGrid = grid instanceof VxlGrid ? grid : null;
  const gridW = grid.width;
  const gridH = grid.height;
  const gridD = grid.depth;

  for (let fIdx = 0; fIdx < 6; fIdx++) {
    const face = FACES[fIdx];
    const { axis, dir, uAxis, vAxis, normal, ccw } = face;
    const dMax = dims[axis];
    const uMax = dims[uAxis];
    const vMax = dims[vAxis];
    const sliceLen = uMax * vMax;
    const nx = normal[0];
    const ny = normal[1];
    const nz = normal[2];
    const dOffset = dir > 0 ? 1 : 0;

    for (let d = 0; d < dMax; d++) {
      maskColor.fill(0, 0, sliceLen);
      let anyFace = false;

      const worldD = mins[axis] + d;
      const neighborD = worldD + dir;

      if (vxlGrid && axis === 0) {
        const solidLo = vxlGrid.solidLo;
        const solidHi = vxlGrid.solidHi;
        const inBoundsNeighbor = neighborD >= 0 && neighborD < gridW;

        for (let u = 0; u < uMax; u++) {
          const worldZ = mins[2] + u;
          const colIdx = worldZ * gridW + worldD;
          const nIdx = worldZ * gridW + neighborD;
          const expLo = inBoundsNeighbor
            ? solidLo[colIdx] & ~solidLo[nIdx]
            : solidLo[colIdx];
          const expHi = inBoundsNeighbor
            ? solidHi[colIdx] & ~solidHi[nIdx]
            : solidHi[colIdx];

          let bits = expLo;
          while (bits !== 0) {
            const worldY = 31 - Math.clz32(bits & -bits);
            bits &= bits - 1;
            const v = worldY - mins[1];
            if (v < 0 || v >= vMax) continue;
            const col = vxlGrid.getColorAtSolid(colIdx, worldD, worldY, worldZ);

            let aoSig = 0xff;
            if (inBoundsNeighbor) {
              const mU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY, worldZ - 1);
              const pU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY, worldZ + 1);
              const mV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY - 1, worldZ);
              const pV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY + 1, worldZ);
              const ao00 = cornerAo(mU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY - 1, worldZ - 1));
              const ao10 = cornerAo(pU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY - 1, worldZ + 1));
              const ao11 = cornerAo(pU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY + 1, worldZ + 1));
              const ao01 = cornerAo(mU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY + 1, worldZ - 1));
              aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            }

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = aoSig;
            anyFace = true;
          }

          bits = expHi;
          while (bits !== 0) {
            const worldY = 32 + (31 - Math.clz32(bits & -bits));
            bits &= bits - 1;
            const v = worldY - mins[1];
            if (v < 0 || v >= vMax) continue;
            const col = vxlGrid.getColorAtSolid(colIdx, worldD, worldY, worldZ);

            let aoSig = 0xff;
            if (inBoundsNeighbor) {
              const mU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY, worldZ - 1);
              const pU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY, worldZ + 1);
              const mV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY - 1, worldZ);
              const pV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY + 1, worldZ);
              const ao00 = cornerAo(mU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY - 1, worldZ - 1));
              const ao10 = cornerAo(pU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY - 1, worldZ + 1));
              const ao11 = cornerAo(pU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY + 1, worldZ + 1));
              const ao01 = cornerAo(mU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, neighborD, worldY + 1, worldZ - 1));
              aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            }

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = aoSig;
            anyFace = true;
          }
        }
      } else if (vxlGrid && axis === 2) {
        const solidLo = vxlGrid.solidLo;
        const solidHi = vxlGrid.solidHi;
        const inBoundsNeighbor = neighborD >= 0 && neighborD < gridD;
        const colBase = worldD * gridW;
        const nBase = neighborD * gridW;

        for (let u = 0; u < uMax; u++) {
          const worldX = mins[0] + u;
          const colIdx = colBase + worldX;
          const nIdx = nBase + worldX;
          const expLo = inBoundsNeighbor
            ? solidLo[colIdx] & ~solidLo[nIdx]
            : solidLo[colIdx];
          const expHi = inBoundsNeighbor
            ? solidHi[colIdx] & ~solidHi[nIdx]
            : solidHi[colIdx];

          let bits = expLo;
          while (bits !== 0) {
            const worldY = 31 - Math.clz32(bits & -bits);
            bits &= bits - 1;
            const v = worldY - mins[1];
            if (v < 0 || v >= vMax) continue;
            const col = vxlGrid.getColorAtSolid(colIdx, worldX, worldY, worldD);

            let aoSig = 0xff;
            if (inBoundsNeighbor) {
              const mU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, worldY, neighborD);
              const pU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, worldY, neighborD);
              const mV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX, worldY - 1, neighborD);
              const pV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX, worldY + 1, neighborD);
              const ao00 = cornerAo(mU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, worldY - 1, neighborD));
              const ao10 = cornerAo(pU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, worldY - 1, neighborD));
              const ao11 = cornerAo(pU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, worldY + 1, neighborD));
              const ao01 = cornerAo(mU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, worldY + 1, neighborD));
              aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            }

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = aoSig;
            anyFace = true;
          }

          bits = expHi;
          while (bits !== 0) {
            const worldY = 32 + (31 - Math.clz32(bits & -bits));
            bits &= bits - 1;
            const v = worldY - mins[1];
            if (v < 0 || v >= vMax) continue;
            const col = vxlGrid.getColorAtSolid(colIdx, worldX, worldY, worldD);

            let aoSig = 0xff;
            if (inBoundsNeighbor) {
              const mU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, worldY, neighborD);
              const pU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, worldY, neighborD);
              const mV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX, worldY - 1, neighborD);
              const pV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX, worldY + 1, neighborD);
              const ao00 = cornerAo(mU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, worldY - 1, neighborD));
              const ao10 = cornerAo(pU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, worldY - 1, neighborD));
              const ao11 = cornerAo(pU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, worldY + 1, neighborD));
              const ao01 = cornerAo(mU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, worldY + 1, neighborD));
              aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            }

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = aoSig;
            anyFace = true;
          }
        }
      } else if (vxlGrid && axis === 1) {
        const solidLo = vxlGrid.solidLo;
        const solidHi = vxlGrid.solidHi;
        const worldY = worldD;
        const neighborY = neighborD;
        const inBoundsNeighbor = neighborY >= 0 && neighborY < gridH;
        const useHi = worldY >= 32;
        const bitShift = useHi ? worldY - 32 : worldY;
        const nUseHi = neighborY >= 32;
        const nBitShift = nUseHi ? neighborY - 32 : neighborY;
        const solidArr = useHi ? solidHi : solidLo;
        const nSolidArr = nUseHi ? solidHi : solidLo;

        for (let v = 0; v < vMax; v++) {
          const worldZ = mins[2] + v;
          const rowOffset = v * uMax;
          const zBase = worldZ * gridW;
          for (let u = 0; u < uMax; u++) {
            const worldX = mins[0] + u;
            const colIdx = zBase + worldX;
            if (((solidArr[colIdx] >>> bitShift) & 1) === 0) continue;
            if (inBoundsNeighbor && ((nSolidArr[colIdx] >>> nBitShift) & 1) !== 0) {
              continue;
            }

            const col = vxlGrid.getColorAtSolid(colIdx, worldX, worldY, worldZ);

            let aoSig = 0xff;
            if (inBoundsNeighbor) {
              const mU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, neighborY, worldZ);
              const pU = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, neighborY, worldZ);
              const mV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX, neighborY, worldZ - 1);
              const pV = vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX, neighborY, worldZ + 1);
              const ao00 = cornerAo(mU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, neighborY, worldZ - 1));
              const ao10 = cornerAo(pU, mV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, neighborY, worldZ - 1));
              const ao11 = cornerAo(pU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX + 1, neighborY, worldZ + 1));
              const ao01 = cornerAo(mU, pV, vxlSolid(solidLo, solidHi, gridW, gridH, gridD, worldX - 1, neighborY, worldZ + 1));
              aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            }

            const cell = rowOffset + u;
            maskColor[cell] = col;
            maskAo[cell] = aoSig;
            anyFace = true;
          }
        }
      } else {
        for (let v = 0; v < vMax; v++) {
          const worldV = mins[vAxis] + v;
          const rowOffset = v * uMax;
          for (let u = 0; u < uMax; u++) {
            const worldU = mins[uAxis] + u;

            pos[axis] = worldD;
            pos[uAxis] = worldU;
            pos[vAxis] = worldV;

            const col = grid.getColor(pos[0], pos[1], pos[2]);
            if (col === 0) continue;

            check[axis] = neighborD;
            check[uAxis] = worldU;
            check[vAxis] = worldV;
            if (grid.isSolid(check[0], check[1], check[2])) continue;

            check[uAxis] = worldU - 1; check[vAxis] = worldV;
            const mU = grid.isSolid(check[0], check[1], check[2]);
            check[uAxis] = worldU + 1; check[vAxis] = worldV;
            const pU = grid.isSolid(check[0], check[1], check[2]);
            check[uAxis] = worldU; check[vAxis] = worldV - 1;
            const mV = grid.isSolid(check[0], check[1], check[2]);
            check[uAxis] = worldU; check[vAxis] = worldV + 1;
            const pV = grid.isSolid(check[0], check[1], check[2]);

            check[uAxis] = worldU - 1; check[vAxis] = worldV - 1;
            const ao00 = cornerAo(mU, mV, grid.isSolid(check[0], check[1], check[2]));
            check[uAxis] = worldU + 1; check[vAxis] = worldV - 1;
            const ao10 = cornerAo(pU, mV, grid.isSolid(check[0], check[1], check[2]));
            check[uAxis] = worldU + 1; check[vAxis] = worldV + 1;
            const ao11 = cornerAo(pU, pV, grid.isSolid(check[0], check[1], check[2]));
            check[uAxis] = worldU - 1; check[vAxis] = worldV + 1;
            const ao01 = cornerAo(mU, pV, grid.isSolid(check[0], check[1], check[2]));

            const cell = rowOffset + u;
            maskColor[cell] = col;
            maskAo[cell] = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            anyFace = true;
          }
        }
      }

      if (!anyFace) continue;

      const planeD = worldD + dOffset;
      p0[axis] = planeD;
      p1[axis] = planeD;
      p2[axis] = planeD;
      p3[axis] = planeD;

      // Greedy 2D rectangle merge over (u, v)
      for (let v = 0; v < vMax; v++) {
        const rowBase = v * uMax;
        for (let u = 0; u < uMax; ) {
          const idx = rowBase + u;
          const c = maskColor[idx];
          if (c === 0) {
            u++;
            continue;
          }
          const aoSig = maskAo[idx];

          // Expand width along u
          let w = 1;
          while (
            u + w < uMax &&
            maskColor[idx + w] === c &&
            maskAo[idx + w] === aoSig
          ) {
            w++;
          }

          // Expand height along v
          let h = 1;
          outer: while (v + h < vMax) {
            const nextRow = (v + h) * uMax + u;
            for (let k = 0; k < w; k++) {
              if (
                maskColor[nextRow + k] !== c ||
                maskAo[nextRow + k] !== aoSig
              ) {
                break outer;
              }
            }
            h++;
          }

          // Clear merged region from mask
          for (let j = 0; j < h; j++) {
            const row = (v + j) * uMax + u;
            for (let k = 0; k < w; k++) {
              maskColor[row + k] = 0;
            }
          }

          if (quadCount >= quadCap) {
            growBuffers();
          }

          const worldU0 = mins[uAxis] + u;
          const worldV0 = mins[vAxis] + v;
          const worldU1 = worldU0 + w;
          const worldV1 = worldV0 + h;

          p0[uAxis] = worldU0; p0[vAxis] = worldV0;
          p1[uAxis] = worldU1; p1[vAxis] = worldV0;
          p2[uAxis] = worldU1; p2[vAxis] = worldV1;
          p3[uAxis] = worldU0; p3[vAxis] = worldV1;

          const r = SRGB_LUT[(c >>> 16) & 0xff];
          const g = SRGB_LUT[(c >>> 8) & 0xff];
          const b = SRGB_LUT[c & 0xff];

          const a00 = AO_LUT[aoSig & 3];
          const a10 = AO_LUT[(aoSig >>> 2) & 3];
          const a11 = AO_LUT[(aoSig >>> 4) & 3];
          const a01 = AO_LUT[(aoSig >>> 6) & 3];

          const baseVert = quadCount * 4;
          const b3 = baseVert * 3;

          posArr[b3] = p0[0] - centerX; posArr[b3 + 1] = p0[1] - baseY; posArr[b3 + 2] = p0[2] - centerZ;
          posArr[b3 + 3] = p1[0] - centerX; posArr[b3 + 4] = p1[1] - baseY; posArr[b3 + 5] = p1[2] - centerZ;
          posArr[b3 + 6] = p2[0] - centerX; posArr[b3 + 7] = p2[1] - baseY; posArr[b3 + 8] = p2[2] - centerZ;
          posArr[b3 + 9] = p3[0] - centerX; posArr[b3 + 10] = p3[1] - baseY; posArr[b3 + 11] = p3[2] - centerZ;

          normArr[b3] = nx; normArr[b3 + 1] = ny; normArr[b3 + 2] = nz;
          normArr[b3 + 3] = nx; normArr[b3 + 4] = ny; normArr[b3 + 5] = nz;
          normArr[b3 + 6] = nx; normArr[b3 + 7] = ny; normArr[b3 + 8] = nz;
          normArr[b3 + 9] = nx; normArr[b3 + 10] = ny; normArr[b3 + 11] = nz;

          colArr[b3] = r; colArr[b3 + 1] = g; colArr[b3 + 2] = b;
          colArr[b3 + 3] = r; colArr[b3 + 4] = g; colArr[b3 + 5] = b;
          colArr[b3 + 6] = r; colArr[b3 + 7] = g; colArr[b3 + 8] = b;
          colArr[b3 + 9] = r; colArr[b3 + 10] = g; colArr[b3 + 11] = b;

          aoArr[baseVert] = a00;
          aoArr[baseVert + 1] = a10;
          aoArr[baseVert + 2] = a11;
          aoArr[baseVert + 3] = a01;

          // Flip quad diagonal to prevent anisotropic AO interpolation creasing
          const flipDiag = a00 + a11 < a10 + a01;
          const iBase = quadCount * 6;
          if (!flipDiag) {
            if (ccw) {
              idxArr[iBase] = baseVert;
              idxArr[iBase + 1] = baseVert + 1;
              idxArr[iBase + 2] = baseVert + 2;
              idxArr[iBase + 3] = baseVert;
              idxArr[iBase + 4] = baseVert + 2;
              idxArr[iBase + 5] = baseVert + 3;
            } else {
              idxArr[iBase] = baseVert;
              idxArr[iBase + 1] = baseVert + 2;
              idxArr[iBase + 2] = baseVert + 1;
              idxArr[iBase + 3] = baseVert;
              idxArr[iBase + 4] = baseVert + 3;
              idxArr[iBase + 5] = baseVert + 2;
            }
          } else {
            if (ccw) {
              idxArr[iBase] = baseVert + 1;
              idxArr[iBase + 1] = baseVert + 2;
              idxArr[iBase + 2] = baseVert + 3;
              idxArr[iBase + 3] = baseVert + 1;
              idxArr[iBase + 4] = baseVert + 3;
              idxArr[iBase + 5] = baseVert;
            } else {
              idxArr[iBase] = baseVert + 1;
              idxArr[iBase + 1] = baseVert + 3;
              idxArr[iBase + 2] = baseVert + 2;
              idxArr[iBase + 3] = baseVert + 1;
              idxArr[iBase + 4] = baseVert;
              idxArr[iBase + 5] = baseVert + 3;
            }
          }

          quadCount++;
          u += w;
        }
      }
    }
  }

  const vCount = quadCount * 4;
  const iCount = quadCount * 6;
  // `.slice()` (not `.subarray()`) so the GPU upload does not pin the whole
  // doubled scratch allocation: a buffer that grew to 2x capacity would
  // otherwise retain twice the memory it actually needs.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(posArr.slice(0, vCount * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normArr.slice(0, vCount * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colArr.slice(0, vCount * 3), 3));
  geometry.setAttribute('aAo', new THREE.BufferAttribute(aoArr.slice(0, vCount), 1));

  if (vCount <= 65535) {
    const smallIdx = new Uint16Array(iCount);
    for (let i = 0; i < iCount; i++) smallIdx[i] = idxArr[i];
    geometry.setIndex(new THREE.BufferAttribute(smallIdx, 1));
  } else {
    geometry.setIndex(new THREE.BufferAttribute(idxArr.slice(0, iCount), 1));
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const waterColorHex =
    grid.waterColor !== null
      ? `#${(grid.waterColor & 0xffffff).toString(16).padStart(6, '0')}`
      : null;

  return {
    geometry,
    format: grid.format,
    waterColorHex,
    quadCount,
    triangleCount: quadCount * 2,
    center: new THREE.Vector3(0, dims[1] * 0.5, 0),
    size: new THREE.Vector3(dims[0], dims[1], dims[2]),
  };
}
