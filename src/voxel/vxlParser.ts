import { VoxelGrid, VoxelParseError } from './types';

export const AOS_VXL_WIDTH = 512;
export const AOS_VXL_DEPTH = 512;
export const AOS_VXL_HEIGHT = 64;

/** Classic Ace of Spades underground dirt base RGB (0x67, 0x40, 0x28). */
const DIRT_R = 103;
const DIRT_G = 64;
const DIRT_B = 40;

function dirtColorAt(x: number, y: number, z: number): number {
  const hash = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 15;
  const delta = hash - 8;
  const r = Math.max(0, Math.min(255, DIRT_R + delta));
  const g = Math.max(0, Math.min(255, DIRT_G + (delta >> 1)));
  const b = Math.max(0, Math.min(255, DIRT_B + (delta >> 1)));
  return (0xff << 24) | (r << 16) | (g << 8) | b;
}

export interface SerializedVxlGrid {
  format: 'vxl';
  width: number;
  height: number;
  depth: number;
  voxelCount: number;
  waterColor: number | null;
  solidLo: Uint32Array;
  solidHi: Uint32Array;
  colStart: Uint32Array;
  colCount: Uint8Array;
  surfGy: Uint8Array;
  surfColor: Uint32Array;
}

/**
 * Compact 64-bit-per-column VoxelGrid for Ace of Spades `.vxl` maps.
 * Uses two Uint32 masks per (x, z) column for O(1) solid checks and stores
 * only explicit surface colors in a flat packed list per column.
 */
export class VxlGrid implements VoxelGrid {
  readonly format = 'vxl' as const;
  readonly width: number;
  readonly height: number; // Always <= 64 (AoS = 64)
  readonly depth: number;
  readonly voxelCount: number;
  readonly pivot: readonly [number, number, number];
  readonly waterColor: number | null;

  /** Bitmask for gy = 0..31 (gy = 63 - aosZ) */
  readonly solidLo: Uint32Array;
  /** Bitmask for gy = 32..63 */
  readonly solidHi: Uint32Array;

  readonly colStart: Uint32Array;
  readonly colCount: Uint8Array;
  readonly surfGy: Uint8Array;
  readonly surfColor: Uint32Array;

  constructor(
    width: number,
    height: number,
    depth: number,
    voxelCount: number,
    waterColor: number | null,
    solidLo: Uint32Array,
    solidHi: Uint32Array,
    colStart: Uint32Array,
    colCount: Uint8Array,
    surfGy: Uint8Array,
    surfColor: Uint32Array,
  ) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.voxelCount = voxelCount;
    this.waterColor = waterColor;
    this.pivot = [width * 0.5, 0, depth * 0.5];
    this.solidLo = solidLo;
    this.solidHi = solidHi;
    this.colStart = colStart;
    this.colCount = colCount;
    this.surfGy = surfGy;
    this.surfColor = surfColor;
  }

  isSolid(x: number, y: number, z: number): boolean {
    if (
      x < 0 ||
      x >= this.width ||
      y < 0 ||
      y >= this.height ||
      z < 0 ||
      z >= this.depth
    ) {
      return false;
    }
    const colIdx = z * this.width + x;
    if (y < 32) {
      return ((this.solidLo[colIdx] >>> y) & 1) !== 0;
    }
    return ((this.solidHi[colIdx] >>> (y - 32)) & 1) !== 0;
  }

  /** Fast lookup when the caller already verified `(x, y, z)` is solid and knows `colIdx`. */
  getColorAtSolid(colIdx: number, x: number, y: number, z: number): number {
    const start = this.colStart[colIdx];
    const end = start + this.colCount[colIdx];
    const gyArr = this.surfGy;
    for (let i = start; i < end; i++) {
      if (gyArr[i] === y) {
        return this.surfColor[i];
      }
    }
    return dirtColorAt(x, y, z);
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
    const colIdx = z * this.width + x;
    const solid =
      y < 32
        ? ((this.solidLo[colIdx] >>> y) & 1) !== 0
        : ((this.solidHi[colIdx] >>> (y - 32)) & 1) !== 0;
    if (!solid) return 0;
    return this.getColorAtSolid(colIdx, x, y, z);
  }

  toSerialized(): SerializedVxlGrid {
    return {
      format: 'vxl',
      width: this.width,
      height: this.height,
      depth: this.depth,
      voxelCount: this.voxelCount,
      waterColor: this.waterColor,
      solidLo: this.solidLo,
      solidHi: this.solidHi,
      colStart: this.colStart,
      colCount: this.colCount,
      surfGy: this.surfGy,
      surfColor: this.surfColor,
    };
  }
}

