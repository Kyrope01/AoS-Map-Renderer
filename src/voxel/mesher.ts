import * as THREE from 'three';
import { RegionBounds, VoxelFormat, VoxelGrid } from './types';
import { VxlGrid } from './vxlParser';

export interface BuiltVoxelMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  ao: Float32Array;
  indices: Uint16Array | Uint32Array;
  format: VoxelFormat;
  waterColorHex: string | null;
  quadCount: number;
  triangleCount: number;
  center: [number, number, number];
  size: [number, number, number];
}

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

function cornerAoBit(side1: number, side2: number, corner: number): number {
  return side1 && side2 ? 0 : 3 - side1 - side2 - corner;
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

/**
 * Builds greedy-meshed typed arrays with per-vertex Voxel AO.
 * Pure worker-safe data builder (no Three.js BufferGeometry allocation).
 */
export function buildVoxelGeometryData(
  grid: VoxelGrid,
  bounds?: RegionBounds,
): BuiltVoxelMeshData {
  const minX = Math.max(0, Math.min(grid.width, bounds?.minX ?? 0));
  const maxX = Math.max(minX, Math.min(grid.width, bounds?.maxX ?? grid.width));
  const minY = Math.max(0, Math.min(grid.height, bounds?.minY ?? 0));
  const maxY = Math.max(minY, Math.min(grid.height, bounds?.maxY ?? grid.height));
  const minZ = Math.max(0, Math.min(grid.depth, bounds?.minZ ?? 0));
  const maxZ = Math.max(minZ, Math.min(grid.depth, bounds?.maxZ ?? grid.depth));

  const dims = [maxX - minX, maxY - minY, maxZ - minZ];
  const mins = [minX, minY, minZ];

  const waterColorHex =
    grid.waterColor !== null
      ? `#${(grid.waterColor & 0xffffff).toString(16).padStart(6, '0')}`
      : null;

  if (dims[0] === 0 || dims[1] === 0 || dims[2] === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      colors: new Float32Array(0),
      ao: new Float32Array(0),
      indices: new Uint16Array(0),
      format: grid.format,
      waterColorHex,
      quadCount: 0,
      triangleCount: 0,
      center: [0, dims[1] * 0.5, 0],
      size: [dims[0], dims[1], dims[2]],
    };
  }

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

  // Reuse mask arrays across all 6 faces. The greedy pass zeros every non-zero
  // cell it visits, so `maskColor` returns to all-zero after every active slice.
  const maxSliceArea = Math.max(
    dims[0] * dims[1],
    dims[0] * dims[2],
    dims[1] * dims[2],
  );
  const maskColor = new Uint32Array(maxSliceArea);
  const maskAo = new Uint16Array(maxSliceArea);

  // Pre-allocated scratch arrays for non-vxl fallback
  const pos = [0, 0, 0];
  const check = [0, 0, 0];

  const vxlGrid = grid instanceof VxlGrid ? grid : null;
  const gridW = grid.width;
  const gridH = grid.height;
  const gridD = grid.depth;

  // Precompute active Y bitmasks within bounds so horizontal slices skip empty sky layers instantly.
  let usedYLo = 0;
  let usedYHi = 0;
  if (vxlGrid) {
    const solidLo = vxlGrid.solidLo;
    const solidHi = vxlGrid.solidHi;
    for (let z = minZ; z < maxZ; z++) {
      const row = z * gridW;
      for (let x = minX; x < maxX; x++) {
        usedYLo |= solidLo[row + x];
        usedYHi |= solidHi[row + x];
      }
    }
  }

  for (let fIdx = 0; fIdx < 6; fIdx++) {
    const face = FACES[fIdx];
    const { axis, dir, uAxis, vAxis, normal, ccw } = face;
    const dMax = dims[axis];
    const uMax = dims[uAxis];
    const vMax = dims[vAxis];
    const nx = normal[0];
    const ny = normal[1];
    const nz = normal[2];
    const dOffset = dir > 0 ? 1 : 0;

    for (let d = 0; d < dMax; d++) {
      let anyFace = false;

      const worldD = mins[axis] + d;
      const neighborD = worldD + dir;

      if (vxlGrid && (axis === 0 || axis === 2)) {
        const solidLo = vxlGrid.solidLo;
        const solidHi = vxlGrid.solidHi;
        const isXAxis = axis === 0;
        const inBoundsNeighbor = neighborD >= 0 && neighborD < (isXAxis ? gridW : gridD);
        const colStride = isXAxis ? gridW : 1;
        const nBaseOffset = isXAxis ? neighborD : neighborD * gridW;
        const nLastU = isXAxis ? gridD - 1 : gridW - 1;
        const minUWorld = isXAxis ? minZ : minX;
        const dCoord = isXAxis ? worldD : 0;
        const colBaseZ = isXAxis ? 0 : worldD * gridW;

        for (let u = 0; u < uMax; u++) {
          const worldU = minUWorld + u;
          const colIdx = isXAxis ? worldU * gridW + dCoord : colBaseZ + worldU;
          const nIdx = isXAxis ? worldU * gridW + nBaseOffset : nBaseOffset + worldU;
          const expLo = inBoundsNeighbor ? solidLo[colIdx] & ~solidLo[nIdx] : solidLo[colIdx];
          const expHi = inBoundsNeighbor ? solidHi[colIdx] & ~solidHi[nIdx] : solidHi[colIdx];
          if ((expLo | expHi) === 0) continue;

          let cLo = 0;
          let cHi = 0;
          let mULo = 0;
          let mUHi = 0;
          let pULo = 0;
          let pUHi = 0;
          if (inBoundsNeighbor) {
            cLo = solidLo[nIdx];
            cHi = solidHi[nIdx];
            if (worldU > 0) {
              mULo = solidLo[nIdx - colStride];
              mUHi = solidHi[nIdx - colStride];
            }
            if (worldU < nLastU) {
              pULo = solidLo[nIdx + colStride];
              pUHi = solidHi[nIdx + colStride];
            }
          }

          let bits = expLo;
          while (bits !== 0) {
            const worldY = 31 - Math.clz32(bits & -bits);
            bits &= bits - 1;
            const v = worldY - minY;
            if (v < 0 || v >= vMax) continue;
            const col = vxlGrid.getColorAtSolid(
              colIdx,
              isXAxis ? worldD : worldU,
              worldY,
              isXAxis ? worldU : worldD,
            );

            let aoSig = 0xff;
            if (inBoundsNeighbor) {
              const mU = (mULo >>> worldY) & 1;
              const pU = (pULo >>> worldY) & 1;
              let mV: number;
              let c00: number;
              let c10: number;
              let pV: number;
              let c11: number;
              let c01: number;
              if (worldY > 0 && worldY < 31 && worldY + 1 < gridH) {
                const ym1 = worldY - 1;
                const yp1 = worldY + 1;
                mV = (cLo >>> ym1) & 1;
                c00 = (mULo >>> ym1) & 1;
                c10 = (pULo >>> ym1) & 1;
                pV = (cLo >>> yp1) & 1;
                c11 = (pULo >>> yp1) & 1;
                c01 = (mULo >>> yp1) & 1;
              } else {
                const ym1 = worldY - 1;
                if (ym1 >= 0) {
                  mV = (cLo >>> ym1) & 1;
                  c00 = (mULo >>> ym1) & 1;
                  c10 = (pULo >>> ym1) & 1;
                } else {
                  mV = 0;
                  c00 = 0;
                  c10 = 0;
                }
                const yp1 = worldY + 1;
                if (yp1 < gridH) {
                  if (yp1 < 32) {
                    pV = (cLo >>> yp1) & 1;
                    c11 = (pULo >>> yp1) & 1;
                    c01 = (mULo >>> yp1) & 1;
                  } else {
                    pV = cHi & 1;
                    c11 = pUHi & 1;
                    c01 = mUHi & 1;
                  }
                } else {
                  pV = 0;
                  c11 = 0;
                  c01 = 0;
                }
              }
              const ao00 = cornerAoBit(mU, mV, c00);
              const ao10 = cornerAoBit(pU, mV, c10);
              const ao11 = cornerAoBit(pU, pV, c11);
              const ao01 = cornerAoBit(mU, pV, c01);
              aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            }

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = aoSig;
            anyFace = true;
          }

          bits = expHi;
          while (bits !== 0) {
            const bit = 31 - Math.clz32(bits & -bits);
            const worldY = 32 + bit;
            bits &= bits - 1;
            const v = worldY - minY;
            if (v < 0 || v >= vMax) continue;
            const col = vxlGrid.getColorAtSolid(
              colIdx,
              isXAxis ? worldD : worldU,
              worldY,
              isXAxis ? worldU : worldD,
            );

            let aoSig = 0xff;
            if (inBoundsNeighbor) {
              const mU = (mUHi >>> bit) & 1;
              const pU = (pUHi >>> bit) & 1;
              let mV: number;
              let c00: number;
              let c10: number;
              let pV: number;
              let c11: number;
              let c01: number;
              if (bit > 0 && worldY + 1 < gridH) {
                const bm1 = bit - 1;
                const bp1 = bit + 1;
                mV = (cHi >>> bm1) & 1;
                c00 = (mUHi >>> bm1) & 1;
                c10 = (pUHi >>> bm1) & 1;
                pV = (cHi >>> bp1) & 1;
                c11 = (pUHi >>> bp1) & 1;
                c01 = (mUHi >>> bp1) & 1;
              } else {
                if (bit > 0) {
                  const bm1 = bit - 1;
                  mV = (cHi >>> bm1) & 1;
                  c00 = (mUHi >>> bm1) & 1;
                  c10 = (pUHi >>> bm1) & 1;
                } else {
                  mV = (cLo >>> 31) & 1;
                  c00 = (mULo >>> 31) & 1;
                  c10 = (pULo >>> 31) & 1;
                }
                if (worldY + 1 < gridH) {
                  const bp1 = bit + 1;
                  pV = (cHi >>> bp1) & 1;
                  c11 = (pUHi >>> bp1) & 1;
                  c01 = (mUHi >>> bp1) & 1;
                } else {
                  pV = 0;
                  c11 = 0;
                  c01 = 0;
                }
              }
              const ao00 = cornerAoBit(mU, mV, c00);
              const ao10 = cornerAoBit(pU, mV, c10);
              const ao11 = cornerAoBit(pU, pV, c11);
              const ao01 = cornerAoBit(mU, pV, c01);
              aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            }

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = aoSig;
            anyFace = true;
          }
        }
      } else if (vxlGrid && axis === 1) {
        const worldY = worldD;
        const bitShift = worldY < 32 ? worldY : worldY - 32;
        const usedMask = worldY < 32 ? usedYLo : usedYHi;
        if (((usedMask >>> bitShift) & 1) === 0) continue;

        const curMask = 1 << bitShift;
        const solidArr = worldY < 32 ? vxlGrid.solidLo : vxlGrid.solidHi;
        const neighborY = neighborD;
        const inBoundsNeighbor = neighborY >= 0 && neighborY < gridH;
        const nBitShift = neighborY < 32 ? neighborY : neighborY - 32;
        const nMask = inBoundsNeighbor ? 1 << nBitShift : 0;
        const nSolidArr = neighborY < 32 ? vxlGrid.solidLo : vxlGrid.solidHi;
        const lastW = gridW - 1;
        const lastD = gridD - 1;

        for (let v = 0; v < vMax; v++) {
          const worldZ = minZ + v;
          const rowOffset = v * uMax;
          const zBase = worldZ * gridW;
          const hasMZ = worldZ > 0;
          const hasPZ = worldZ < lastD;

          for (let u = 0; u < uMax; u++) {
            const worldX = minX + u;
            const colIdx = zBase + worldX;
            if ((solidArr[colIdx] & curMask) === 0) continue;
            if (inBoundsNeighbor && (nSolidArr[colIdx] & nMask) !== 0) continue;

            const col = vxlGrid.getColorAtSolid(colIdx, worldX, worldY, worldZ);

            let aoSig = 0xff;
            if (inBoundsNeighbor) {
              if (worldX > 0 && worldX < lastW && hasMZ && hasPZ) {
                const mU = (nSolidArr[colIdx - 1] & nMask) !== 0 ? 1 : 0;
                const pU = (nSolidArr[colIdx + 1] & nMask) !== 0 ? 1 : 0;
                const mV = (nSolidArr[colIdx - gridW] & nMask) !== 0 ? 1 : 0;
                const pV = (nSolidArr[colIdx + gridW] & nMask) !== 0 ? 1 : 0;
                const ao00 =
                  mU & mV ? 0 : 3 - mU - mV - ((nSolidArr[colIdx - gridW - 1] & nMask) !== 0 ? 1 : 0);
                const ao10 =
                  pU & mV ? 0 : 3 - pU - mV - ((nSolidArr[colIdx - gridW + 1] & nMask) !== 0 ? 1 : 0);
                const ao11 =
                  pU & pV ? 0 : 3 - pU - pV - ((nSolidArr[colIdx + gridW + 1] & nMask) !== 0 ? 1 : 0);
                const ao01 =
                  mU & pV ? 0 : 3 - mU - pV - ((nSolidArr[colIdx + gridW - 1] & nMask) !== 0 ? 1 : 0);
                aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
              } else {
                const hasMX = worldX > 0;
                const hasPX = worldX < lastW;
                const mU = hasMX && (nSolidArr[colIdx - 1] & nMask) !== 0 ? 1 : 0;
                const pU = hasPX && (nSolidArr[colIdx + 1] & nMask) !== 0 ? 1 : 0;
                const mV = hasMZ && (nSolidArr[colIdx - gridW] & nMask) !== 0 ? 1 : 0;
                const pV = hasPZ && (nSolidArr[colIdx + gridW] & nMask) !== 0 ? 1 : 0;
                const c00 = hasMX && hasMZ && (nSolidArr[colIdx - gridW - 1] & nMask) !== 0 ? 1 : 0;
                const c10 = hasPX && hasMZ && (nSolidArr[colIdx - gridW + 1] & nMask) !== 0 ? 1 : 0;
                const c11 = hasPX && hasPZ && (nSolidArr[colIdx + gridW + 1] & nMask) !== 0 ? 1 : 0;
                const c01 = hasMX && hasPZ && (nSolidArr[colIdx + gridW - 1] & nMask) !== 0 ? 1 : 0;
                const ao00 = cornerAoBit(mU, mV, c00);
                const ao10 = cornerAoBit(pU, mV, c10);
                const ao11 = cornerAoBit(pU, pV, c11);
                const ao01 = cornerAoBit(mU, pV, c01);
                aoSig = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
              }
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
      const uMinWorld = mins[uAxis];
      const vMinWorld = mins[vAxis];

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

          const worldU0 = uMinWorld + u;
          const worldV0 = vMinWorld + v;
          const worldU1 = worldU0 + w;
          const worldV1 = worldV0 + h;

          const baseVert = quadCount * 4;
          const b3 = baseVert * 3;

          if (axis === 1) {
            // u = X, v = Z, d = Y
            const py = planeD - baseY;
            const x0 = worldU0 - centerX;
            const x1 = worldU1 - centerX;
            const z0 = worldV0 - centerZ;
            const z1 = worldV1 - centerZ;
            posArr[b3] = x0; posArr[b3 + 1] = py; posArr[b3 + 2] = z0;
            posArr[b3 + 3] = x1; posArr[b3 + 4] = py; posArr[b3 + 5] = z0;
            posArr[b3 + 6] = x1; posArr[b3 + 7] = py; posArr[b3 + 8] = z1;
            posArr[b3 + 9] = x0; posArr[b3 + 10] = py; posArr[b3 + 11] = z1;
          } else if (axis === 0) {
            // u = Z, v = Y, d = X
            const px = planeD - centerX;
            const z0 = worldU0 - centerZ;
            const z1 = worldU1 - centerZ;
            const y0 = worldV0 - baseY;
            const y1 = worldV1 - baseY;
            posArr[b3] = px; posArr[b3 + 1] = y0; posArr[b3 + 2] = z0;
            posArr[b3 + 3] = px; posArr[b3 + 4] = y0; posArr[b3 + 5] = z1;
            posArr[b3 + 6] = px; posArr[b3 + 7] = y1; posArr[b3 + 8] = z1;
            posArr[b3 + 9] = px; posArr[b3 + 10] = y1; posArr[b3 + 11] = z0;
          } else {
            // axis === 2: u = X, v = Y, d = Z
            const pz = planeD - centerZ;
            const x0 = worldU0 - centerX;
            const x1 = worldU1 - centerX;
            const y0 = worldV0 - baseY;
            const y1 = worldV1 - baseY;
            posArr[b3] = x0; posArr[b3 + 1] = y0; posArr[b3 + 2] = pz;
            posArr[b3 + 3] = x1; posArr[b3 + 4] = y0; posArr[b3 + 5] = pz;
            posArr[b3 + 6] = x1; posArr[b3 + 7] = y1; posArr[b3 + 8] = pz;
            posArr[b3 + 9] = x0; posArr[b3 + 10] = y1; posArr[b3 + 11] = pz;
          }

          const r = SRGB_LUT[(c >>> 16) & 0xff];
          const g = SRGB_LUT[(c >>> 8) & 0xff];
          const b = SRGB_LUT[c & 0xff];

          const a00 = AO_LUT[aoSig & 3];
          const a10 = AO_LUT[(aoSig >>> 2) & 3];
          const a11 = AO_LUT[(aoSig >>> 4) & 3];
          const a01 = AO_LUT[(aoSig >>> 6) & 3];

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
  // `.slice()` (not `.subarray()`) so transfers and GPU uploads do not pin the
  // doubled scratch allocation: a buffer that grew to 2x capacity would
  // otherwise retain twice the memory it actually needs.
  const positions = posArr.slice(0, vCount * 3);
  const normals = normArr.slice(0, vCount * 3);
  const colors = colArr.slice(0, vCount * 3);
  const ao = aoArr.slice(0, vCount);

  let indices: Uint16Array | Uint32Array;
  if (vCount <= 65535) {
    const smallIdx = new Uint16Array(iCount);
    for (let i = 0; i < iCount; i++) smallIdx[i] = idxArr[i];
    indices = smallIdx;
  } else {
    indices = idxArr.slice(0, iCount);
  }

  return {
    positions,
    normals,
    colors,
    ao,
    indices,
    format: grid.format,
    waterColorHex,
    quadCount,
    triangleCount: quadCount * 2,
    center: [0, dims[1] * 0.5, 0],
    size: [dims[0], dims[1], dims[2]],
  };
}

/**
 * Wraps worker-built typed arrays into a Three.js BufferGeometry on the main thread.
 */
export function hydrateVoxelGeometry(data: BuiltVoxelMeshData): BuiltVoxelMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('aAo', new THREE.BufferAttribute(data.ao, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

  if (data.positions.length === 0) {
    const hx = Math.max(0.5, data.size[0] * 0.5);
    const hy = Math.max(1, data.size[1]);
    const hz = Math.max(0.5, data.size[2] * 0.5);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-hx, 0, -hz),
      new THREE.Vector3(hx, hy, hz),
    );
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, hy * 0.5, 0),
      Math.hypot(hx, hy * 0.5, hz),
    );
  } else {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  return {
    geometry,
    format: data.format,
    waterColorHex: data.waterColorHex,
    quadCount: data.quadCount,
    triangleCount: data.triangleCount,
    center: new THREE.Vector3(data.center[0], data.center[1], data.center[2]),
    size: new THREE.Vector3(data.size[0], data.size[1], data.size[2]),
  };
}

/**
 * Builds an optimized greedy-meshed BufferGeometry with per-vertex Voxel AO.
 * The resulting geometry is centered horizontally at X=0, Z=0 and grounded at Y=0.
 */
export function buildVoxelGeometry(
  grid: VoxelGrid,
  bounds?: RegionBounds,
): BuiltVoxelMesh {
  return hydrateVoxelGeometry(buildVoxelGeometryData(grid, bounds));
}
