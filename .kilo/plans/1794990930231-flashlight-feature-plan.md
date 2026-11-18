# Flashlight Feature Implementation Plan

## Objective
Add flashlight controls (on/off, color, FOV, throw distance) for spawned player models in the map renderer, exposing these options in the PlayerModelPanel UI.

## Important Details
- Flashlight extension in KyroSpades uses `reach` (distance), `cone` (FOV in π/256), `red/green/blue` (linear RGB), and `flicker` (on/off timing).
- Renderer already supports voxel lights; need to add a player‑specific flashlight light source anchored to each `SpawnedPlayer`.
- UI must be added to `PlayerModelPanel.tsx` (floating panel) and linked to `ControlSidebar` player list.
- No existing flashlight fields in `SpawnedPlayer`; must extend the type.
- Server‑side flashlight negotiation (KyroSpades) may need to be mirrored or assumed enabled for local testing.

## Work State
### Completed
- Investigated both codebases; identified relevant files and flashlight extension details.
- Located `PlayerModelPanel.tsx`, `voxel/types.ts`, `renderer/shaders.ts`, `VoxelViewport.tsx`, and KyroSpades flashlight files.
- Verified flashlight packet format and beam parameters from `flashlight_ext.h`, `flashlight_ext.c`, and `flashlight-v1-test.md`.

### Active
- None (no code changes made yet).

### Blocked
- None.

## Next Move
1. Define flashlight fields in `SpawnedPlayer` (add `flashlight_enabled`, `flashlight_reach`, `flashlight_cone`, `flashlight_color_rgb`, `flashlight_flicker`) in `voxel/types.ts`.
2. Extend `PlayerModelPanel.tsx` with UI controls (toggle switch, color picker, sliders for reach and cone) and bind them to player state.
3. Modify `VoxelViewport.tsx` render loop to create/update a voxel light for each player’s flashlight when enabled, using existing voxel light APIs.
4. Update shaders (`shaders.ts`) to handle flashlight light uniforms (`u_FlashlightDirection`, `u_SpotColorCone`, etc.) if needed.
5. Ensure flashlight state syncs with KyroSpades server (if required) via existing network messages or local simulation.

## Relevant Files
- `/home/user/CODING/AoS-Map-Renderer/src/voxel/types.ts`: Define flashlight properties for `SpawnedPlayer`.
- `/home/user/CODING/AoS-Map-Renderer/src/components/PlayerModelPanel.tsx`: Add UI controls for flashlight settings.
- `/home/user/CODING/AoS-Map-Renderer/src/renderer/shaders.ts`: Add flashlight light uniform definitions if needed.
广大
- `/home/user/CODING/AoS-Map-Renderer/src/renderer/VoxelViewport.tsx`: Integrate flashlight light creation/update in render loop.
- `/home/user/CODING/KyroSpades/src/flashlight_ext.h`: Flashlight extension definition (reach, cone, RGB, flicker).
- `/home/user/CODING/KyroSpades/src/flashlight_ext.c`: Flashlight implementation details.
- `/home/user/CODING/KyroSpades/docs/flashlight-v1-test.md`: Usage examples for flashlight parameters.