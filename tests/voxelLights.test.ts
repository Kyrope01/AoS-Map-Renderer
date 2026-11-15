import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createMaterialBank, createSharedUniforms } from '../src/renderer/shaders';
import { updateVoxelLightTexture } from '../src/renderer/voxelLightTexture';
import { MAX_VOXEL_LIGHTS, VoxelLight } from '../src/voxel/types';

function light(i: number): VoxelLight {
  return { id: `${i}`, x: i, y: 2, z: 3, normal: [0, 1, 0], intensity: 2, range: 20, color: '#ffffff' };
}

test('packs more than eight lights, including the last supported light', () => {
  const shared = createSharedUniforms();
  const texture = shared.uVoxelLightTexture.value;
  const lights = Array.from({ length: MAX_VOXEL_LIGHTS }, (_, i) => light(i));
  assert.equal(updateVoxelLightTexture(texture, lights, new THREE.Vector3(10, 0, 10)), 512);
  const data = texture.image.data as Float32Array;
  assert.equal(data[8 * 8], 8 + 0.5 - 10);
  const last = 511 * 8;
  assert.equal(data[last], 511 + 0.5 - 10);
  assert.ok(Math.abs(data[last + 1] - 3.15) < 0.00001);
  assert.equal(data[last + 2], -6.5);
  assert.equal(data[last + 3], 20);
  assert.deepEqual(Array.from(data.slice(last + 4, last + 8)), [1, 1, 1, 2]);
  assert.equal(updateVoxelLightTexture(texture, lights.slice(0, 9), new THREE.Vector3()), 9);
  assert.equal(updateVoxelLightTexture(texture, [], new THREE.Vector3()), 0);
  assert.throws(() => updateVoxelLightTexture(texture, [...lights, light(512)], new THREE.Vector3()), RangeError);
  texture.dispose();
  shared.uVoxelShadowTexture.value.dispose();
});

test('all shader modes share the texture-based voxel lighting', () => {
  const shared = createSharedUniforms();
  const bank = createMaterialBank(shared);
  for (const mode of ['atmospheric', 'diorama', 'cinema', 'voxlap', 'rim'] as const) {
    assert.match(bank[mode].fragmentShader, /sampler2D uVoxelLightTexture/);
    assert.match(bank[mode].fragmentShader, /voxelLightContribution\(vWorldPos/);
  }
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  bank.pbr.onBeforeCompile(shader as never, {} as never);
  assert.match(shader.fragmentShader, /sampler2D uVoxelLightTexture/);
  assert.match(shader.fragmentShader, /outgoingLight \+= voxelLightContribution/);
  assert.equal((shader.uniforms as Record<string, unknown>).uVoxelLightTexture, shared.uVoxelLightTexture);
  assert.equal((shader.uniforms as Record<string, unknown>).uVoxelShadowTexture, shared.uVoxelShadowTexture);
  bank.dispose();
  shared.uVoxelLightTexture.value.dispose();
  shared.uVoxelShadowTexture.value.dispose();
});
