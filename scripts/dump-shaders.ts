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
import {
  createMaterialBank,
  createOceanMaterial,
  createSharedUniforms,
  createSkyDomeMaterial,
  GodRaysCompositeShader,
  GodRaysShader,
  StudioPostShader,
} from '../src/renderer/shaders';

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

const shared = createSharedUniforms();
const bank = createMaterialBank(shared);
const skyMat = createSkyDomeMaterial(shared);
const ocean = createOceanMaterial(shared);

const outputs: { name: string; vertexShader: string; fragmentShader: string }[] = [
  { name: 'atmospheric', vertexShader: bank.atmospheric.vertexShader, fragmentShader: bank.atmospheric.fragmentShader },
  { name: 'diorama', vertexShader: bank.diorama.vertexShader, fragmentShader: bank.diorama.fragmentShader },
  { name: 'cinema', vertexShader: bank.cinema.vertexShader, fragmentShader: bank.cinema.fragmentShader },
  { name: 'voxlap', vertexShader: bank.voxlap.vertexShader, fragmentShader: bank.voxlap.fragmentShader },
  { name: 'sky', vertexShader: skyMat.vertexShader, fragmentShader: skyMat.fragmentShader },
  { name: 'ocean', vertexShader: ocean.material.vertexShader, fragmentShader: ocean.material.fragmentShader },
  { name: 'studio', vertexShader: StudioPostShader.vertexShader, fragmentShader: StudioPostShader.fragmentShader },
  { name: 'godrays', vertexShader: GodRaysShader.vertexShader, fragmentShader: GodRaysShader.fragmentShader },
  { name: 'godrays-composite', vertexShader: GodRaysShader.vertexShader, fragmentShader: GodRaysShader.fragmentShader },
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

skyMat.dispose();
ocean.material.dispose();
bank.dispose();
console.log(`wrote ${outputs.length * 2} shader files to ${outDir}`);
