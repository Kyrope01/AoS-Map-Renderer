import { VoxelGrid, VoxelParseError } from './types';

const KV6_MAGIC = 0x6c78764b; // "Kvxl" little-endian

export interface Kv6VoxelInput {
  /** Voxlap X (0..xsiz-1) */
  x: number;
  /** Voxlap Y (0..ysiz-1) */
  y: number;
  /** Voxlap Z (0..zsiz-1, 0 = top) */
  z: number;
  r: number;
  g: number;
  b: number;
  a?: number;
  vis?: number;
  dir?: number;
}

/**
 * Dense or sparse VoxelGrid backed by a flat Uint32Array when grid volume <= 8M,
 * or open-addressed typed hash table for gigantic bounding boxes.
 */
class Kv6Grid implements VoxelGrid {
  readonly format = 'kv6' as const;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly voxelCount: number;
  readonly pivot: readonly [number, number, number];
  readonly waterColor: number | null = null;

  private readonly dense: Uint32Array | null;
  private readonly sparseKeys: Int32Array | null;
  private readonly sparseVals: Uint32Array | null;
  private readonly sparseMask: number;

  constructor(
    width: number,
    height: number,
    depth: number,
    pivot: [number, number, number],
    voxelCount: number,
    dense: Uint32Array | null,
    sparseKeys: Int32Array | null,
    sparseVals: Uint32Array | null,
    sparseMask: number,
  ) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.pivot = pivot;
    this.voxelCount = voxelCount;
    this.dense = dense;
    this.sparseKeys = sparseKeys;
    this.sparseVals = sparseVals;
    this.sparseMask = sparseMask;
  }

  private lookupSparse(key: number): number {
    const keys = this.sparseKeys!;
    const vals = this.sparseVals!;
    const mask = this.sparseMask;
    let slot = Math.imul(key ^ (key >>> 16), 0x45d9f3b) & mask;
    while (true) {
      const k = keys[slot];
      if (k === key) return vals[slot];
      if (k === -1) return 0;
      slot = (slot + 1) & mask;
    }
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.getColor(x, y, z) !== 0;
  }

  getColor(x: number, y: number, z: number): number {
    if (
      x < 0 ||
      x >= this.width ||
      y < 0 ||
      y >= this.height ||
      z < 0 ||
      z >= this.depth
    ) {
      return 0;
    }
    const idx = (y * this.depth + z) * this.width + x;
    if (this.dense) {
      return this.dense[idx];
    }
    return this.lookupSparse(idx);
  }
}

/**
 * Parses a Voxlap / Ace of Spades `.kv6` binary buffer into a Y-up Three.js VoxelGrid.
 */
export function parseKv6(buffer: ArrayBuffer | Uint8Array): VoxelGrid {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 32) {
    throw new VoxelParseError('File is too small to be a valid .kv6 model (minimum 32 bytes).');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== KV6_MAGIC) {
    throw new VoxelParseError('Invalid .kv6 signature: expected "Kvxl" magic header.');
  }

  const xsiz = view.getUint32(4, true);
  const ysiz = view.getUint32(8, true);
  const zsiz = view.getUint32(12, true);

  if (
    xsiz === 0 ||
    ysiz === 0 ||
    zsiz === 0 ||
    xsiz > 2048 ||
    ysiz > 2048 ||
    zsiz > 2048
  ) {
    throw new VoxelParseError(`Invalid .kv6 dimensions: ${xsiz}×${ysiz}×${zsiz}.`);
  }

  const xpiv = view.getFloat32(16, true);
  const ypiv = view.getFloat32(20, true);
  const zpiv = view.getFloat32(24, true);
  const numvoxs = view.getUint32(28, true);

  const voxelDataOffset = 32;
  const xoffsetOffset = voxelDataOffset + numvoxs * 8;
  const xyoffsetOffset = xoffsetOffset + xsiz * 4;
  const requiredBytes = xyoffsetOffset + xsiz * ysiz * 2;

  if (bytes.byteLength < requiredBytes) {
    throw new VoxelParseError(
      `Truncated .kv6 file: expected at least ${requiredBytes} bytes, got ${bytes.byteLength}.`,
    );
  }

  // Three.js mapping: X = x, Y (up) = (zsiz - 1) - z, Z = y
  const width = xsiz;
  const height = zsiz;
  const depth = ysiz;
  const volume = width * height * depth;

  const useDense = volume <= 8_388_608;
  let dense: Uint32Array | null = null;
  let sparseKeys: Int32Array | null = null;
  let sparseVals: Uint32Array | null = null;
  let sparseMask = 0;

  if (useDense) {
    dense = new Uint32Array(volume);
  } else {
    let cap = 1024;
    while (cap < numvoxs * 2) cap <<= 1;
    sparseKeys = new Int32Array(cap).fill(-1);
    sparseVals = new Uint32Array(cap);
    sparseMask = cap - 1;
  }

  const insertSparse = (key: number, val: number) => {
    const keys = sparseKeys!;
    const vals = sparseVals!;
    let slot = Math.imul(key ^ (key >>> 16), 0x45d9f3b) & sparseMask;
    while (true) {
      const k = keys[slot];
      if (k === -1 || k === key) {
        keys[slot] = key;
        vals[slot] = val;
        return;
      }
      slot = (slot + 1) & sparseMask;
    }
  };

  let voxCursor = 0;
  for (let x = 0; x < xsiz; x++) {
    for (let y = 0; y < ysiz; y++) {
      const colCount = view.getUint16(xyoffsetOffset + (x * ysiz + y) * 2, true);
      if (voxCursor + colCount > numvoxs) {
        throw new VoxelParseError(
          `Corrupt .kv6 column table: column (${x}, ${y}) exceeds numvoxs (${numvoxs}).`,
        );
      }
      for (let i = 0; i < colCount; i++) {
        const off = voxelDataOffset + (voxCursor + i) * 8;
        const b = bytes[off];
        const g = bytes[off + 1];
        const r = bytes[off + 2];
        const zRaw = view.getUint16(off + 4, true);
        if (zRaw < zsiz) {
          const gx = x;
          const gy = zsiz - 1 - zRaw;
          const gz = y;
          const idx = (gy * depth + gz) * width + gx;
          const packed = (0xff << 24) | (r << 16) | (g << 8) | b;
          if (dense) {
            dense[idx] = packed;
          } else {
            insertSparse(idx, packed);
          }
        }
      }
      voxCursor += colCount;
    }
  }

  return new Kv6Grid(
    width,
    height,
    depth,
    [xpiv, zsiz - 1 - zpiv, ypiv],
    numvoxs,
    dense,
    sparseKeys,
    sparseVals,
    sparseMask,
  );
}

