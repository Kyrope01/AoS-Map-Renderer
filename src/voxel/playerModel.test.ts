import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applySpawnedPlayerPatch,
  buildPivotCenteredPartData,
  computeCorpseTransform,
  computePlayerPoseTransforms,
  createSpawnedPlayer,
  createSpawnedPlayerFromPreset,
  DEFAULT_ZOMBIE_CLOTH_COLOR,
  disposePlayerModelGeometryCache,
  duplicateSpawnedPlayer,
  getBasePlayerPartGrid,
  getPlayerPartGeometry,
  PLAYER_PART_EULER_ORDER,
  prunePlayerModelGeometryCache,
  recolorKv6SentinelGrid,
  selectPlayerPartKeys,
  snapPlayerYToGround,
} from './playerModel';
import {
  computeFloatingPanelCoords,
  PLAYER_PANEL_GAP,
  PLAYER_PANEL_W,
  VOXEL_LIGHT_PANEL_GAP,
} from '../components/floatingAnchor';
import { MAX_SPAWNED_PLAYERS } from './types';
import { encodeVxl, parseVxl } from './vxlParser';

test('bundled ZeroSpades KV6 parts decode with valid dimensions and voxel counts', () => {
  const head = getBasePlayerPartGrid('classic_head');
  assert.equal(head.width, 6);
  assert.equal(head.height, 6);
  assert.equal(head.depth, 6);
  assert.equal(head.voxelCount, 152);

  const rifle = getBasePlayerPartGrid('weapon_rifle');
  assert.equal(rifle.voxelCount, 205);

  const block = getBasePlayerPartGrid('weapon_block');
  assert.equal(block.width, 10);
  assert.equal(block.height, 10);
  assert.equal(block.depth, 10);
  assert.equal(block.voxelCount, 488);
});

test('recolorKv6SentinelGrid replaces exact (0,0,0) sentinels while preserving skin/eye voxels', () => {
  const block = getBasePlayerPartGrid('weapon_block');
  const recoloredBlock = recolorKv6SentinelGrid(block, '#33AA55');
  let customVoxels = 0;
  recoloredBlock.forEachSolid((_x, _y, _z, color) => {
    assert.equal((color >>> 16) & 0xff, 0x33);
    assert.equal((color >>> 8) & 0xff, 0xaa);
    assert.equal(color & 0xff, 0x55);
    customVoxels++;
  });
  assert.equal(customVoxels, 488);

  // Classic head has 86 (0,0,0) uniform/hair sentinels plus non-sentinel (8,8,8) eyes & skin
  const head = getBasePlayerPartGrid('classic_head');
  const recoloredHead = recolorKv6SentinelGrid(head, '#C53030');
  let eyeColorCount = 0;
  let teamColorCount = 0;
  recoloredHead.forEachSolid((_x, _y, _z, color) => {
    const r = (color >>> 16) & 0xff;
    const g = (color >>> 8) & 0xff;
    const b = color & 0xff;
    if (r === 8 && g === 8 && b === 8) eyeColorCount++;
    if (r === 0xc5 && g === 0x30 && b === 0x30) teamColorCount++;
  });
  assert.ok(eyeColorCount >= 2, 'non-sentinel dark eye voxels must remain untouched');
  assert.equal(teamColorCount, 86, 'all 86 (0,0,0) sentinel voxels must adopt team color');
});

