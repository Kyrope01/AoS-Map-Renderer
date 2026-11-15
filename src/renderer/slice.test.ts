import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeSlicePlane, isInsideSlice, sliceAxisCode, sliceComponentIndex } from './slice';

const bounds = new THREE.Box3(new THREE.Vector3(-10, -5, -8), new THREE.Vector3(10, 5, 8));

test('slice axis mapping matches the uniform encoding used by the shaders', () => {
  // uSliceAxis: 0 = off, 1 = x, 2 = y, 3 = z (see syncSharedUniforms / VOXEL_LIGHT_GLSL).
  assert.equal(sliceAxisCode('none'), 0);
  assert.equal(sliceAxisCode('x'), 1);
  assert.equal(sliceAxisCode('y'), 2);
  assert.equal(sliceAxisCode('z'), 3);

  // Clipping-plane / vector component index is zero-based per axis.
  assert.equal(sliceComponentIndex('x'), 0);
  assert.equal(sliceComponentIndex('y'), 1);
  assert.equal(sliceComponentIndex('z'), 2);
});

test('slice keeps the half-space below the cut and removes everything above it', () => {
  const plane = new THREE.Plane();

  for (const axis of ['x', 'y', 'z'] as const) {
    assert.equal(computeSlicePlane(axis, 0.5, bounds, plane), true);
    const index = sliceComponentIndex(axis);

    // Bounds are centred on 0, so the 50% cut is 0 on every axis. The plane's
    // normal lies on the tested axis, so the other components are irrelevant.
    const below = new THREE.Vector3();
    below.setComponent(index, -1);
    const above = below.clone().setComponent(index, 1);

    assert.equal(
      isInsideSlice(plane, below.x, below.y, below.z),
      true,
      `${axis}: geometry below the cut must stay visible`,
    );
    assert.equal(
      isInsideSlice(plane, above.x, above.y, above.z),
      false,
      `${axis}: geometry above the cut must be clipped`,
    );
  }
});

test('slice position is a normalized lerp across the model bounds', () => {
  const plane = new THREE.Plane();

  computeSlicePlane('x', 0, bounds, plane);
  assert.ok(isInsideSlice(plane, -10, 0, 0), 'position 0 keeps the bounds minimum');
  assert.ok(!isInsideSlice(plane, -9.99, 0, 0), 'position 0 removes everything else');

  computeSlicePlane('x', 0.5, bounds, plane);
  // Bounds are -10..10, so a 0.5 slice cuts at x = 0.
  assert.ok(isInsideSlice(plane, -0.001, 0, 0));
  assert.ok(!isInsideSlice(plane, 0.001, 0, 0));

  computeSlicePlane('y', 1, bounds, plane);
  assert.ok(isInsideSlice(plane, 0, 5, 0));
  assert.ok(isInsideSlice(plane, 0, 4.999, 0));

  // Out-of-range positions clamp instead of flipping the cut.
  computeSlicePlane('x', 5, bounds, plane);
  assert.ok(isInsideSlice(plane, 9.999, 0, 0));
  computeSlicePlane('x', -5, bounds, plane);
  assert.ok(!isInsideSlice(plane, -9.999, 0, 0));
});

test('slice "none" reports inactive so the viewport clears its clipping planes', () => {
  const plane = new THREE.Plane();
  assert.equal(computeSlicePlane('none', 0.5, bounds, plane), false);
});
