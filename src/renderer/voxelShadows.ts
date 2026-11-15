import * as THREE from 'three';
import { VoxelGrid } from '../voxel/types';
import { VxlGrid } from '../voxel/vxlParser';

// Float shader indexing is exact up to 2^24. One byte stores eight X voxels.
const MAX_SHADOW_BYTES = 1 << 24;

export interface VoxelShadowAtlasData {
  data: Uint8Array;
  width: number;
  height: number;
  stride: number;
}

/** Build raw bit-packed occupancy atlas bytes (worker-safe, no WebGL/Three texture). */
export function buildVoxelShadowData(grid: VoxelGrid, maxTextureSize: number): VoxelShadowAtlasData {
  const stride = Math.ceil(grid.width / 8);
  const bytes = stride * grid.height * grid.depth;
  const width = Math.min(4096, maxTextureSize, Math.max(1, bytes));
  const height = Math.ceil(bytes / width);
  if (bytes > MAX_SHADOW_BYTES || height > maxTextureSize) {
    throw new Error('This model is too large for voxel-light shadows on this device. Lights will be unshadowed.');
  }
  const data = new Uint8Array(width * height);
  const set = (x: number, y: number, z: number) => {
    data[(y * grid.depth + z) * stride + Math.floor(x / 8)] |= 1 << (x % 8);
  };
  if (grid instanceof VxlGrid) {
    // VXL already stores vertical occupancy in two bitmasks per column.
    for (let z = 0; z < grid.depth; z++) {
      for (let x = 0; x < grid.width; x++) {
        const col = z * grid.width + x;
        for (let half = 0; half < 2; half++) {
          let bits = (half === 0 ? grid.solidLo[col] : grid.solidHi[col]) >>> 0;
          while (bits) {
            const y = half * 32 + (31 - Math.clz32(bits & -bits));
            if (y < grid.height) set(x, y, z);
            bits = (bits & (bits - 1)) >>> 0;
          }
        }
      }
    }
  } else if (grid.forEachSolid) {
    grid.forEachSolid((x, y, z) => set(x, y, z));
  } else {
    for (let y = 0; y < grid.height; y++)
      for (let z = 0; z < grid.depth; z++)
        for (let x = 0; x < grid.width; x++) if (grid.isSolid(x, y, z)) set(x, y, z);
  }
  return { data, stride, width, height };
}

/** Wrap precomputed shadow atlas bytes in a Three.js DataTexture on the main thread. */
export function hydrateVoxelShadowTexture(atlas: VoxelShadowAtlasData) {
  const texture = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { texture, stride: atlas.stride, width: atlas.width, height: atlas.height };
}

/** Build a bit-packed occupancy atlas used by point-light shadow rays. */
export function createVoxelShadowTexture(grid: VoxelGrid, maxTextureSize: number) {
  return hydrateVoxelShadowTexture(buildVoxelShadowData(grid, maxTextureSize));
}
