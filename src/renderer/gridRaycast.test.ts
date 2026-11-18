import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { raycastVoxelGrid } from './gridRaycast';
import { VoxelGrid } from '../voxel/types';

function makeGrid(width: number, height: number, depth: number, solids: [number, number, number][]): VoxelGrid {
  const set = new Set(solids.map(([x, y, z]) => `${x},${y},${z}`));
  return {
    format: 'vxl',
    width,
    height,
    depth,
    voxelCount: solids.length,
    pivot: [0, 0, 0],
    waterColor: null,
    isSolid: (x, y, z) => set.has(`${x},${y},${z}`),
    getColor: (x, y, z) => (set.has(`${x},${y},${z}`) ? 0xffffff : 0),
    forEachSolid: (cb) => {
      for (const [x, y, z] of solids) cb(x, y, z, 0xffffff);
    },
  };
}

test('raycastVoxelGrid hits top face of a voxel from above outside the grid', () => {
  const grid = makeGrid(16, 8, 16, [[8, 2, 8]]);
  const offset = new THREE.Vector3(8, 0, 8); // voxel (8,2,8) -> world [0,1] x [2,3] x [0,1]
  const origin = new THREE.Vector3(0.5, 20, 0.5);
  const dir = new THREE.Vector3(0, -1, 0);

  const hit = raycastVoxelGrid(grid, origin, dir, 100, offset);
  assert.ok(hit);
  assert.equal(hit.x, 8);
  assert.equal(hit.y, 2);
  assert.equal(hit.z, 8);
  assert.deepEqual(hit.normal.toArray(), [0, 1, 0]);
  assert.ok(Math.abs(hit.point.y - 3) < 1e-6);
});

test('raycastVoxelGrid hits boundary wall when entering from outside the grid', () => {
  const grid = makeGrid(8, 8, 8, [[0, 3, 4]]);
  const offset = new THREE.Vector3(4, 0, 4); // x=0 -> world [-4, -3]
  const origin = new THREE.Vector3(-10, 3.5, 0.5);
  const dir = new THREE.Vector3(1, 0, 0);

  const hit = raycastVoxelGrid(grid, origin, dir, 100, offset);
  assert.ok(hit);
  assert.equal(hit.x, 0);
  assert.equal(hit.y, 3);
  assert.equal(hit.z, 4);
  assert.deepEqual(hit.normal.toArray(), [-1, 0, 0]);
  assert.ok(Math.abs(hit.point.x - -4) < 1e-6);
});

test('raycastVoxelGrid works from inside the grid and respects slice filter', () => {
  const grid = makeGrid(16, 16, 16, [
    [8, 10, 8],
    [8, 4, 8],
  ]);
  const offset = new THREE.Vector3(8, 0, 8);
  const origin = new THREE.Vector3(0.5, 14, 0.5); // inside [0,16]^3
  const dir = new THREE.Vector3(0, -1, 0);

  // Slice hides everything with worldY > 7
  const hit = raycastVoxelGrid(grid, origin, dir, 100, offset, (_wx, wy) => wy <= 7);
  assert.ok(hit);
  assert.equal(hit.x, 8);
  assert.equal(hit.y, 4);
  assert.equal(hit.z, 8);
  assert.ok(Math.abs(hit.point.y - 5) < 1e-6);
});

test('raycastVoxelGrid respects maxDist and misses empty rays', () => {
  const grid = makeGrid(16, 8, 16, [[8, 1, 8]]);
  const offset = new THREE.Vector3(8, 0, 8);
  const origin = new THREE.Vector3(0.5, 20, 0.5);
  const dir = new THREE.Vector3(0, -1, 0);

  assert.equal(raycastVoxelGrid(grid, origin, dir, 5, offset), null);
  assert.equal(raycastVoxelGrid(grid, new THREE.Vector3(5.5, 20, 5.5), dir, 100, offset), null);
});