test('buildPivotCenteredPartData places standing and crouched boot bottoms flush at foot ground y = 0', () => {
  const standingPose = computePlayerPoseTransforms('standing', 'rifle', 0);
  const legData = buildPivotCenteredPartData('classic_leg', '#2B6CB0');
  let minLegY = Infinity;
  for (let i = 1; i < legData.positions.length; i += 3) {
    if (legData.positions[i] < minLegY) minLegY = legData.positions[i];
  }
  const standingBootWorldY = standingPose.legLeft.position[1] + minLegY * standingPose.legLeft.scale;
  assert.ok(
    Math.abs(standingBootWorldY) < 1e-5,
    `expected standing boot bottom at y=0, got ${standingBootWorldY}`,
  );

  const crouchedPose = computePlayerPoseTransforms('crouched', 'rifle', 0);
  const legCrouchData = buildPivotCenteredPartData('classic_leg_crouch', '#2B6CB0');
  let minCrouchLegY = Infinity;
  for (let i = 1; i < legCrouchData.positions.length; i += 3) {
    if (legCrouchData.positions[i] < minCrouchLegY) minCrouchLegY = legCrouchData.positions[i];
  }
  const crouchedBootWorldY = crouchedPose.legLeft.position[1] + minCrouchLegY * crouchedPose.legLeft.scale;
  assert.ok(
    Math.abs(crouchedBootWorldY) < 1e-5,
    `expected crouched boot bottom at y=0, got ${crouchedBootWorldY}`,
  );
});

test('pose transforms reflect standing vs crouched height and sprinting arm/leg angles', () => {
  const standing = computePlayerPoseTransforms('standing', 'rifle', 0);
  const crouched = computePlayerPoseTransforms('crouched', 'rifle', 0);
  const sprinting = computePlayerPoseTransforms('sprinting', 'rifle', 0);

  assert.ok(crouched.head.position[1] < standing.head.position[1], 'crouched head is lower than standing');
  assert.ok(crouched.legLeft.position[2] > 0, 'crouched legs tuck backward (+Z)');
  assert.ok(sprinting.arms.rotationX < -0.5, 'sprinting lowers arms rotation');
  assert.ok(
    sprinting.legLeft.rotationX !== 0 &&
      Math.abs(sprinting.legLeft.rotationX + sprinting.legRight.rotationX) < 1e-6,
    'sprinting swings left and right legs in opposition',
  );
  assert.deepEqual(standing.toolInArms.position, [0.4, 0, -0.9]);
  assert.equal(standing.toolInArms.scale, 0.051);
});

test('selectPlayerPartKeys selects style-appropriate head/torso and crouched leg meshes', () => {
  const classicStanding = selectPlayerPartKeys('classic', 'standing', 'spade');
  assert.equal(classicStanding.head, 'classic_head');
  assert.equal(classicStanding.torso, 'classic_torso');
  assert.equal(classicStanding.tool, 'weapon_spade');

  const tacticalCrouchShotgun = selectPlayerPartKeys('tactical', 'crouched', 'shotgun');
  assert.equal(tacticalCrouchShotgun.head, 'shotgun_head');
  assert.equal(tacticalCrouchShotgun.torso, 'shotgun_torso_crouch');
  assert.equal(tacticalCrouchShotgun.legLeft, 'rifle_leg_crouch');
  assert.equal(tacticalCrouchShotgun.legRight, 'rifle_leg_right_crouch');
  assert.equal(tacticalCrouchShotgun.tool, 'weapon_shotgun');
});

test('duplicateSpawnedPlayer clones all state with unique id and non-overlapping offset', () => {
  const source = createSpawnedPlayer(10, 5, -12, {
    stance: 'crouched',
    weapon: 'block',
    style: 'tactical',
    teamColor: '#C53030',
    blockColor: '#5E8C4A',
    yaw: 90,
    pitch: -15,
  });

  const dup = duplicateSpawnedPlayer(source, [source], { width: 512, height: 64, depth: 512 });
  assert.ok(dup);
  assert.notEqual(dup.id, source.id);
  assert.equal(dup.stance, 'crouched');
  assert.equal(dup.weapon, 'block');
  assert.equal(dup.style, 'tactical');
  assert.equal(dup.teamColor, '#C53030');
  assert.equal(dup.blockColor, '#5E8C4A');
  assert.equal(dup.yaw, 90);
  assert.equal(dup.pitch, -15);
  assert.equal(dup.y, source.y);
  assert.ok(Math.hypot(dup.x - source.x, dup.z - source.z) > 1.5);

  // Respect MAX_SPAWNED_PLAYERS cap
  const full = Array.from({ length: MAX_SPAWNED_PLAYERS }, (_, i) =>
    createSpawnedPlayer(i, 1, 0),
  );
  assert.equal(duplicateSpawnedPlayer(source, full), null);
});

