# Soft Flashlight Cone (Penumbra) Implementation Plan

## Goal
Make player flashlight beams fade gradually (soft penumbra) instead of ending with hard
geometric boundaries, both on lit surfaces and in the visible volumetric beam cone.

## Root-cause analysis (current hard edges)

1. **Surface lighting cone** — `src/renderer/shaders.ts:848-867` (`PLAYER_FLASHLIGHT_GLSL`):
   `coneFactor = smoothstep(coneEdge, 1.0, cone)` fades across the whole cone, so narrow
   cones read as a hard-edged spotlight; there is no spill/penumbra beyond the nominal edge.
2. **Visible beam mesh** — `src/renderer/VoxelViewport.tsx:146-190` (`FLASHLIGHT_BEAM_*`):
   the rim fade computes `dot(N, V)` with `N` in **world** space and `V` derived from
   `vBeamViewPos` in **view** space — mismatched spaces make the silhouette fade unreliable,
   leaving a hard cone outline. `uBeamRimSoftness` is a fixed 0.45.
3. **No softness parameter** exists anywhere in the flashlight pipeline.

## Design decisions (resolved)

- Add a user-facing `softness` field (0..255) to `SpawnedPlayer.flashlight`, default `140`.
- Soften BOTH the surface lighting cone and the visible beam mesh.
- Keep the existing `contrib < 0.004` early-out (it is not the visual problem; changing it
  would break the `shaders.test.ts:97` assertion).
- Single source of truth: `PLAYER_FLASHLIGHT_GLSL` is shared by all 4 stylized shaders,
  the ocean, and the PBR material via `onBeforeCompile`, so one edit covers everything.

## Task list

### 1. Add `softness` to the flashlight type
`src/voxel/types.ts:170-178` — add to the `flashlight` object:
```ts
softness: number;   // 0..255 (cone edge penumbra width)
```

### 2. Set the default
`src/voxel/playerModel.ts`:
- `DEFAULT_PLAYER_FLASHLIGHT` (line 453): add `softness: 140,`
- `createSpawnedPlayer` flashlight literal (line 487): add `softness: 140,`

### 3. Add the `uFlashlightSoftness` uniform
`src/renderer/shaders.ts`:
- `SharedShaderUniforms` interface (after `uFlashlightConeCos`, ~line 203):
  `uFlashlightSoftness: { value: number };`
- `createSharedUniforms()` (~line 264): `uFlashlightSoftness: { value: 0.55 },`
- `OceanUniforms` interface (~line 578): add `uFlashlightSoftness: { value: number };`
- `createOceanMaterial` uniforms map (~line 621): `uFlashlightSoftness: shared.uFlashlightSoftness,`
- `createPbrVoxelMaterial` `onBeforeCompile` (~line 921):
  `shader.uniforms.uFlashlightSoftness = shared.uFlashlightSoftness;`

### 4. Rewrite the surface cone falloff
`src/renderer/shaders.ts:837-868` — replace the cone factor block in
`PLAYER_FLASHLIGHT_GLSL`:
```glsl
uniform float uFlashlightSoftness;
// ...inside flashlightContribution, replace the coneFactor lines:
float cosCone = clamp(uFlashlightConeCos, -0.999, 0.9995);
float soft = clamp(uFlashlightSoftness, 0.0, 1.0);
// Penumbra band in cosine space, proportional to cone size so wide beams
// stay soft and narrow beams get a visible spill past the nominal edge.
float penumbra = (0.015 + 0.30 * soft) * max(0.10, 1.0 - cosCone);
float edgeLow  = max(cosCone - penumbra, -1.0);          // fully dark outside
float edgeHigh = min(cosCone + penumbra, 0.9995);        // full brightness inside
float coneFactor = smoothstep(edgeLow, edgeHigh, cone);
if (coneFactor <= 0.0) return vec3(0.0);
```
Keep the rest (diffuse, range, contrib, threshold) unchanged. At `cone == cosCone`
the factor is now ~0.5 (classic 50% penumbra), fading to 0 just outside the nominal
cone and to 1.0 just inside.

### 5. Drive the uniform in the render loop
`src/renderer/VoxelViewport.tsx:1362-1364` — after `uFlashlightConeCos` is set, add:
```ts
sharedUniforms.uFlashlightSoftness.value = fl.softness / 255;
```

