import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeKv6, hydrateKv6Grid, parseKv6 } from './kv6Parser';
import { encodeVxl, hydrateVxlGrid, parseVxl } from './vxlParser';
import { buildVoxelGeometry, buildVoxelGeometryData, hydrateVoxelGeometry } from './mesher';
import { buildVoxelShadowData } from '../renderer/voxelShadows';
import {
  canUseSinglePassExport,
  computeExportTiles,
  computeUpscaledDimensions,
  formatResolutionLabel,
  MAX_EXPORT_LONG_EDGE,
  SINGLE_PASS_MAX_PIXELS,
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

test('vxl encode -> parse round-trip never invents voxels in all-air columns', () => {
  const W = 4;
  const D = 4;
  const H = 16;
  const voxels = new Uint32Array(W * D * H);
  const set = (x: number, y: number, z: number, r: number, g: number, b: number) => {
    voxels[(y * D + z) * W + x] = (0xff << 24) | (r << 16) | (g << 8) | b;
  };

  // Column (0, 0): completely empty.
  // Column (1, 0): solid ground with an overhang and open air underneath it.
  set(1, 0, 0, 103, 64, 40);
  set(1, 4, 0, 200, 120, 50);
  // Every other column keeps a normal crown so the map is not degenerate.
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      if ((x === 0 && z === 0) || (x === 1 && z === 0)) continue;
      set(x, 0, z, 90, 140, 70);
    }
  }

  const getVoxel = (gx: number, gy: number, gz: number) => voxels[(gy * D + gz) * W + gx];
  const grid = parseVxl(encodeVxl(W, D, H, getVoxel), { width: W, depth: D, height: H });

  for (let gy = 0; gy < H; gy++) {
    for (let gz = 0; gz < D; gz++) {
      for (let gx = 0; gx < W; gx++) {
        assert.equal(
          grid.isSolid(gx, gy, gz),
          getVoxel(gx, gy, gz) !== 0,
          `voxel (${gx}, ${gy}, ${gz}) should round-trip unchanged`,
        );
      }
    }
  }

  // The air gap under the overhang stays empty, and the overhang survives.
  assert.equal(grid.isSolid(1, 2, 0), false);
  assert.equal(grid.isSolid(1, 4, 0), true);
});

test('vxl parser rejects bottom color runs longer than the column height', () => {
  // numChunks = 20 with an empty top run claims 19 bottom colors in a 16-voxel column.
  const buf = new Uint8Array([20, 0, 255, 0]);
  assert.throws(
    () => parseVxl(buf, { width: 1, depth: 1, height: 16 }),
    VoxelParseError,
  );
});

test('vxl parser rejects zero-sized dimensions instead of returning an empty grid', () => {
  assert.throws(
    () => parseVxl(new Uint8Array(16), { width: 0, depth: 4 }),
    VoxelParseError,
  );
});

test('vxl encoder never invents solidity in random columns (fuzz)', () => {
  // Deterministic PRNG so a failure is reproducible.
  let seed = 0x5eed1234;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (const H of [5, 16, 64]) {
    for (let trial = 0; trial < 25; trial++) {
      const W = 4 + Math.floor(rnd() * 4);
      const D = 4 + Math.floor(rnd() * 4);
      const voxels = new Uint32Array(W * D * H);
      const density = 0.2 + rnd() * 0.6;
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < D; z++) {
          for (let x = 0; x < W; x++) {
            if (rnd() < density * (y === 0 ? 1 : 0.65)) {
              voxels[(y * D + z) * W + x] =
                (0xff << 24) |
                (((x * 40 + 7) & 0xff) << 16) |
                (((y * 11 + 3) & 0xff) << 8) |
                ((z * 70 + 5) & 0xff);
            }
          }
        }
      }

      const get = (gx: number, gy: number, gz: number) => voxels[(gy * D + gz) * W + gx];
      const grid = parseVxl(encodeVxl(W, D, H, get), { width: W, depth: D, height: H });

      for (let y = 0; y < H; y++) {
        for (let z = 0; z < D; z++) {
          for (let x = 0; x < W; x++) {
            assert.equal(
              grid.isSolid(x, y, z),
              get(x, y, z) !== 0,
              `solidity mismatch at (${x}, ${y}, ${z}) in a ${W}×${D}×${H} map (trial ${trial})`,
            );
          }
        }
      }
      let solidCount = 0;
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < D; z++) {
          for (let x = 0; x < W; x++) if (get(x, y, z) !== 0) solidCount++;
        }
      }
      let reportedCount = 0;
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < D; z++) {
          for (let x = 0; x < W; x++) if (grid.isSolid(x, y, z)) reportedCount++;
        }
      }
      assert.equal(reportedCount, solidCount, 'parsed solid count must match the source map');
    }
  }
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


