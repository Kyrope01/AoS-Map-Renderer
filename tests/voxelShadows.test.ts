import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoxelShadowTexture } from '../src/renderer/voxelShadows';
import { createSharedUniforms, createMaterialBank } from '../src/renderer/shaders';
import { VoxelGrid } from '../src/voxel/types';
import { encodeKv6, parseKv6 } from '../src/voxel/kv6Parser';
import { VxlGrid } from '../src/voxel/vxlParser';

function bit(atlas: ReturnType<typeof createVoxelShadowTexture>, grid: VoxelGrid, x: number, y: number, z: number) {
  const data = atlas.texture.image.data as Uint8Array;
  return (data[(y * grid.depth + z) * atlas.stride + Math.floor(x / 8)] >> (x % 8)) & 1;
}

test('shadow atlas packs voxel coordinates, including partial bytes and atlas row boundaries', () => {
  const points = new Set(['0,0,0', '8,1,2', '9,2,1', '3,1,2']);
  const grid: VoxelGrid = {
    format: 'kv6', width: 10, height: 3, depth: 3, voxelCount: 4, pivot: [0, 0, 0], waterColor: null,
    isSolid: (x, y, z) => points.has(`${x},${y},${z}`),
    getColor: (x, y, z) => points.has(`${x},${y},${z}`) ? 0xffffffff : 0,
  };
  const atlas = createVoxelShadowTexture(grid, 8);
  assert.equal(atlas.width, 8);
  assert.equal(atlas.height, 3);
  for (let y=0;y<grid.height;y++) for (let z=0;z<grid.depth;z++) for (let x=0;x<grid.width;x++)
    assert.equal(bit(atlas, grid, x, y, z), Number(grid.isSolid(x,y,z)));
  atlas.texture.dispose();
});

test('VXL column masks and KV6 solid iteration create matching occupancy', () => {
  const lo = new Uint32Array(16); const hi = new Uint32Array(16);
  lo[1] = (1 << 2) | (1 << 31); hi[1] = (1 << 0) | (1 << 31);
  const grid = new VxlGrid(4, 64, 4, 4, null, lo, hi, new Uint32Array(16), new Uint8Array(16), new Uint8Array(), new Uint32Array());
  const atlas = createVoxelShadowTexture(grid, 256);
  for (const y of [2,31,32,63]) assert.equal(bit(atlas, grid, 1, y, 0), 1);
  for (const y of [1,30,33,62]) assert.equal(bit(atlas, grid, 1, y, 0), 0);
  atlas.texture.dispose();
  const kv6 = parseKv6(encodeKv6(2, 2, 3, [{x: 1, y: 0, z: 0, r: 10, g: 20, b: 30}]));
  const kvAtlas = createVoxelShadowTexture(kv6, 256);
  assert.equal(bit(kvAtlas, kv6, 1, 2, 0), 1);
  assert.equal(bit(kvAtlas, kv6, 1, 0, 0), 0);
  kvAtlas.texture.dispose();
});

test('unsupported atlas sizes report a warning instead of allocating', () => {
  const grid: VoxelGrid = { format:'kv6', width: 2048, height: 2048, depth:2048, voxelCount:0, pivot:[0,0,0], waterColor:null, isSolid:()=>false, getColor:()=>0 };
  assert.throws(() => createVoxelShadowTexture(grid, 4096), /too large/);
});

test('voxel shadow uniforms and traversal are included in every material', () => {
  const shared = createSharedUniforms();
  const bank = createMaterialBank(shared);
  for (const mode of ['atmospheric','diorama','cinema','voxlap','rim'] as const)
    assert.match(bank[mode].fragmentShader, /voxelShadowVisibility/);
  assert.equal(shared.uVoxelShadowsEnabled.value, 0);
  bank.dispose();
  shared.uVoxelShadowTexture.value.dispose();
  shared.uVoxelLightTexture.value.dispose();
});
