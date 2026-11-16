import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createMaterialBank,
  createOceanMaterial,
  createSharedUniforms,
  createSkyDomeMaterial,
  GodRaysCompositeShader,
  GodRaysShader,
  StudioPostShader,
} from './shaders';
import { sortVoxelLightsByIntensity } from './voxelLightTexture';
import { VoxelLight } from '../voxel/types';

/** Minimal stand-in for three's private `resolveIncludes()`. */
function resolveIncludes(source: string): string {
  return source.replace(/#include <([\w\d./]+)>/g, (_match, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string | undefined>)[name];
    assert.ok(chunk !== undefined, `unknown shader chunk <${name}>`);
    return chunk;
  });
}

function bankFragmentShaders(): { name: string; fragment: string }[] {
  const bank = createMaterialBank(createSharedUniforms());
  const shaders = [
    { name: 'atmospheric', fragment: resolveIncludes(bank.atmospheric.fragmentShader) },
    { name: 'diorama', fragment: resolveIncludes(bank.diorama.fragmentShader) },
    { name: 'cinema', fragment: resolveIncludes(bank.cinema.fragmentShader) },
    { name: 'voxlap', fragment: resolveIncludes(bank.voxlap.fragmentShader) },
  ];
  bank.dispose();
  return shaders;
}

test('stylized voxel shaders clip through three clipping planes, not a hardcoded discard', () => {
  for (const { name, fragment } of bankFragmentShaders()) {
    assert.match(
      fragment,
      /if \( dot\( vClipPosition, plane\.xyz \) > plane\.w \) discard;/,
      `${name} should include three's clipping chunk`,
    );
    assert.doesNotMatch(
      fragment,
      /uSliceAxis == 1 && vLocalPos\.x > uSliceCoord/,
      `${name} should not hand-roll slice discards (shadows ignore them)`,
    );
  }
});

test('shaders never use reversed smoothstep edges (spec-undefined)', () => {
  const shared = createSharedUniforms();
  const sky = createSkyDomeMaterial(shared);
  const ocean = createOceanMaterial(shared);
  const sources = [
    ...bankFragmentShaders().map((entry) => entry.fragment),
    resolveIncludes(sky.fragmentShader),
    resolveIncludes(ocean.material.fragmentShader),
    StudioPostShader.fragmentShader,
    GodRaysShader.fragmentShader,
    GodRaysCompositeShader.fragmentShader,
  ];
  sky.dispose();
  ocean.material.dispose();
  for (const source of sources) {
    for (const match of source.matchAll(/smoothstep\(\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*,/g)) {
      const low = Number(match[1]);
      const high = Number(match[2]);
      assert.ok(
        low < high,
        `reversed smoothstep(${match[1]}, ${match[2]}) is undefined behaviour on some GPUs`,
      );
    }
  }
  assert.match(StudioPostShader.fragmentShader, /1\.0\s*-\s*smoothstep\(\s*0\.28\s*,\s*0\.85\s*,\s*d\s*\)/);
});

test('every voxel material opts into local clipping and shadow clipping', () => {
  const bank = createMaterialBank(createSharedUniforms());
  for (const material of bank.all) {
    assert.equal(material.clipShadows, true);
    assert.ok(Array.isArray(material.clippingPlanes));
  }
  bank.dispose();
});

test('voxel light shaders bind uShadowCasterCount, cull dim lights, and split shadowed vs unshadowed loops', () => {
  const shared = createSharedUniforms();
  const bank = createMaterialBank(shared);

  const fragments = bankFragmentShaders().map((entry) => entry.fragment);
  bank.dispose();
  for (const frag of fragments) {
    assert.match(frag, /uniform int uShadowCasterCount;/);
    assert.match(frag, /uniform float uIsOrtho;/);
    assert.match(frag, /contrib < 0\.004/);
    assert.match(frag, /for \(int i = 0; i < 16; i\+\+\)/);
    assert.match(frag, /for \(int i = 16; i < 512; i\+\+\)/);
    assert.match(frag, /voxelShadowVisibility\(/);
    assert.match(frag, /floor\(\(packed \+ 0\.01\) \/ exp2\(mod\(cell\.x, 8\.0\)\)\)/);
    assert.match(frag, /max\(0\.0\d*, mix\(1\.0,/);
  }
});

test('sortVoxelLightsByIntensity prioritizes brightest lights first without mutating input', () => {
  const mk = (id: string, intensity: number): VoxelLight => ({
    id,
    x: 0,
    y: 0,
    z: 0,
    normal: [0, 1, 0],
    intensity,
    range: 28,
    color: '#FFB35C',
  });
  const input = [mk('dim', 0.5), mk('bright', 42), mk('mid', 6)];
  const sorted = sortVoxelLightsByIntensity(input);
  assert.deepEqual(
    sorted.map((l) => l.id),
    ['bright', 'mid', 'dim'],
  );
  assert.deepEqual(
    input.map((l) => l.id),
    ['dim', 'bright', 'mid'],
  );
});

test('volumetric GodRaysShader marches 3D shadow map with IGN jitter and omnidirectional phase', () => {
  assert.match(GodRaysShader.fragmentShader, /uniform highp sampler2DShadow uShadowMap;/);
  assert.match(GodRaysShader.fragmentShader, /uniform mat4 uShadowMatrix;/);
  assert.match(GodRaysShader.fragmentShader, /52\.9829189/); // Interleaved Gradient Noise jitter
  assert.doesNotMatch(GodRaysShader.fragmentShader, /uLightPos/); // No 2D screen-space radial smear
  assert.match(GodRaysCompositeShader.fragmentShader, /uniform sampler2D tRays;/);
  assert.match(GodRaysCompositeShader.fragmentShader, /depthSigma/);
});