test('snapPlayerYToGround finds exact top surface of VXL terrain', () => {
  const W = 4;
  const D = 4;
  const H = 16;
  const buf = encodeVxl(W, D, H, (gx, gy, gz) =>
    gx === 2 && gz === 2 && gy <= 6 ? 0xff447733 : gy === 0 ? 0xff224466 : 0,
  );
  const grid = parseVxl(buf, { width: W, depth: D, height: H });
  // Grid center is (2, 0, 2) -> world x = 0.5, z = 0.5 hits column (2, 2) whose top solid voxel is gy=6 (top face y=7)
  const snapped = snapPlayerYToGround(grid, 0.5, 10, 0.5);
  assert.equal(snapped, 7);
});

test('computeFloatingPanelCoords keeps generous clearance from player and flips left near sidebar', () => {
  assert.ok(PLAYER_PANEL_GAP >= 72, 'player menu should sit well clear of the model silhouette');
  assert.ok(PLAYER_PANEL_GAP > VOXEL_LIGHT_PANEL_GAP);

  // Center of 1440x900 canvas with open sidebar (rightMargin = 328 -> usable right = 1112): places right at screenX + gap
  const centerPos = computeFloatingPanelCoords(500, 420, PLAYER_PANEL_W, 424, PLAYER_PANEL_GAP, 1440, 900, 328);
  assert.equal(centerPos.left, 500 + PLAYER_PANEL_GAP);

  // Near right sidebar (screenX = 950 -> 950 + 76 + 264 = 1290 > 1112): flips left of player
  const rightSidePos = computeFloatingPanelCoords(950, 420, PLAYER_PANEL_W, 424, PLAYER_PANEL_GAP, 1440, 900, 328);
  assert.equal(rightSidePos.left, 950 - PLAYER_PANEL_W - PLAYER_PANEL_GAP);
});

test('prunePlayerModelGeometryCache evicts unused geometries without disposing active ones', () => {
  disposePlayerModelGeometryCache();
  const activeGeo = getPlayerPartGeometry('classic_head', '#112233');
  const unusedGeo1 = getPlayerPartGeometry('classic_head', '#223344');
  const unusedGeo2 = getPlayerPartGeometry('classic_head', '#334455');
  assert.notEqual(activeGeo, unusedGeo1);
  assert.notEqual(unusedGeo1, unusedGeo2);

  let activeDisposed = false;
  activeGeo.addEventListener('dispose', () => {
    activeDisposed = true;
  });

  const evicted = prunePlayerModelGeometryCache(new Set([activeGeo]), 1);
  assert.equal(evicted, 2);
  assert.equal(activeDisposed, false, 'active geometry must stay intact when cache is pruned');
  // Active geometry stays cached and reused
  assert.equal(getPlayerPartGeometry('classic_head', '#112233'), activeGeo);
  disposePlayerModelGeometryCache();
});

