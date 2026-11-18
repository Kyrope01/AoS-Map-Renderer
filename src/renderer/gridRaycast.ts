import * as THREE from 'three';
import { VoxelGrid } from '../voxel/types';

export interface GridRaycastHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  x: number;
  y: number;
  z: number;
  distance: number;
}

/**
 * Fast Amanatides & Woo 3D DDA voxel raycast against `VoxelGrid` in world space.
 * Grid cell `(x, y, z)` occupies `[x - gridOffset.x, x + 1 - gridOffset.x]` etc.
 * Complexity is O(ray length in cells) rather than O(triangle count).
 */
export function raycastVoxelGrid(
  grid: VoxelGrid,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  gridOffset: THREE.Vector3,
  isVisible?: (worldX: number, worldY: number, worldZ: number) => boolean,
): GridRaycastHit | null {
  const W = grid.width;
  const H = grid.height;
  const D = grid.depth;
  if (W <= 0 || H <= 0 || D <= 0 || maxDist <= 0) return null;

  const dirLen = Math.hypot(dir.x, dir.y, dir.z);
  if (dirLen < 1e-12) return null;
  const dx = dir.x / dirLen;
  const dy = dir.y / dirLen;
  const dz = dir.z / dirLen;

  const px = origin.x + gridOffset.x;
  const py = origin.y + gridOffset.y;
  const pz = origin.z + gridOffset.z;

  // Slab intersection against grid AABB [0, W] x [0, H] x [0, D]
  let txMin = -Infinity;
  let txMax = Infinity;
  if (dx !== 0) {
    const inv = 1 / dx;
    const t0 = (0 - px) * inv;
    const t1 = (W - px) * inv;
    txMin = t0 < t1 ? t0 : t1;
    txMax = t0 < t1 ? t1 : t0;
  } else if (px < 0 || px >= W) {
    return null;
  }

  let tyMin = -Infinity;
  let tyMax = Infinity;
  if (dy !== 0) {
    const inv = 1 / dy;
    const t0 = (0 - py) * inv;
    const t1 = (H - py) * inv;
    tyMin = t0 < t1 ? t0 : t1;
    tyMax = t0 < t1 ? t1 : t0;
  } else if (py < 0 || py >= H) {
    return null;
  }

  let tzMin = -Infinity;
  let tzMax = Infinity;
  if (dz !== 0) {
    const inv = 1 / dz;
    const t0 = (0 - pz) * inv;
    const t1 = (D - pz) * inv;
    tzMin = t0 < t1 ? t0 : t1;
    tzMax = t0 < t1 ? t1 : t0;
  } else if (pz < 0 || pz >= D) {
    return null;
  }

  let tMin = 0;
  let entryAxis = -1;
  let entryNx = 0;
  let entryNy = 0;
  let entryNz = 0;

  if (txMin > tMin) {
    tMin = txMin;
    entryAxis = 0;
    entryNx = dx > 0 ? -1 : 1;
    entryNy = 0;
    entryNz = 0;
  }
  if (tyMin > tMin) {
    tMin = tyMin;
    entryAxis = 1;
    entryNx = 0;
    entryNy = dy > 0 ? -1 : 1;
    entryNz = 0;
  }
  if (tzMin > tMin) {
    tMin = tzMin;
    entryAxis = 2;
    entryNx = 0;
    entryNy = 0;
    entryNz = dz > 0 ? -1 : 1;
  }

  const tMax = Math.min(maxDist, txMax, tyMax, tzMax);
  if (tMax < tMin) return null;

  const sx = px + dx * tMin;
  const sy = py + dy * tMin;
  const sz = pz + dz * tMin;

  let ix: number;
  let iy: number;
  let iz: number;

  if (entryAxis !== -1) {
    ix = entryAxis === 0
      ? (dx > 0 ? 0 : W - 1)
      : Math.max(0, Math.min(W - 1, Math.floor(sx)));
    iy = entryAxis === 1
      ? (dy > 0 ? 0 : H - 1)
      : Math.max(0, Math.min(H - 1, Math.floor(sy)));
    iz = entryAxis === 2
      ? (dz > 0 ? 0 : D - 1)
      : Math.max(0, Math.min(D - 1, Math.floor(sz)));
  } else {
    ix = Math.floor(px);
    iy = Math.floor(py);
    iz = Math.floor(pz);
    if (ix === W && dx < 0) ix = W - 1;
    if (iy === H && dy < 0) iy = H - 1;
    if (iz === D && dz < 0) iz = D - 1;
    if (ix < 0 || ix >= W || iy < 0 || iy >= H || iz < 0 || iz >= D) {
      return null;
    }
  }

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = dx > 0 ? (ix + 1 - px) / dx : dx < 0 ? (ix - px) / dx : Infinity;
  let tMaxY = dy > 0 ? (iy + 1 - py) / dy : dy < 0 ? (iy - py) / dy : Infinity;
  let tMaxZ = dz > 0 ? (iz + 1 - pz) / dz : dz < 0 ? (iz - pz) / dz : Infinity;

  let tCurrent = tMin;
  let nx = entryNx;
  let ny = entryNy;
  let nz = entryNz;
  let prevSolid = entryAxis === -1 ? grid.isSolid(ix, iy, iz) : false;

  const maxSteps = W + H + D + 16;
  for (let step = 0; step < maxSteps; step++) {
    if (ix < 0 || ix >= W || iy < 0 || iy >= H || iz < 0 || iz >= D) break;

    const solid = grid.isSolid(ix, iy, iz);
    if (solid && !prevSolid) {
      const visible =
        !isVisible ||
        isVisible(
          ix + 0.5 - gridOffset.x,
          iy + 0.5 - gridOffset.y,
          iz + 0.5 - gridOffset.z,
        );
      if (visible) {
        return {
          point: new THREE.Vector3(
            origin.x + dx * tCurrent,
            origin.y + dy * tCurrent,
            origin.z + dz * tCurrent,
          ),
          normal: new THREE.Vector3(nx, ny, nz),
          x: ix,
          y: iy,
          z: iz,
          distance: tCurrent,
        };
      }
    }
    prevSolid = solid;

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      tCurrent = tMaxX;
      tMaxX += tDeltaX;
      ix += stepX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY <= tMaxZ) {
      tCurrent = tMaxY;
      tMaxY += tDeltaY;
      iy += stepY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      tCurrent = tMaxZ;
      tMaxZ += tDeltaZ;
      iz += stepZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }

    if (tCurrent > tMax) break;
  }

  return null;
}
