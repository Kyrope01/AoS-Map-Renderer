import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMaterialBank, createSharedUniforms } from './shaders';

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
  const sources = [
    compiledPbrFragment(),
    ...bankFragmentShaders().map((entry) => entry.fragment),
  ];
  for (const source of sources) {
    for (const match of source.matchAll(/smoothstep\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,/g)) {
      const low = Number(match[1]);
      const high = Number(match[2]);
      assert.ok(
        low < high,
        `reversed smoothstep(${match[1]}, ${match[2]}) is undefined behaviour on some GPUs`,
      );
    }
  }
});

test('every voxel material opts into local clipping and shadow clipping', () => {
  const bank = createMaterialBank(createSharedUniforms());
  for (const material of bank.all) {
    assert.equal(material.clipShadows, true);
    assert.ok(Array.isArray(material.clippingPlanes));
  }
  bank.dispose();
});