test('upward aim pitch tilts both head and arms upward (+Y) with PLAYER_PART_EULER_ORDER', () => {
  const upPose = computePlayerPoseTransforms('standing', 'rifle', 30);
  const downPose = computePlayerPoseTransforms('standing', 'rifle', -30);

  // KV6 models face +Z in local part space before the Y = Math.PI flip turns them to -Z.
  const kv6Front = new THREE.Vector3(0, 0, 1);

  const headUpForward = kv6Front
    .clone()
    .applyEuler(new THREE.Euler(upPose.head.rotationX, upPose.head.rotationY, 0, PLAYER_PART_EULER_ORDER));
  const armsUpForward = kv6Front
    .clone()
    .applyEuler(new THREE.Euler(0, upPose.arms.rotationY, 0, PLAYER_PART_EULER_ORDER))
    .applyEuler(new THREE.Euler(upPose.arms.rotationX, 0, 0, 'XYZ'));

  assert.ok(headUpForward.y > 0.4, `expected head to pitch upward (+Y), got y=${headUpForward.y}`);
  assert.ok(armsUpForward.y > 0.4, `expected arms to pitch upward (+Y), got y=${armsUpForward.y}`);
  assert.ok(Math.abs(headUpForward.y - armsUpForward.y) < 1e-6);

  const headDownForward = kv6Front
    .clone()
    .applyEuler(new THREE.Euler(downPose.head.rotationX, downPose.head.rotationY, 0, PLAYER_PART_EULER_ORDER));
  assert.ok(headDownForward.y < -0.4, `expected negative pitch to tilt head downward (-Y), got y=${headDownForward.y}`);
});

test('ZeroSpades zombie models always hold spades and zombie/player corpses sit flush at y = 0', () => {
  const zombieParts = selectPlayerPartKeys('tactical', 'standing', 'rifle', 'zombie');
  assert.equal(zombieParts.head, 'zombie_head');
  assert.equal(zombieParts.torso, 'zombie_torso');
  assert.equal(zombieParts.arms, 'zombie_arms');
  assert.equal(zombieParts.legLeft, 'zombie_leg');
  assert.equal(zombieParts.legRight, 'zombie_leg_right');
  assert.equal(zombieParts.tool, 'weapon_spade');
  assert.equal(zombieParts.corpse, 'zombie_dead');

  const spawnedZombie = createSpawnedPlayerFromPreset('zombie', 4, 2, -6);
  assert.equal(spawnedZombie.characterType, 'zombie');
  assert.equal(spawnedZombie.weapon, 'spade');
  assert.equal(spawnedZombie.teamColor, '#1D3521');
  assert.equal(DEFAULT_ZOMBIE_CLOTH_COLOR, '#1D3521');

  // Attempting to switch a zombie's weapon keeps it locked to spade
  const patchedZombie = applySpawnedPlayerPatch(spawnedZombie, { weapon: 'shotgun' });
  assert.equal(patchedZombie.weapon, 'spade');

  const playerCorpse = createSpawnedPlayerFromPreset('player_corpse', 0, 1, 0);
  assert.equal(playerCorpse.characterType, 'player');
  assert.equal(playerCorpse.stance, 'corpse');

  const zombieCorpse = createSpawnedPlayerFromPreset('zombie_corpse', 2, 1, 0);
  assert.equal(zombieCorpse.characterType, 'zombie');
  assert.equal(zombieCorpse.stance, 'corpse');
  assert.equal(zombieCorpse.weapon, 'spade');

  // Verify every corpse .kv6 sits flush on y = 0
  for (const corpseKey of [
    'classic_dead',
    'rifle_dead',
    'shotgun_dead',
    'smg_dead',
    'zombie_dead',
  ] as const) {
    const grid = getBasePlayerPartGrid(corpseKey);
    assert.ok(grid.voxelCount > 500, `${corpseKey} should decode full corpse voxels`);
    const data = buildPivotCenteredPartData(corpseKey, '#2F855A');
    const transform = computeCorpseTransform(corpseKey);
    let minY = Infinity;
    for (let i = 1; i < data.positions.length; i += 3) {
      if (data.positions[i] < minY) minY = data.positions[i];
    }
    const worldBottomY = transform.position[1] + minY * transform.scale;
    assert.ok(
      Math.abs(worldBottomY) < 1e-5,
      `expected ${corpseKey} corpse bottom at y=0, got ${worldBottomY}`,
    );
  }
});