/**
 * Encodes voxel coordinates (in Voxlap coordinate space) into a valid `.kv6` binary buffer.
 */
export function encodeKv6(
  xsiz: number,
  ysiz: number,
  zsiz: number,
  voxels: Kv6VoxelInput[],
  pivot?: [number, number, number],
): Uint8Array {
  // Deduplicate and sort by (x, y, z) ascending as required by Voxlap .kv6
  const dedup = new Map<number, Kv6VoxelInput>();
  for (const v of voxels) {
    if (
      v.x < 0 ||
      v.x >= xsiz ||
      v.y < 0 ||
      v.y >= ysiz ||
      v.z < 0 ||
      v.z >= zsiz
    ) {
      continue;
    }
    const key = (v.x * ysiz + v.y) * zsiz + v.z;
    dedup.set(key, v);
  }

  const sorted = Array.from(dedup.values()).sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    return a.z - b.z;
  });

  // Build quick occupancy set for visibility face mask
  const isOccupied = (x: number, y: number, z: number): boolean => {
    if (x < 0 || x >= xsiz || y < 0 || y >= ysiz || z < 0 || z >= zsiz) {
      return false;
    }
    return dedup.has((x * ysiz + y) * zsiz + z);
  };

  const numvoxs = sorted.length;
  const totalSize = 32 + numvoxs * 8 + xsiz * 4 + xsiz * ysiz * 2;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, KV6_MAGIC, true);
  view.setUint32(4, xsiz, true);
  view.setUint32(8, ysiz, true);
  view.setUint32(12, zsiz, true);
  view.setFloat32(16, pivot ? pivot[0] : xsiz * 0.5, true);
  view.setFloat32(20, pivot ? pivot[1] : ysiz * 0.5, true);
  view.setFloat32(24, pivot ? pivot[2] : zsiz * 0.5, true);
  view.setUint32(28, numvoxs, true);

  const xoffset = new Uint32Array(xsiz);
  const xyoffset = new Uint16Array(xsiz * ysiz);

  for (let i = 0; i < numvoxs; i++) {
    const v = sorted[i];
    const off = 32 + i * 8;
    out[off] = v.b & 0xff;
    out[off + 1] = v.g & 0xff;
    out[off + 2] = v.r & 0xff;
    out[off + 3] = v.a ?? 128;
    view.setUint16(off + 4, v.z, true);

    let vis = v.vis;
    if (vis === undefined) {
      vis = 0;
      if (!isOccupied(v.x - 1, v.y, v.z)) vis |= 1;
      if (!isOccupied(v.x + 1, v.y, v.z)) vis |= 2;
      if (!isOccupied(v.x, v.y - 1, v.z)) vis |= 4;
      if (!isOccupied(v.x, v.y + 1, v.z)) vis |= 8;
      if (!isOccupied(v.x, v.y, v.z - 1)) vis |= 16;
      if (!isOccupied(v.x, v.y, v.z + 1)) vis |= 32;
    }
    out[off + 6] = vis;
    out[off + 7] = v.dir ?? 0;

    xoffset[v.x]++;
    xyoffset[v.x * ysiz + v.y]++;
  }

  const xOffBase = 32 + numvoxs * 8;
  for (let x = 0; x < xsiz; x++) {
    view.setUint32(xOffBase + x * 4, xoffset[x], true);
  }
  const xyOffBase = xOffBase + xsiz * 4;
  for (let i = 0; i < xsiz * ysiz; i++) {
    view.setUint16(xyOffBase + i * 2, xyoffset[i], true);
  }

  return out;
}
