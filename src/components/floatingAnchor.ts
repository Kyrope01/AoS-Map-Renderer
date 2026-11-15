export interface VoxelScreenPos {
  x: number;
  y: number;
  visible: boolean;
}

export const VOXEL_LIGHT_PANEL_W = 232;
export const VOXEL_LIGHT_PANEL_H = 248;
export const VOXEL_LIGHT_PANEL_GAP = 28;

export const PLAYER_PANEL_W = 264;
export const PLAYER_PANEL_GAP = 76;

/**
 * Computes screen-space top-left coordinates for a floating editor anchored beside
 * an anchor point in the 3D viewport. Places the panel to the right with `gapX`
 * clearance when space permits (accounting for an open right sidebar via
 * `rightMargin`), flipping cleanly to the left when approaching the right edge.
 */
export function computeFloatingPanelCoords(
  screenX: number,
  screenY: number,
  panelW: number,
  panelH: number,
  gapX: number,
  viewportW: number,
  viewportH: number,
  rightMargin = 12,
): { left: number; top: number } {
  const margin = 12;
  const usableRight = Math.max(margin, viewportW - rightMargin);
  const fitsRightBeforeSidebar = screenX + gapX + panelW <= usableRight;
  const fitsRightViewport = screenX + gapX + panelW <= viewportW - margin;
  const fitsLeft = screenX - gapX - panelW >= margin;
  const placeRight = fitsRightBeforeSidebar || (!fitsLeft && fitsRightViewport);
  const left = placeRight
    ? Math.min(Math.max(margin, viewportW - panelW - margin), screenX + gapX)
    : Math.max(margin, screenX - panelW - gapX);
  const top = Math.min(
    Math.max(margin + 8, screenY - panelH * 0.48),
    Math.max(margin, viewportH - panelH - margin),
  );
  return { left, top };
}