test('kv6 sparse hash path keeps every voxel in volumes above the dense threshold', () => {
  // 256×256×256 = 16.7M voxels > 8M, so parseKv6 uses the open-addressed table.
  const X = 256;
  const Y = 256;
  const Z = 256;
  const voxels = [
    { x: 0, y: 0, z: 0, r: 10, g: 20, b: 30 },
    { x: X - 1, y: Y - 1, z: Z - 1, r: 200, g: 150, b: 100 },
    { x: 17, y: 200, z: 3, r: 7, g: 8, b: 9 },
  ];
  const buf = encodeKv6(X, Y, Z, voxels);
  const grid = parseKv6(buf);

  assert.equal(grid.voxelCount, 3);
  for (const voxel of voxels) {
    const gy = Z - 1 - voxel.z;
    const color = grid.getColor(voxel.x, gy, voxel.y);
    assert.deepEqual(
      [(color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff],
      [voxel.r, voxel.g, voxel.b],
      `sparse voxel ${voxel.x},${voxel.y},${voxel.z} should survive the round-trip`,
    );
  }

  const visited: string[] = [];
  grid.forEachSolid?.((x, y, z) => visited.push(`${x},${y},${z}`));
  assert.equal(visited.length, 3);
});

test('kv6 voxelCount ignores skipped and duplicate voxels', () => {
  const buf = encodeKv6(4, 4, 4, [
    { x: 1, y: 1, z: 1, r: 1, g: 2, b: 3 },
    { x: 1, y: 1, z: 1, r: 9, g: 9, b: 9 }, // duplicate cell, last wins
  ]);
  const grid = parseKv6(buf);
  assert.equal(grid.voxelCount, 1);
  // Packed colors are unsigned once stored in a Uint32Array.
  assert.equal(grid.getColor(1, 2, 1) >>> 0, (0xff000000 | (9 << 16) | (9 << 8) | 9) >>> 0);
});

test('kv6 vis-mask sets 1 for exposed faces (63 for isolated voxel, clears shared faces)', () => {
  const isolated = encodeKv6(3, 3, 3, [{ x: 1, y: 1, z: 1, r: 255, g: 0, b: 0 }]);
  assert.equal(isolated[38], 63);

  const adjacent = encodeKv6(3, 3, 3, [
    { x: 0, y: 1, z: 1, r: 255, g: 0, b: 0 },
    { x: 1, y: 1, z: 1, r: 0, g: 255, b: 0 },
  ]);
  // Sorted (x,y,z): first voxel has +x occupied (clears bit 2 -> 61), second has -x occupied (clears bit 1 -> 62).
  assert.equal(adjacent[38], 61);
  assert.equal(adjacent[46], 62);
});

test('single-pass export enforces pixel area cap even when GPU allows 16K dimensions', () => {
  assert.equal(SINGLE_PASS_MAX_PIXELS, 4096 * 4096);
  // 4K (8.3 MP) keeps full composer post-FX
  assert.equal(canUseSinglePassExport(3840, 2160, 16384, 16384, true, false), true);
  // Exact 16.8 MP cap passes
  assert.equal(canUseSinglePassExport(4096, 4096, 16384, 16384, true, false), true);
  // 8K (33 MP) and 16K (147 MP) fall back to tiling even on 16K-capable GPUs
  assert.equal(canUseSinglePassExport(7680, 4320, 16384, 16384, true, false), false);
  assert.equal(canUseSinglePassExport(15360, 9600, 16384, 16384, true, false), false);
  // Software GL always tiles
  assert.equal(canUseSinglePassExport(3840, 2160, 16384, 16384, true, true), false);
});

test('kv6 and vxl serialize/hydrate cleanly for worker transfer alongside mesh and shadow atlas data', () => {
  const kv6Buf = encodeKv6(4, 4, 4, [{ x: 1, y: 2, z: 1, r: 100, g: 150, b: 200 }]);
  const kv6Orig = parseKv6(kv6Buf);
  const kv6Hydrated = hydrateKv6Grid(kv6Orig.toSerialized());
  assert.equal(kv6Hydrated.voxelCount, 1);
  assert.equal(kv6Hydrated.getColor(1, 2, 2), kv6Orig.getColor(1, 2, 2));

  const meshData = buildVoxelGeometryData(kv6Hydrated);
  const mesh = hydrateVoxelGeometry(meshData);
  assert.equal(mesh.quadCount, 6);
  mesh.geometry.dispose();

  const atlas = buildVoxelShadowData(kv6Hydrated, 4096);
  assert.ok(atlas.data.some((byte) => byte !== 0));

  const vxlOrig = parseVxl(
    encodeVxl(2, 2, 8, (_gx, gy, _gz) => (gy === 0 ? 0xff112233 : 0)),
    { width: 2, depth: 2, height: 8 },
  );
  const vxlHydrated = hydrateVxlGrid(vxlOrig.toSerialized());
  assert.equal(vxlHydrated.isSolid(1, 0, 1), true);
  assert.equal(vxlHydrated.isSolid(1, 1, 1), false);
  assert.equal(vxlHydrated.surfGy.byteOffset, 0);
  assert.equal(vxlHydrated.surfColor.byteOffset, 0);
});
