import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeKv6, parseKv6 } from './kv6Parser';
import { encodeVxl, parseVxl } from './vxlParser';
import { buildVoxelGeometry } from './mesher';
import {
  computeExportTiles,
  computeUpscaledDimensions,
  formatResolutionLabel,
  MAX_EXPORT_LONG_EDGE,
} from './exportResolution';
import { VoxelParseError } from './types';

test('kv6 encode -> parse round-trip preserves dimensions, voxels, and BGR->RGB colors', () => {
  const buf = encodeKv6(
    4,
    4,
    4,
    [
      { x: 0, y: 0, z: 0, r: 220, g: 40, b: 10 }, // Voxlap z=0 (top -> gy=3)
      { x: 3, y: 2, z: 3, r: 15, g: 180, b: 240 }, // Voxlap z=3 (bottom -> gy=0)
    ],
    [2, 2, 2],
  );

  const grid = parseKv6(buf);
  assert.equal(grid.format, 'kv6');
  assert.equal(grid.waterColor, null);
  assert.equal(grid.width, 4);
  assert.equal(grid.height, 4);
  assert.equal(grid.depth, 4);
  assert.equal(grid.voxelCount, 2);

  const topColor = grid.getColor(0, 3, 0);
  assert.equal((topColor >>> 16) & 0xff, 220);
  assert.equal((topColor >>> 8) & 0xff, 40);
  assert.equal(topColor & 0xff, 10);

  const botColor = grid.getColor(3, 0, 2);
  assert.equal((botColor >>> 16) & 0xff, 15);
  assert.equal((botColor >>> 8) & 0xff, 180);
  assert.equal(botColor & 0xff, 240);

  assert.equal(grid.isSolid(1, 1, 1), false);
});

test('kv6 parser rejects invalid magic header and truncated payloads', () => {
  assert.throws(() => parseKv6(new Uint8Array(10)), VoxelParseError);

  const badMagic = new Uint8Array(64);
  badMagic[0] = 65; // 'A' instead of 'K'
  assert.throws(() => parseKv6(badMagic), VoxelParseError);
});

test('vxl encode -> parse round-trip handles overhangs and multi-span columns', () => {
  const W = 8;
  const D = 8;
  const H = 16;
  const voxels = new Uint32Array(W * D * H);
  const set = (x: number, y: number, z: number, r: number, g: number, b: number) => {
    voxels[(y * D + z) * W + x] = (0xff << 24) | (r << 16) | (g << 8) | b;
  };

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      set(x, 0, z, 103, 64, 40);
      set(x, 1, z, 80, 140, 60);
    }
  }
  // Overhang bridge with air at gy=2..7
  set(4, 8, 4, 210, 120, 50); // bottom-facing surface
  set(4, 9, 4, 230, 180, 70); // top-facing surface

  const buf = encodeVxl(W, D, H, (gx, gy, gz) => voxels[(gy * D + gz) * W + gx]);
  const grid = parseVxl(buf, { width: W, depth: D, height: H });

  assert.equal(grid.format, 'vxl');
  assert.equal(grid.waterColor, null); // All gy=0 voxels are buried under gy=1 grass
  assert.equal(grid.isSolid(4, 1, 4), true);
  assert.equal(grid.isSolid(4, 5, 4), false); // Air gap under bridge
  assert.equal(grid.isSolid(4, 8, 4), true);
  assert.equal(grid.isSolid(4, 9, 4), true);

  const topBridge = grid.getColor(4, 9, 4);
  assert.equal((topBridge >>> 16) & 0xff, 230);
  assert.equal((topBridge >>> 8) & 0xff, 180);
  assert.equal(topBridge & 0xff, 70);

  const botBridge = grid.getColor(4, 8, 4);
  assert.equal((botBridge >>> 16) & 0xff, 210);
});

test('vxl parser detects border water color when exposed gy=0 water exists', () => {
  const W = 16;
  const D = 16;
  const H = 64;
  const voxels = new Uint32Array(W * D * H);
  const set = (x: number, y: number, z: number, r: number, g: number, b: number) => {
    voxels[(y * D + z) * W + x] = (0xff << 24) | (r << 16) | (g << 8) | b;
  };

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      // Exposed water at gy=0 around perimeter (RGB 42, 118, 175)
      set(x, 0, z, 42, 118, 175);
      if (x >= 4 && x < 12 && z >= 4 && z < 12) {
        set(x, 1, z, 95, 155, 80);
        set(x, 2, z, 95, 155, 80);
      }
    }
  }

  const buf = encodeVxl(W, D, H, (gx, gy, gz) => voxels[(gy * D + gz) * W + gx]);
  const grid = parseVxl(buf, { width: W, depth: D, height: H });
  assert.ok(grid.waterColor !== null);
  assert.equal((grid.waterColor! >>> 16) & 0xff, 42);
  assert.equal((grid.waterColor! >>> 8) & 0xff, 118);
  assert.equal(grid.waterColor! & 0xff, 175);

  const built = buildVoxelGeometry(grid);
  assert.equal(built.format, 'vxl');
  assert.equal(built.waterColorHex, '#2a76af');
  built.geometry.dispose();
});

