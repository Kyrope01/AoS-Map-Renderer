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
