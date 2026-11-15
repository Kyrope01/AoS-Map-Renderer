import * as THREE from 'three';
import { MAX_VOXEL_LIGHTS, VoxelLight } from '../voxel/types';

/**
 * Return lights sorted strongest-first so the brightest `MAX_VOXEL_SHADOW_CASTERS`
 * sit at the front of the texture and cast voxel shadows while dimmer fill lights
 * remain unshadowed.
 */
export function sortVoxelLightsByIntensity(lights: readonly VoxelLight[]): VoxelLight[] {
  return [...lights].sort((a, b) => b.intensity - a.intensity);
}

/** Pack voxel lights into a 2-by-MAX_VOXEL_LIGHTS RGBA float texture (strongest first). */
export function updateVoxelLightTexture(
  texture: THREE.DataTexture,
  lights: readonly VoxelLight[],
  gridOffset: THREE.Vector3,
): number {
  if (lights.length > MAX_VOXEL_LIGHTS) {
    throw new RangeError(`Only ${MAX_VOXEL_LIGHTS} voxel lights are supported`);
  }
  const sorted = sortVoxelLightsByIntensity(lights);
  const data = texture.image.data as Float32Array;
  const color = new THREE.Color();
  sorted.forEach((light, i) => {
    const offset = i * 8;
    color.set(light.color);
    data[offset] = light.x + 0.5 - gridOffset.x + light.normal[0] * 0.65;
    data[offset + 1] = light.y + 0.5 - gridOffset.y + light.normal[1] * 0.65;
    data[offset + 2] = light.z + 0.5 - gridOffset.z + light.normal[2] * 0.65;
    data[offset + 3] = light.range;
    data[offset + 4] = color.r;
    data[offset + 5] = color.g;
    data[offset + 6] = color.b;
    data[offset + 7] = light.intensity;
  });
  texture.needsUpdate = true;
  return sorted.length;
}