export function hydrateVxlGrid(data: SerializedVxlGrid): VxlGrid {
  return new VxlGrid(
    data.width,
    data.height,
    data.depth,
    data.voxelCount,
    data.waterColor,
    data.solidLo,
    data.solidHi,
    data.colStart,
    data.colCount,
    data.surfGy,
    data.surfColor,
  );
}

export interface VxlParseOptions {
  width?: number;
  depth?: number;
  height?: number;
}

export const AOS_VXL_MAX_DIMENSION = 4096;

/**
 * Parses an Ace of Spades (2011) / Voxlap column-RLE `.vxl` file.
 * Default dimensions are 512 × 512 × 64 (standard headerless AoS v0.75 format).
 */
export function parseVxl(
  buffer: ArrayBuffer | Uint8Array,
  options: VxlParseOptions = {},
): VxlGrid {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const byteLen = bytes.byteLength;
  const width = options.width ?? AOS_VXL_WIDTH;
  const depth = options.depth ?? AOS_VXL_DEPTH;
  const height = options.height ?? AOS_VXL_HEIGHT;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(depth) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    depth <= 0 ||
    height <= 0 ||
    width > AOS_VXL_MAX_DIMENSION ||
    depth > AOS_VXL_MAX_DIMENSION
  ) {
    throw new VoxelParseError(
      `Invalid .vxl dimensions ${width}×${depth}×${height}: width and depth must be 1..${AOS_VXL_MAX_DIMENSION}, height 1..64.`,
    );
  }

  if (height > 64) {
    throw new VoxelParseError(`Invalid .vxl height ${height}: must be 1..64.`);
  }

  const totalColumns = width * depth;
  if (byteLen < totalColumns * 4) {
    throw new VoxelParseError(
      `File is too small to be a ${width}×${depth} .vxl map (expected at least ${totalColumns * 4} bytes, got ${byteLen}).`,
    );
  }

  const solidLo = new Uint32Array(totalColumns);
  const solidHi = new Uint32Array(totalColumns);
  const colStart = new Uint32Array(totalColumns);
  const colCount = new Uint8Array(totalColumns);

  // Pre-estimate surface voxel storage (grows dynamically if needed)
  let surfCap = Math.max(4096, totalColumns * 2);
  let surfGy = new Uint8Array(surfCap);
  let surfColor = new Uint32Array(surfCap);
  let surfLen = 0;

  // Reusable scratch buffer for overhang bottom colors (avoids per-span array allocations).
  // A column is at most `height` (<= 64) voxels tall, and a bottom color run can
  // never be longer than the column, so this always fits a valid file.
  const pendingBottomBuf = new Uint32Array(height);
  let pendingBottomLen = 0;

  const growSurface = () => {
    const nextCap = surfCap * 2;
    const nextGy = new Uint8Array(nextCap);
    const nextCol = new Uint32Array(nextCap);
    nextGy.set(surfGy);
    nextCol.set(surfColor);
    surfGy = nextGy;
    surfColor = nextCol;
    surfCap = nextCap;
  };

  let pos = 0;
  let voxelCount = 0;
  const hMinus1 = height - 1;

  // Ace of Spades column order: outer y (depth / gz), inner x (width / gx)
  for (let gz = 0; gz < depth; gz++) {
    const rowBase = gz * width;
    for (let gx = 0; gx < width; gx++) {
      const colIdx = rowBase + gx;
      colStart[colIdx] = surfLen;

      let airStart = 0;
      pendingBottomLen = 0;
      let colLo = 0;
      let colHi = 0;

      while (true) {
        if (pos + 4 > byteLen) {
          throw new VoxelParseError(
            `Unexpected end of .vxl file at column (${gx}, ${gz}), byte ${pos}.`,
          );
        }

        const numChunks = bytes[pos];
        const topStart = bytes[pos + 1];
        const topEnd = bytes[pos + 2];
        const spanAirStart = bytes[pos + 3];
        pos += 4;

        // If previous span had bottom-facing surface colors, they end at spanAirStart - 1
        if (pendingBottomLen > 0) {
          const bLen = pendingBottomLen;
          const bStart = spanAirStart - bLen;
          if (bStart < 0 || spanAirStart > height) {
            throw new VoxelParseError(
              `Corrupt .vxl bottom span geometry at column (${gx}, ${gz}).`,
            );
          }
          const solidEnd = airStart > bStart ? airStart : bStart;
          for (let z = airStart; z < solidEnd; z++) {
            const gy = hMinus1 - z;
            if (gy < 32) colLo |= 1 << gy;
            else colHi |= 1 << (gy - 32);
            voxelCount++;
          }
          for (let i = 0; i < bLen; i++) {
            const z = bStart + i;
            const gy = hMinus1 - z;
            if (gy < 32) colLo |= 1 << gy;
            else colHi |= 1 << (gy - 32);
            if (surfLen >= surfCap) growSurface();
            surfGy[surfLen] = gy;
            surfColor[surfLen] = pendingBottomBuf[i];
            surfLen++;
            voxelCount++;
          }
          pendingBottomLen = 0;
        }

        // Real AoS .vxl files can emit topEnd = topStart - 1 (e.g. [44, 43]) for a 0-length top color run
        const isZeroTopWrap = topStart === 0 && topEnd === 255;
        const effectiveTopEnd = isZeroTopWrap ? -1 : topEnd;

        if (
          !isZeroTopWrap &&
          (topEnd >= height || topStart > height || topEnd < topStart - 1)
        ) {
          throw new VoxelParseError(
            `Invalid .vxl span range [${topStart}, ${topEnd}] at column (${gx}, ${gz}).`,
          );
        }

        const lenTop = isZeroTopWrap ? 0 : topEnd - topStart + 1;
        if (numChunks !== 0 && numChunks < 1 + lenTop) {
          throw new VoxelParseError(
            `Invalid .vxl chunk count (${numChunks}) for span length ${lenTop} at (${gx}, ${gz}).`,
          );
        }

        const colorBytesNeeded = lenTop * 4;
        if (pos + colorBytesNeeded > byteLen) {
          throw new VoxelParseError(
            `Truncated .vxl top color data at column (${gx}, ${gz}).`,
          );
        }

        for (let z = topStart; z <= effectiveTopEnd; z++) {
          const b = bytes[pos];
          const g = bytes[pos + 1];
          const r = bytes[pos + 2];
          pos += 4;
          const gy = hMinus1 - z;
          if (gy < 32) colLo |= 1 << gy;
          else colHi |= 1 << (gy - 32);
          if (surfLen >= surfCap) growSurface();
          surfGy[surfLen] = gy;
          surfColor[surfLen] = (0xff << 24) | (r << 16) | (g << 8) | b;
          surfLen++;
          voxelCount++;
        }

        if (numChunks === 0) {
          // Final span: remaining voxels down to height - 1 are solid underground dirt
          for (let z = effectiveTopEnd + 1; z < height; z++) {
            const gy = hMinus1 - z;
            if (gy < 32) colLo |= 1 << gy;
            else colHi |= 1 << (gy - 32);
            voxelCount++;
          }
          break;
        }

        const lenBottom = numChunks - 1 - lenTop;
        if (lenBottom > height) {
          // `numChunks` is a single byte, so a corrupt value can claim up to 254
          // bottom colors. Typed-array writes past the end are silent no-ops, so
          // without this check the column would silently lose its surface colors.
          throw new VoxelParseError(
            `Invalid .vxl chunk count (${numChunks}) at column (${gx}, ${gz}): more spans than the ${height}-voxel column can hold.`,
          );
        }
        if (pos + lenBottom * 4 > byteLen) {
          throw new VoxelParseError(
            `Truncated .vxl bottom color data at column (${gx}, ${gz}).`,
          );
        }

        airStart = effectiveTopEnd + 1;
        pendingBottomLen = lenBottom;
        for (let i = 0; i < lenBottom; i++) {
          const b = bytes[pos];
          const g = bytes[pos + 1];
          const r = bytes[pos + 2];
          pos += 4;
          pendingBottomBuf[i] = (0xff << 24) | (r << 16) | (g << 8) | b;
        }
      }

      solidLo[colIdx] = colLo;
      solidHi[colIdx] = colHi;
      const count = surfLen - colStart[colIdx];
      colCount[colIdx] = count > 255 ? 255 : count;
    }
  }

  // Detect dominant exposed water-level (gy === 0 / aosZ === height - 1) color,
  // prioritizing outer map border columns where AoS ocean water resides.
  const borderHist = new Map<number, number>();
  const interiorHist = new Map<number, number>();
  const borderPad = Math.min(8, Math.floor(Math.min(width, depth) / 4));
  for (let gz = 0; gz < depth; gz++) {
    const isZBorder = gz < borderPad || gz >= depth - borderPad;
    const rowBase = gz * width;
    for (let gx = 0; gx < width; gx++) {
      const colIdx = rowBase + gx;
      // gy=0 is solid AND gy=1 is air -> exposed water/floor surface
      if ((solidLo[colIdx] & 3) !== 1) continue;
      const start = colStart[colIdx];
      const count = colCount[colIdx];
      for (let i = 0; i < count; i++) {
        if (surfGy[start + i] === 0) {
          const rgb = surfColor[start + i] & 0xffffff;
          if (isZBorder || gx < borderPad || gx >= width - borderPad) {
            borderHist.set(rgb, (borderHist.get(rgb) ?? 0) + 1);
          } else {
            interiorHist.set(rgb, (interiorHist.get(rgb) ?? 0) + 1);
          }
          break;
        }
      }
    }
  }

  let waterColor: number | null = null;
  const pickTopColor = (hist: Map<number, number>): number | null => {
    let bestCol: number | null = null;
    let bestCount = 0;
    for (const [col, cnt] of hist.entries()) {
      if (cnt > bestCount) {
        bestCount = cnt;
        bestCol = col;
      }
    }
    return bestCol !== null ? (0xff << 24) | bestCol : null;
  };

  if (borderHist.size > 0) {
    waterColor = pickTopColor(borderHist);
  } else if (interiorHist.size > 0) {
    waterColor = pickTopColor(interiorHist);
  }

  return new VxlGrid(
    width,
    height,
    depth,
    voxelCount,
    waterColor,
    solidLo,
    solidHi,
    colStart,
    colCount,
    surfGy.slice(0, surfLen),
    surfColor.slice(0, surfLen),
  );
}

