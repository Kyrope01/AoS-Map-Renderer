import * as THREE from 'three';
import { RegionBounds, VoxelFormat, VoxelGrid } from './types';

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
  normal: [number, number, number];
}

const FACES: FaceDef[] = [
  { axis: 1, dir: 1, uAxis: 0, vAxis: 2, normal: [0, 1, 0] },   // +Y (top)
  { axis: 1, dir: -1, uAxis: 0, vAxis: 2, normal: [0, -1, 0] }, // -Y (bottom)
  { axis: 0, dir: 1, uAxis: 2, vAxis: 1, normal: [1, 0, 0] },   // +X (right)
  { axis: 0, dir: -1, uAxis: 2, vAxis: 1, normal: [-1, 0, 0] }, // -X (left)
  { axis: 2, dir: 1, uAxis: 0, vAxis: 1, normal: [0, 0, 1] },   // +Z (front)
  { axis: 2, dir: -1, uAxis: 0, vAxis: 1, normal: [0, 0, -1] }, // -Z (back)
];

/** Fast 4-corner voxel ambient occlusion (0..3 -> 0.42..1.0). */
function cornerAo(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0));
}

const AO_LUT = [0.42, 0.64, 0.83, 1.0];

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
 * Builds an optimized greedy-meshed BufferGeometry with per-vertex Voxel AO,
 * continuous per-voxel UVs (for bevel/seam shaders across merged quads),
 * and radial explode directions.
 *
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
  const centerY = mins[1] + dims[1] * 0.5;

  // Dynamic growable typed buffers
  let quadCap = 8192;
  let quadCount = 0;
  let posArr = new Float32Array(quadCap * 4 * 3);
  let normArr = new Float32Array(quadCap * 4 * 3);
  let colArr = new Float32Array(quadCap * 4 * 3);
  let aoArr = new Float32Array(quadCap * 4);
  let uvArr = new Float32Array(quadCap * 4 * 2);
  let expArr = new Float32Array(quadCap * 4 * 3);
  let idxArr = new Uint32Array(quadCap * 6);

  const ensureQuadCap = () => {
    if (quadCount < quadCap) return;
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
    uvArr = growF(uvArr, 2);
    expArr = growF(expArr, 3);
    const nextIdx = new Uint32Array(nextCap * 6);
    nextIdx.set(idxArr);
    idxArr = nextIdx;
    quadCap = nextCap;
  };

  const pos = [0, 0, 0];
  const check = [0, 0, 0];

  // Optional bitwise column fast-path for VxlGrid (skips buried dirt & empty sky in O(1))
  const vxlGrid =
    grid.format === 'vxl' && 'solidLo' in grid && 'solidHi' in grid
      ? (grid as VoxelGrid & { solidLo: Uint32Array; solidHi: Uint32Array })
      : null;

  for (const face of FACES) {
    const { axis, dir, uAxis, vAxis, normal } = face;
    const dMax = dims[axis];
    const uMax = dims[uAxis];
    const vMax = dims[vAxis];

    // Mask stores 24-bit RGB + 8-bit packed AO signature (0 = no face)
    const maskColor = new Uint32Array(uMax * vMax);
    const maskAo = new Uint16Array(uMax * vMax);

    for (let d = 0; d < dMax; d++) {
      maskColor.fill(0);
      let anyFace = false;

      const worldD = mins[axis] + d;
      const neighborD = worldD + dir;

      if (vxlGrid && axis === 0) {
        // Fast column-bitmask culling for +X / -X slices
        const inBoundsNeighbor = neighborD >= 0 && neighborD < grid.width;
        for (let u = 0; u < uMax; u++) {
          const worldZ = mins[2] + u;
          const colIdx = worldZ * grid.width + worldD;
          const nIdx = worldZ * grid.width + neighborD;
          const expLo = inBoundsNeighbor
            ? vxlGrid.solidLo[colIdx] & ~vxlGrid.solidLo[nIdx]
            : vxlGrid.solidLo[colIdx];
          const expHi = inBoundsNeighbor
            ? vxlGrid.solidHi[colIdx] & ~vxlGrid.solidHi[nIdx]
            : vxlGrid.solidHi[colIdx];

          let bits = expLo;
          while (bits !== 0) {
            const worldY = 31 - Math.clz32(bits & -bits);
            bits &= bits - 1;
            const v = worldY - mins[1];
            if (v < 0 || v >= vMax) continue;
            const col = grid.getColor(worldD, worldY, worldZ);
            if (col === 0) continue;

            const isOcc = (du: number, dv: number): boolean =>
              grid.isSolid(neighborD, worldY + dv, worldZ + du);
            const mU = isOcc(-1, 0);
            const pU = isOcc(1, 0);
            const mV = isOcc(0, -1);
            const pV = isOcc(0, 1);
            const ao00 = cornerAo(mU, mV, isOcc(-1, -1));
            const ao10 = cornerAo(pU, mV, isOcc(1, -1));
            const ao11 = cornerAo(pU, pV, isOcc(1, 1));
            const ao01 = cornerAo(mU, pV, isOcc(-1, 1));

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            anyFace = true;
          }

          bits = expHi;
          while (bits !== 0) {
            const worldY = 32 + (31 - Math.clz32(bits & -bits));
            bits &= bits - 1;
            const v = worldY - mins[1];
            if (v < 0 || v >= vMax) continue;
            const col = grid.getColor(worldD, worldY, worldZ);
            if (col === 0) continue;

            const isOcc = (du: number, dv: number): boolean =>
              grid.isSolid(neighborD, worldY + dv, worldZ + du);
            const mU = isOcc(-1, 0);
            const pU = isOcc(1, 0);
            const mV = isOcc(0, -1);
            const pV = isOcc(0, 1);
            const ao00 = cornerAo(mU, mV, isOcc(-1, -1));
            const ao10 = cornerAo(pU, mV, isOcc(1, -1));
            const ao11 = cornerAo(pU, pV, isOcc(1, 1));
            const ao01 = cornerAo(mU, pV, isOcc(-1, 1));

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            anyFace = true;
          }
        }
      } else if (vxlGrid && axis === 2) {
        // Fast column-bitmask culling for +Z / -Z slices
        const inBoundsNeighbor = neighborD >= 0 && neighborD < grid.depth;
        for (let u = 0; u < uMax; u++) {
          const worldX = mins[0] + u;
          const colIdx = worldD * grid.width + worldX;
          const nIdx = neighborD * grid.width + worldX;
          const expLo = inBoundsNeighbor
            ? vxlGrid.solidLo[colIdx] & ~vxlGrid.solidLo[nIdx]
            : vxlGrid.solidLo[colIdx];
          const expHi = inBoundsNeighbor
            ? vxlGrid.solidHi[colIdx] & ~vxlGrid.solidHi[nIdx]
            : vxlGrid.solidHi[colIdx];

          let bits = expLo;
          while (bits !== 0) {
            const worldY = 31 - Math.clz32(bits & -bits);
            bits &= bits - 1;
            const v = worldY - mins[1];
            if (v < 0 || v >= vMax) continue;
            const col = grid.getColor(worldX, worldY, worldD);
            if (col === 0) continue;

            const isOcc = (du: number, dv: number): boolean =>
              grid.isSolid(worldX + du, worldY + dv, neighborD);
            const mU = isOcc(-1, 0);
            const pU = isOcc(1, 0);
            const mV = isOcc(0, -1);
            const pV = isOcc(0, 1);
            const ao00 = cornerAo(mU, mV, isOcc(-1, -1));
            const ao10 = cornerAo(pU, mV, isOcc(1, -1));
            const ao11 = cornerAo(pU, pV, isOcc(1, 1));
            const ao01 = cornerAo(mU, pV, isOcc(-1, 1));

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            anyFace = true;
          }

          bits = expHi;
          while (bits !== 0) {
            const worldY = 32 + (31 - Math.clz32(bits & -bits));
            bits &= bits - 1;
            const v = worldY - mins[1];
            if (v < 0 || v >= vMax) continue;
            const col = grid.getColor(worldX, worldY, worldD);
            if (col === 0) continue;

            const isOcc = (du: number, dv: number): boolean =>
              grid.isSolid(worldX + du, worldY + dv, neighborD);
            const mU = isOcc(-1, 0);
            const pU = isOcc(1, 0);
            const mV = isOcc(0, -1);
            const pV = isOcc(0, 1);
            const ao00 = cornerAo(mU, mV, isOcc(-1, -1));
            const ao10 = cornerAo(pU, mV, isOcc(1, -1));
            const ao11 = cornerAo(pU, pV, isOcc(1, 1));
            const ao01 = cornerAo(mU, pV, isOcc(-1, 1));

            const cell = v * uMax + u;
            maskColor[cell] = col;
            maskAo[cell] = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            anyFace = true;
          }
        }
      } else if (vxlGrid && axis === 1) {
        // Fast bitmask check for +Y / -Y slices (skips all air and underground dirt in 2 bitwise ops)
        const worldY = worldD;
        const neighborY = neighborD;
        const inBoundsNeighbor = neighborY >= 0 && neighborY < grid.height;
        const useHi = worldY >= 32;
        const bitShift = useHi ? worldY - 32 : worldY;
        const nUseHi = neighborY >= 32;
        const nBitShift = nUseHi ? neighborY - 32 : neighborY;
        const solidArr = useHi ? vxlGrid.solidHi : vxlGrid.solidLo;
        const nSolidArr = nUseHi ? vxlGrid.solidHi : vxlGrid.solidLo;

        for (let v = 0; v < vMax; v++) {
          const worldZ = mins[2] + v;
          const rowOffset = v * uMax;
          const zBase = worldZ * grid.width;
          for (let u = 0; u < uMax; u++) {
            const worldX = mins[0] + u;
            const colIdx = zBase + worldX;
            if (((solidArr[colIdx] >>> bitShift) & 1) === 0) continue;
            if (inBoundsNeighbor && ((nSolidArr[colIdx] >>> nBitShift) & 1) !== 0) {
              continue;
            }

            const col = grid.getColor(worldX, worldY, worldZ);
            if (col === 0) continue;

            const isOcc = (du: number, dv: number): boolean =>
              grid.isSolid(worldX + du, neighborY, worldZ + dv);
            const mU = isOcc(-1, 0);
            const pU = isOcc(1, 0);
            const mV = isOcc(0, -1);
            const pV = isOcc(0, 1);

            const ao00 = cornerAo(mU, mV, isOcc(-1, -1));
            const ao10 = cornerAo(pU, mV, isOcc(1, -1));
            const ao11 = cornerAo(pU, pV, isOcc(1, 1));
            const ao01 = cornerAo(mU, pV, isOcc(-1, 1));

            const cell = rowOffset + u;
            maskColor[cell] = col;
            maskAo[cell] = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
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

            // Neighbor in face normal direction
            check[axis] = neighborD;
            check[uAxis] = worldU;
            check[vAxis] = worldV;
            if (grid.isSolid(check[0], check[1], check[2])) continue;

            // Sample 8 surrounding neighbors in the plane just outside the face (neighborD)
            const isOcc = (du: number, dv: number): boolean => {
              check[axis] = neighborD;
              check[uAxis] = worldU + du;
              check[vAxis] = worldV + dv;
              return grid.isSolid(check[0], check[1], check[2]);
            };

            const mU = isOcc(-1, 0);
            const pU = isOcc(1, 0);
            const mV = isOcc(0, -1);
            const pV = isOcc(0, 1);

            const ao00 = cornerAo(mU, mV, isOcc(-1, -1));
            const ao10 = cornerAo(pU, mV, isOcc(1, -1));
            const ao11 = cornerAo(pU, pV, isOcc(1, 1));
            const ao01 = cornerAo(mU, pV, isOcc(-1, 1));

            const cell = rowOffset + u;
            maskColor[cell] = col;
            maskAo[cell] = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
            anyFace = true;
          }
        }
      }

      if (!anyFace) continue;

      // Greedy 2D rectangle merge over (u, v)
      for (let v = 0; v < vMax; v++) {
        for (let u = 0; u < uMax; ) {
          const idx = v * uMax + u;
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

          ensureQuadCap();

          // Emit quad vertices
          const worldD = mins[axis] + d + (dir > 0 ? 1 : 0);
          const worldU0 = mins[uAxis] + u;
          const worldV0 = mins[vAxis] + v;
          const worldU1 = worldU0 + w;
          const worldV1 = worldV0 + h;

          const p00 = [0, 0, 0];
          const p10 = [0, 0, 0];
          const p11 = [0, 0, 0];
          const p01 = [0, 0, 0];

          p00[axis] = worldD; p00[uAxis] = worldU0; p00[vAxis] = worldV0;
          p10[axis] = worldD; p10[uAxis] = worldU1; p10[vAxis] = worldV0;
          p11[axis] = worldD; p11[uAxis] = worldU1; p11[vAxis] = worldV1;
          p01[axis] = worldD; p01[uAxis] = worldU0; p01[vAxis] = worldV1;

          // Center-shifted coordinates (ground at y = 0)
          const verts = [p00, p10, p11, p01];
          const r = SRGB_LUT[(c >>> 16) & 0xff];
          const g = SRGB_LUT[(c >>> 8) & 0xff];
          const b = SRGB_LUT[c & 0xff];

          const a00 = AO_LUT[aoSig & 3];
          const a10 = AO_LUT[(aoSig >>> 2) & 3];
          const a11 = AO_LUT[(aoSig >>> 4) & 3];
          const a01 = AO_LUT[(aoSig >>> 6) & 3];
          const aos = [a00, a10, a11, a01];

          const uvs = [
            0, 0,
            w, 0,
            w, h,
            0, h,
          ];

          // Quad center radial explode vector
          const qcx = (p00[0] + p11[0]) * 0.5 - centerX;
          const qcy = (p00[1] + p11[1]) * 0.5 - centerY;
          const qcz = (p00[2] + p11[2]) * 0.5 - centerZ;
          const qLen = Math.hypot(qcx, qcy, qcz) || 1;
          const ex = (qcx / qLen) * 0.65 + normal[0] * 0.35;
          const ey = (qcy / qLen) * 0.65 + normal[1] * 0.35;
          const ez = (qcz / qLen) * 0.65 + normal[2] * 0.35;

          const baseVert = quadCount * 4;
          for (let vi = 0; vi < 4; vi++) {
            const p = verts[vi];
            const v3 = (baseVert + vi) * 3;
            const v2 = (baseVert + vi) * 2;
            posArr[v3] = p[0] - centerX;
            posArr[v3 + 1] = p[1] - baseY;
            posArr[v3 + 2] = p[2] - centerZ;

            normArr[v3] = normal[0];
            normArr[v3 + 1] = normal[1];
            normArr[v3 + 2] = normal[2];

            colArr[v3] = r;
            colArr[v3 + 1] = g;
            colArr[v3 + 2] = b;

            aoArr[baseVert + vi] = aos[vi];
            uvArr[v2] = uvs[vi * 2];
            uvArr[v2 + 1] = uvs[vi * 2 + 1];

            expArr[v3] = ex;
            expArr[v3 + 1] = ey;
            expArr[v3 + 2] = ez;
          }

          // Check winding so outward faces are CCW
          // (p10 - p00) x (p01 - p00) should point along `normal`.
          const ux = p10[0] - p00[0], uy = p10[1] - p00[1], uz = p10[2] - p00[2];
          const vx = p01[0] - p00[0], vy = p01[1] - p00[1], vz = p01[2] - p00[2];
          const cx = uy * vz - uz * vy;
          const cy = uz * vx - ux * vz;
          const cz = ux * vy - uy * vx;
          const ccw = cx * normal[0] + cy * normal[1] + cz * normal[2] > 0;

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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(posArr.subarray(0, vCount * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normArr.subarray(0, vCount * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colArr.subarray(0, vCount * 3), 3));
  geometry.setAttribute('aAo', new THREE.BufferAttribute(aoArr.subarray(0, vCount), 1));
  geometry.setAttribute('aVoxelUv', new THREE.BufferAttribute(uvArr.subarray(0, vCount * 2), 2));
  geometry.setAttribute('aExplodeDir', new THREE.BufferAttribute(expArr.subarray(0, vCount * 3), 3));

  if (vCount <= 65535) {
    const smallIdx = new Uint16Array(iCount);
    for (let i = 0; i < iCount; i++) smallIdx[i] = idxArr[i];
    geometry.setIndex(new THREE.BufferAttribute(smallIdx, 1));
  } else {
    geometry.setIndex(new THREE.BufferAttribute(idxArr.subarray(0, iCount), 1));
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