test('greedy mesher merges uniform faces and computes valid attributes', () => {
  const buf = encodeKv6(2, 2, 1, [
    { x: 0, y: 0, z: 0, r: 200, g: 100, b: 50 },
    { x: 1, y: 0, z: 0, r: 200, g: 100, b: 50 },
    { x: 0, y: 1, z: 0, r: 200, g: 100, b: 50 },
    { x: 1, y: 1, z: 0, r: 200, g: 100, b: 50 },
  ]);
  const grid = parseKv6(buf);
  const built = buildVoxelGeometry(grid);

  assert.equal(built.format, 'kv6');
  assert.equal(built.waterColorHex, null);
  assert.equal(built.quadCount, 6);
  assert.equal(built.triangleCount, 12);
  assert.ok(built.geometry.getAttribute('aAo'));
  assert.ok(built.geometry.getAttribute('position'));
  assert.ok(built.geometry.getAttribute('normal'));
  assert.ok(built.geometry.getAttribute('color'));
  built.geometry.dispose();
});

test('vxl parser handles Ace of Spades zero-length top surface spans like [44, 43]', () => {
  const buf = new Uint8Array([
    3, 10, 10, 0,
    10, 20, 30, 128,
    40, 50, 60, 128,
    0, 44, 43, 15,
  ]);
  const grid = parseVxl(buf, { width: 1, depth: 1, height: 64 });
  assert.equal(grid.isSolid(0, 63 - 9, 0), false);
  assert.equal(grid.isSolid(0, 63 - 10, 0), true);
  assert.equal(grid.isSolid(0, 63 - 12, 0), true);
  assert.equal(grid.isSolid(0, 63 - 14, 0), true);
  assert.equal(grid.isSolid(0, 63 - 15, 0), false);
  assert.equal(grid.isSolid(0, 63 - 43, 0), false);
  assert.equal(grid.isSolid(0, 63 - 44, 0), true);
  assert.equal(grid.isSolid(0, 0, 0), true);
});

test('full 512x512x64 standard headerless AoS .vxl parses and meshes quickly', () => {
  const totalCols = 512 * 512;
  const chunks: number[] = [];
  for (let i = 0; i < totalCols; i++) {
    if (i % 13 === 0) {
      chunks.push(0, 44, 43, 0);
    } else {
      chunks.push(0, 60, 60, 0, 140, 110, 60, 128);
    }
  }
  const exactBuf = new Uint8Array(chunks);
  const grid = parseVxl(exactBuf);
  assert.equal(grid.width, 512);
  assert.equal(grid.depth, 512);
  assert.equal(grid.height, 64);
  const built = buildVoxelGeometry(grid);
  assert.ok(built.quadCount > 1000);
  built.geometry.dispose();
});

test('upscaled export dimensions preserve aspect ratio from display res up to 16K', () => {
  const same = computeUpscaledDimensions(1440, 900, 1000);
  assert.equal(same.width, 1440);
  assert.equal(same.height, 900);
  assert.equal(same.scale, 1);

  const max16k = computeUpscaledDimensions(1440, 900, 20000);
  assert.equal(max16k.width, MAX_EXPORT_LONG_EDGE);
  assert.equal(max16k.height, 9600);
  assert.equal(formatResolutionLabel(max16k.width, max16k.height), '15360×9600 (16K)');

  const portrait16k = computeUpscaledDimensions(390, 844, 20000);
  assert.ok(portrait16k.height <= MAX_EXPORT_LONG_EDGE);
  assert.ok(portrait16k.width < portrait16k.height);
});

test('export tiling covers full target dimensions without gaps or overflow', () => {
  const tiles = computeExportTiles(5000, 3000, 2048);
  assert.equal(tiles.length, 6);
  const coveredArea = tiles.reduce((sum, t) => sum + t.width * t.height, 0);
  assert.equal(coveredArea, 5000 * 3000);
  assert.deepEqual(tiles[tiles.length - 1], { x: 4096, y: 2048, width: 904, height: 952 });
});