/**
 * Encodes a 3D color grid (0 = air, 0xFFRRGGBB = solid) into an authentic
 * Ace of Spades `.vxl` column-RLE binary buffer.
 */
export function encodeVxl(
  width: number,
  depth: number,
  height: number,
  getVoxel: (gx: number, gy: number, gz: number) => number,
): Uint8Array {
  const out: number[] = [];

  const isSolidAt = (gx: number, aosZ: number, gz: number): boolean => {
    if (aosZ < 0 || aosZ >= height) return false;
    const gy = height - 1 - aosZ;
    return getVoxel(gx, gy, gz) !== 0;
  };

  const isExposed = (gx: number, aosZ: number, gz: number): boolean => {
    if (!isSolidAt(gx, aosZ, gz)) return false;
    if (aosZ === 0) return true;
    if (!isSolidAt(gx, aosZ - 1, gz)) return true;
    if (aosZ + 1 < height && !isSolidAt(gx, aosZ + 1, gz)) return true;
    if (gx > 0 && !isSolidAt(gx - 1, aosZ, gz)) return true;
    if (gx + 1 < width && !isSolidAt(gx + 1, aosZ, gz)) return true;
    if (gz > 0 && !isSolidAt(gx, aosZ, gz - 1)) return true;
    if (gz + 1 < depth && !isSolidAt(gx, aosZ, gz + 1)) return true;
    return false;
  };

  const pushColor = (gx: number, aosZ: number, gz: number) => {
    const gy = height - 1 - aosZ;
    const c = getVoxel(gx, gy, gz);
    const r = (c >>> 16) & 0xff;
    const g = (c >>> 8) & 0xff;
    const b = c & 0xff;
    out.push(b, g, r, 0x7f);
  };

  for (let gz = 0; gz < depth; gz++) {
    for (let gx = 0; gx < width; gx++) {
      let z = 0;
      while (z < height) {
        const airStart = z;
        while (z < height && !isSolidAt(gx, z, gz)) z++;
        if (z >= height) {
          // The column ends in air (all-air column, or air beneath an overhang).
          // Emit a zero-chunk span with an empty top run: `topStart === height`
          // reads back as a zero-length final span, so no phantom bottom voxel
          // is invented. `airStart` still carries the position that the parser
          // needs to place a pending overhang bottom color run.
          out.push(0, height, height - 1, airStart);
          break;
        }
        const topStart = z;
        while (z < height && isExposed(gx, z, gz)) z++;
        const topEnd = z - 1;

        while (z < height && isSolidAt(gx, z, gz)) z++;

        if (z === height) {
          out.push(0, topStart, topEnd, airStart);
          for (let tz = topStart; tz <= topEnd; tz++) {
            pushColor(gx, tz, gz);
          }
          break;
        }

        let botStart = z;
        while (botStart > topEnd + 1 && isExposed(gx, botStart - 1, gz)) {
          botStart--;
        }
        const lenTop = topEnd - topStart + 1;
        const lenBot = z - botStart;
        const numChunks = 1 + lenTop + lenBot;

        out.push(numChunks, topStart, topEnd, airStart);
        for (let tz = topStart; tz <= topEnd; tz++) {
          pushColor(gx, tz, gz);
        }
        for (let bz = botStart; bz < z; bz++) {
          pushColor(gx, bz, gz);
        }
      }
    }
  }

  return new Uint8Array(out);
}