### 6. Fix + soften the visible beam mesh
`src/renderer/VoxelViewport.tsx:146-190`:
- Vertex shader: add `varying vec3 vBeamWorldPos;` and set
  `vBeamWorldPos = worldPosition.xyz;` (the `vec4 worldPosition` already exists).
- Fragment shader: replace the mismatched-space view vector with a world-space one:
  ```glsl
  vec3 V = normalize(cameraPosition - vBeamWorldPos);
  vec3 N = normalize(vBeamWorldNormal);
  if (!gl_FrontFacing) N = -N;
  float facing = max(dot(N, V), 0.0);
  float rim = smoothstep(0.0, uBeamRimSoftness, facing);
  ```
- Add `uniform float uBeamSoftness;` and make rim softness scale with it:
  `float rimSoft = mix(0.15, 0.85, uBeamSoftness);` then
  `float rim = smoothstep(0.0, rimSoft, facing);`
- Soften the near apex slightly so the beam does not pop at the player's head:
  `float axial = vBeamAxial * smoothstep(0.0, 0.08, vBeamAxial);` then use `axial`
  in the alpha line.
- In `drawFrame` (~line 1377), set the new uniform:
  `flashlightConeMat.uniforms.uBeamSoftness.value = fl.softness / 255;`
  and bump the default `uBeamRimSoftness` in the material (line 630) to 0.5.

### 7. Optional: diffuse outer halo cone
`src/renderer/VoxelViewport.tsx` — clone `flashlightConeMesh` as `flashlightHaloMesh`
with the same shaders but `uBeamOpacity * 0.35`, `uBeamRimSoftness` high, and radius
scaled `baseRadius * 1.6`, positioned/rotated identically. Add it to the scene and
toggle `visible` alongside the main cone. This creates the "slowly diffuse" glow around
the core beam. Skip if the core fix already looks acceptable.

### 8. UI slider
`src/components/PlayerModelPanel.tsx` — after the Cone slider (line 418), add:
```tsx
<PanelSlider
  id="player-flashlight-softness-slider"
  label="Softness"
  value={player.flashlight.softness}
  min={0}
  max={255}
  step={1}
  displayValue={`${player.flashlight.softness}`}
  onChange={(v) => onUpdate(player.id, {
    flashlight: { ...player.flashlight, softness: v }
  })}
/>
```

## Validation

1. `bun run lint` (tsc --noEmit) — must pass with no type errors.
2. `bun test` — existing tests must pass. Note `shaders.test.ts:52-77` only flags
   `smoothstep` calls with **literal** reversed edges; the new calls use variables, so
   they are not matched. `shaders.test.ts:97` still matches because the `contrib < 0.004`
   line is kept.
3. `bun run lint:shaders` — GLSL dump/check must pass (confirms shader compile).
4. Visual: spawn a player, enable flashlight, set Cone narrow (e.g. 30) and wide
   (e.g. 180). The lit patch on ground/walls must show a gradual gradient, not a sharp
   circle; the visible beam silhouette must fade, not show a hard triangle edge.
   Sweep Softness 0→255 and confirm the edge widens/narrows accordingly.

## Risks / edge cases

- `softness` missing on old serialized player state: `createSpawnedPlayer` always sets it,
  but any persisted JSON without the field will read `undefined` → `NaN` in shaders.
  Guard in `drawFrame`: `const soft = Number.isFinite(fl.softness) ? fl.softness : 140;`
- Wide cones (`cone` near 255) make `1.0 - cosCone` large, so `penumbra` grows; the
  `max(0.10, ...)` floor and `min(..., 0.9995)` cap keep `edgeLow < edgeHigh` valid for
  `smoothstep` on all GPUs.
- The beam fix changes `dot(N, V)` to world space; verify the rim fade still looks right
  from inside the beam (camera within the cone) — `cameraPosition` is available in the
  fragment shader of a `ShaderMaterial` by default.

## Out of scope

- True volumetric air-scattering (raymarched beam) — the halo cone approximates it cheaply.
- Changing flashlight intensity/reach semantics or the KyroSpades packet format.
