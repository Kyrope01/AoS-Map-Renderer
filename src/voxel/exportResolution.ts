export const MAX_EXPORT_LONG_EDGE = 15360; // 16K UHD horizontal resolution

export interface ExportDimensions {
  width: number;
  height: number;
  maxWidth: number;
  scale: number;
}

export interface ExportTile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getMaxExportWidth(baseWidth: number, baseHeight: number): number {
  const safeW = Math.max(1, Math.round(baseWidth));
  const safeH = Math.max(1, Math.round(baseHeight));
  if (safeW >= safeH) {
    return Math.max(safeW, MAX_EXPORT_LONG_EDGE);
  }
  return Math.max(safeW, Math.floor((MAX_EXPORT_LONG_EDGE * safeW) / safeH));
}

export function computeUpscaledDimensions(
  baseWidth: number,
  baseHeight: number,
  requestedWidth: number,
): ExportDimensions {
  const safeW = Math.max(1, Math.round(baseWidth));
  const safeH = Math.max(1, Math.round(baseHeight));
  const maxWidth = getMaxExportWidth(safeW, safeH);
  const width = Math.min(maxWidth, Math.max(safeW, Math.round(requestedWidth)));
  const rawHeight = Math.max(1, Math.round((width * safeH) / safeW));
  const height = safeH > safeW ? Math.min(MAX_EXPORT_LONG_EDGE, rawHeight) : rawHeight;
  return {
    width,
    height,
    maxWidth,
    scale: width / safeW,
  };
}

export function formatResolutionLabel(width: number, height: number): string {
  const longest = Math.max(width, height);
  let tag = '';
  if (longest >= 15000) tag = '16K';
  else if (longest >= 7500) tag = '8K';
  else if (longest >= 3800) tag = '4K';
  else if (longest >= 2500) tag = '2.5K';
  return tag ? `${width}×${height} (${tag})` : `${width}×${height}`;
}

// ~21 B/px for the composer's two half-float targets + bloom mips.
// 16.8 MP keeps the transient allocation under ~400 MB.
export const SINGLE_PASS_MAX_PIXELS = 4096 * 4096;

export function canUseSinglePassExport(
  targetW: number,
  targetH: number,
  maxTex: number,
  maxRb: number,
  hasComposer: boolean,
  isSoftwareGl: boolean,
): boolean {
  return (
    hasComposer &&
    !isSoftwareGl &&
    targetW <= maxTex &&
    targetH <= maxRb &&
    targetW * targetH <= SINGLE_PASS_MAX_PIXELS
  );
}

export function computeExportTiles(
  totalWidth: number,
  totalHeight: number,
  maxTileSize: number,
): ExportTile[] {
  const cap = Math.max(64, Math.floor(maxTileSize));
  const tiles: ExportTile[] = [];
  for (let y = 0; y < totalHeight; y += cap) {
    const height = Math.min(cap, totalHeight - y);
    for (let x = 0; x < totalWidth; x += cap) {
      const width = Math.min(cap, totalWidth - x);
      tiles.push({ x, y, width, height });
    }
  }
  return tiles;
}
