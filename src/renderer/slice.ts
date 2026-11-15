import * as THREE from 'three';
import { RegionBounds } from '../voxel/types';
import { SliceAxis } from '../voxel/types';

/**
 * three.js keeps the half-space where `plane.distanceToPoint(p) >= 0`, and
 * `distanceToPoint(p) = normal · p + constant`.
 *
 * Section slicing hides everything *above* the cut (`p[axis] <= cut`), so the
 * plane normal points down the negative axis and the plane's constant is the
 * cut coordinate: `-p[axis] + cut >= 0`.
 */
export const SLICE_PLANE_NORMAL = new THREE.Vector3(-1, 0, 0);

/** Vector component index of the sliced axis (x=0, y=1, z=2). */
export function sliceComponentIndex(axis: Exclude<SliceAxis, 'none'>): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

/**
 * Code used by the `uSliceAxis` shader uniform: 0 = off, 1 = x, 2 = y, 3 = z.
 * (Distinct from the vector component index — do not mix the two up.)
 */
export function sliceAxisCode(axis: SliceAxis): 0 | 1 | 2 | 3 {
  return axis === 'none' ? 0 : axis === 'x' ? 1 : axis === 'y' ? 2 : 3;
}

/**
 * Writes the section-slice plane for the given settings into `out`.
 *
 * @returns `true` when a slice is active and `out` was written, `false` when
 *          slicing is off (the caller should then clear `clippingPlanes`).
 */
export function computeSlicePlane(
  axis: SliceAxis,
  position: number,
  bounds: RegionBounds | THREE.Box3,
  out: THREE.Plane,
): boolean {
  if (axis === 'none') return false;

  const box = bounds instanceof THREE.Box3 ? bounds : toBox3(bounds);
  const index = sliceComponentIndex(axis);
  const min = box.min.getComponent(index);
  const max = box.max.getComponent(index);
  const cut = THREE.MathUtils.lerp(min, max, THREE.MathUtils.clamp(position, 0, 1));

  // Point the normal down the negative side of the sliced axis: three keeps
  // points where distanceToPoint >= 0, i.e. everything at or below the cut.
  out.normal.set(0, 0, 0).setComponent(index, -1);
  out.constant = cut;
  return true;
}

/** True when a world-space point survives the active slice. */
export function isInsideSlice(plane: THREE.Plane, x: number, y: number, z: number): boolean {
  return plane.distanceToPoint(_point.set(x, y, z)) >= 0;
}

const _point = new THREE.Vector3();

function toBox3(bounds: RegionBounds): THREE.Box3 {
  return _box.set(
    _min.set(bounds.minX, bounds.minY, bounds.minZ),
    _max.set(bounds.maxX, bounds.maxY, bounds.maxZ),
  );
}

const _box = new THREE.Box3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();
