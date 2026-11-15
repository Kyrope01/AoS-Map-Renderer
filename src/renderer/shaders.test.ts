import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createMaterialBank,
  createOceanMaterial,
  createSharedUniforms,
  createSkyDomeMaterial,
  MAX_VOXEL_SHADOW_CASTERS,
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

function compiledPbrFragment(): string {
  const bank = createMaterialBank(createSharedUniforms());
  const material = bank.pbr as THREE.MeshPhysicalMaterial;
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as never);
  bank.dispose();
  return resolveIncludes(shader.fragmentShader);
}

function bankFragmentShaders(): { name: string; fragment: string }[] {
  const bank = createMaterialBank(createSharedUniforms());
  const shaders = [
    { name: 'atmospheric', fragment: resolveIncludes(bank.atmospheric.fragmentShader) },
    { name: 'diorama', fragment: resolveIncludes(bank.diorama.fragmentShader) },
    { name: 'cinema', fragment: resolveIncludes(bank.cinema.fragmentShader) },
    { name: 'voxlap', fragment: resolveIncludes(bank.voxlap.fragmentShader) },
    { name: 'rim', fragment: resolveIncludes(bank.rim.fragmentShader) },
  ];
  bank.dispose();
  return shaders;
}

test('PBR voxel fog is applied on linear radiance, before tone mapping and sRGB encode', () => {
  const fragment = compiledPbrFragment();
  const fogIndex = fragment.indexOf('computeSceneFog(gl_FragColor.rgb');
  const toneIndex = fragment.indexOf('toneMapping( gl_FragColor.rgb )');
  const colorSpaceIndex = fragment.indexOf('linearToOutputTexel( gl_FragColor )');

  assert.ok(fogIndex >= 0, 'PBR shader should apply computeSceneFog to the framebuffer');
  assert.ok(toneIndex > fogIndex, 'fog must run before tone mapping');
  assert.ok(colorSpaceIndex > fogIndex, 'fog must run before the sRGB encode');
});

test('PBR voxel material no longer relies on the post-tonemap fog_fragment chunk', () => {
  const bank = createMaterialBank(createSharedUniforms());
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  bank.pbr.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as never,
  );
  bank.dispose();
  // The injected replacement leaves the stock (sRGB-space) fog chunk untouched;
  // the custom fog call must therefore not appear *after* it.
  const raw = shader.fragmentShader;
  const customFog = raw.indexOf('computeSceneFog(gl_FragColor.rgb');
  const stockFog = raw.indexOf('#include <fog_fragment>');
  assert.ok(customFog >= 0);
  assert.ok(
    stockFog === -1 || stockFog > customFog,
    'stock fog_fragment must not run after the custom linear fog',
  );
});

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
    compiledPbrFragment(),
    ...bankFragmentShaders().map((entry) => entry.fragment),
    resolveIncludes(sky.fragmentShader),
    resolveIncludes(ocean.material.fragmentShader),
    StudioPostShader.fragmentShader,
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
  const pbrShader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  bank.pbr.onBeforeCompile(
    pbrShader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as never,
  );
  assert.equal(pbrShader.uniforms.uShadowCasterCount, shared.uShadowCasterCount);
  assert.equal(pbrShader.uniforms.uIsOrtho, shared.uIsOrtho);
  assert.equal(MAX_VOXEL_SHADOW_CASTERS, 16);

  const fragments = [
    resolveIncludes(pbrShader.fragmentShader),
    ...bankFragmentShaders().map((entry) => entry.fragment),
  ];
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
