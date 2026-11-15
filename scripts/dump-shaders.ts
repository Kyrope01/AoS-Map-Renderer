/**
 * Development-only script: dumps the fully expanded GLSL for every voxel
 * material so the shader sources can be linted without a GPU.
 *
 *   npx tsx scripts/dump-shaders.ts /tmp/shader-out
 *
 * The output is ordinary GLSL ES 3.00 with three's #include chunks resolved and
 * NUM_CLIPPING_PLANES / MAX_VOXEL_LIGHTS substituted, which the accompanying
 * scripts/check-shaders.py scans for undeclared identifiers and reversed
 * smoothstep edges.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createMaterialBank, createSharedUniforms } from '../src/renderer/shaders';

const outDir = process.argv[2] ?? '/tmp/shader-out';
mkdirSync(outDir, { recursive: true });

function resolveIncludes(source: string, depth = 0): string {
  if (depth > 8) throw new Error('include recursion');
  return source.replace(/#include <([\w\d./]+)>/g, (_m, name: string) => {
    const chunk = (THREE.ShaderChunk as unknown as Record<string, string | undefined>)[name];
    if (chunk === undefined) throw new Error(`unknown shader chunk <${name}>`);
    return resolveIncludes(chunk, depth + 1);
  });
}

function define(source: string): string {
  return source
    .replace(/NUM_CLIPPING_PLANES/g, '1')
    .replace(/UNION_CLIPPING_PLANES/g, '1')
    .replace(/MAX_VOXEL_LIGHTS/g, '512');
}

const bank = createMaterialBank(createSharedUniforms());

const pbrShader = {
  uniforms: {} as Record<string, THREE.IUniform>,
  vertexShader: THREE.ShaderLib.physical.vertexShader,
  fragmentShader: THREE.ShaderLib.physical.fragmentShader,
};
bank.pbr.onBeforeCompile(
  pbrShader as unknown as THREE.WebGLProgramParametersWithUniforms,
  null as never,
);

const outputs: { name: string; vertexShader: string; fragmentShader: string }[] = [
  { name: 'pbr', ...pbrShader },
  { name: 'atmospheric', vertexShader: bank.atmospheric.vertexShader, fragmentShader: bank.atmospheric.fragmentShader },
  { name: 'diorama', vertexShader: bank.diorama.vertexShader, fragmentShader: bank.diorama.fragmentShader },
  { name: 'cinema', vertexShader: bank.cinema.vertexShader, fragmentShader: bank.cinema.fragmentShader },
  { name: 'voxlap', vertexShader: bank.voxlap.vertexShader, fragmentShader: bank.voxlap.fragmentShader },
  { name: 'rim', vertexShader: bank.rim.vertexShader, fragmentShader: bank.rim.fragmentShader },
];

for (const entry of outputs) {
  writeFileSync(
    path.join(outDir, `${entry.name}.vert.glsl`),
    define(resolveIncludes(entry.vertexShader)),
  );
  writeFileSync(
    path.join(outDir, `${entry.name}.frag.glsl`),
    define(resolveIncludes(entry.fragmentShader)),
  );
}

bank.dispose();
console.log(`wrote ${outputs.length * 2} shader files to ${outDir}`);
