import * as THREE from 'three';
import { Kv6Grid, parseKv6 } from './kv6Parser';
import { BuiltVoxelMeshData, buildVoxelGeometryData, hydrateVoxelGeometry } from './mesher';
import {
  decodeBase64ToUint8Array,
  PLAYER_KV6_BASE64,
  PlayerKv6PartKey,
} from './playerModelAssets';
import {
  MAX_SPAWNED_PLAYERS,
  PlayerCharacterType,
  PlayerSpawnPreset,
  PlayerStance,
  PlayerStyle,
  PlayerWeapon,
  SpawnedPlayer,
  VoxelGrid,
} from './types';

export const PLAYER_CHARACTER_OPTIONS: readonly { id: PlayerCharacterType; label: string }[] = [
  { id: 'player', label: 'Player' },
  { id: 'zombie', label: 'Zombie' },
];

export const PLAYER_STANCE_OPTIONS: readonly { id: PlayerStance; label: string }[] = [
  { id: 'standing', label: 'Standing' },
  { id: 'crouched', label: 'Crouched' },
  { id: 'sprinting', label: 'Sprinting' },
  { id: 'corpse', label: 'Corpse' },
];

export const PLAYER_WEAPON_OPTIONS: readonly { id: PlayerWeapon; label: string }[] = [
  { id: 'rifle', label: 'Rifle' },
  { id: 'shotgun', label: 'Shotgun' },
  { id: 'smg', label: 'SMG' },
  { id: 'grenade', label: 'Grenade' },
  { id: 'spade', label: 'Spade' },
  { id: 'block', label: 'Block' },
];

export const PLAYER_STYLE_OPTIONS: readonly { id: PlayerStyle; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'tactical', label: 'Tactical' },
];

export const PLAYER_TEAM_SWATCHES: readonly { label: string; hex: string }[] = [
  { label: 'Blue Team', hex: '#2B6CB0' },
  { label: 'Green Team', hex: '#2F855A' },
  { label: 'Red Team', hex: '#C53030' },
  { label: 'Gold Team', hex: '#D69E2E' },
  { label: 'Violet Team', hex: '#7C3AED' },
  { label: 'White Ops', hex: '#E2E8F0' },
];

export const PLAYER_BLOCK_SWATCHES: readonly { label: string; hex: string }[] = [
  { label: 'Dirt', hex: '#7F5539' },
  { label: 'Turf', hex: '#5E8C4A' },
  { label: 'Stone', hex: '#94A3B8' },
  { label: 'Brick', hex: '#B91C1C' },
  { label: 'Sand', hex: '#EAB308' },
  { label: 'Blue', hex: '#2B6CB0' },
];

/**
 * Euler order used on individual player limb meshes (`R_x(rotX) * R_y(rotY)`).
 * Using `'XYZ'` ensures the `rotY = Math.PI` KV6 flip happens BEFORE `rotX`,
 * matching ZeroSpades's `RotateX(pitch) * Scale(-1, -1, 1)` so positive aim
 * pitch tilts both head and arms upward together.
 */
export const PLAYER_PART_EULER_ORDER: THREE.EulerOrder = 'XYZ';

export interface PlayerPartKeySet {
  head: PlayerKv6PartKey;
  torso: PlayerKv6PartKey;
  arms: PlayerKv6PartKey;
  legLeft: PlayerKv6PartKey;
  legRight: PlayerKv6PartKey;
  tool: PlayerKv6PartKey;
  corpse: PlayerKv6PartKey;
}

export interface PartLocalTransform {
  position: [number, number, number];
  rotationX: number;
  rotationY: number;
  scale: number;
}

export interface PlayerPoseTransforms {
  /** Feet Y adjustment if stance lowers hips (0 for standing, crouched hip offset, etc.). */
  hipY: number;
  legLeft: PartLocalTransform;
  legRight: PartLocalTransform;
  torso: PartLocalTransform;
  head: PartLocalTransform;
  arms: PartLocalTransform;
  /** Transform of held weapon/tool relative to the `arms` group (so it pitches with the arms). */
  toolInArms: PartLocalTransform;
}

const MAX_PLAYER_CACHE_ENTRIES = 192;

const baseGridCache = new Map<PlayerKv6PartKey, Kv6Grid>();
const recoloredDataCache = new Map<string, BuiltVoxelMeshData>();
const geometryCache = new Map<string, THREE.BufferGeometry>();

function touchCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V): void {
  cache.delete(key);
  cache.set(key, value);
}

export function normalizeHexColor(hex: string, fallback = '#2B6CB0'): string {
  const trimmed = hex.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
    return withHash.toUpperCase();
  }
  return fallback;
}

export function parseHexColorToPacked(hex: string, fallback = '#2B6CB0'): number {
  const norm = normalizeHexColor(hex, fallback);
  const rgb = parseInt(norm.slice(1), 16) & 0xffffff;
  return ((0xff << 24) | rgb) >>> 0;
}

/**
 * Decodes and caches a parsed Kv6Grid for a bundled ZeroSpades player/weapon part.
 */
export function getBasePlayerPartGrid(partKey: PlayerKv6PartKey): Kv6Grid {
  const cached = baseGridCache.get(partKey);
  if (cached) return cached;
  const bytes = decodeBase64ToUint8Array(PLAYER_KV6_BASE64[partKey]);
  const grid = parseKv6(bytes);
  baseGridCache.set(partKey, grid);
  return grid;
}

/**
 * Clones a Kv6Grid and replaces exact (0,0,0) sentinel voxels (0xFF000000) with
 * `customPackedColor`, leaving dark eyes/boots/hair (8,8,8 etc.) untouched.
 */
export function recolorKv6SentinelGrid(grid: Kv6Grid, customColorHex: string): Kv6Grid {
  const packed = parseHexColorToPacked(customColorHex);
  const replaceSentinel = (v: number): number => {
    if (v === 0) return 0;
    return (v & 0xffffff) === 0 ? packed : v;
  };

  if (grid.dense) {
    const nextDense = new Uint32Array(grid.dense.length);
    for (let i = 0; i < grid.dense.length; i++) {
      nextDense[i] = replaceSentinel(grid.dense[i]);
    }
    return new Kv6Grid(
      grid.width,
      grid.height,
      grid.depth,
      [grid.pivot[0], grid.pivot[1], grid.pivot[2]],
      grid.voxelCount,
      nextDense,
      null,
      null,
      0,
    );
  }

  const nextVals = grid.sparseVals ? new Uint32Array(grid.sparseVals.length) : null;
  if (nextVals && grid.sparseVals) {
    for (let i = 0; i < grid.sparseVals.length; i++) {
      nextVals[i] = replaceSentinel(grid.sparseVals[i]);
    }
  }
  return new Kv6Grid(
    grid.width,
    grid.height,
    grid.depth,
    [grid.pivot[0], grid.pivot[1], grid.pivot[2]],
    grid.voxelCount,
    null,
    grid.sparseKeys ? new Uint32Array(grid.sparseKeys) : null,
    nextVals,
    grid.sparseMask,
  );
}

/**
 * Builds greedy-meshed geometry data for a player/weapon part with the
 * ZeroSpades KV6 pivot shifted to local origin (0, 0, 0).
 */
export function buildPivotCenteredPartData(
  partKey: PlayerKv6PartKey,
  customColorHex?: string,
): BuiltVoxelMeshData {
  const normColor = customColorHex ? normalizeHexColor(customColorHex) : 'RAW';
  const cacheKey = `${partKey}:${normColor}`;
  const cached = recoloredDataCache.get(cacheKey);
  if (cached) {
    touchCacheEntry(recoloredDataCache, cacheKey, cached);
    return cached;
  }

  const baseGrid = getBasePlayerPartGrid(partKey);
  const grid = customColorHex ? recolorKv6SentinelGrid(baseGrid, normColor) : baseGrid;
  const meshData = buildVoxelGeometryData(grid);

  // Align mesher coordinates (which center X/Z and ground Y at 0) so the
  // Voxlap KV6 pivot sits at (0, 0, 0).
  const pivX = grid.pivot[0] + 0.5 - grid.width * 0.5;
  const pivY = grid.pivot[1] + 0.5;
  const pivZ = grid.pivot[2] + 0.5 - grid.depth * 0.5;

  const pos = meshData.positions;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] -= pivX;
    pos[i + 1] -= pivY;
    pos[i + 2] -= pivZ;
  }

  if (recoloredDataCache.size >= MAX_PLAYER_CACHE_ENTRIES) {
    const oldestKey = recoloredDataCache.keys().next().value;
    if (oldestKey !== undefined) {
      recoloredDataCache.delete(oldestKey);
    }
  }
  recoloredDataCache.set(cacheKey, meshData);
  return meshData;
}

/**
 * Returns a cached Three.js BufferGeometry centered on the ZeroSpades KV6 pivot.
 */
export function getPlayerPartGeometry(
  partKey: PlayerKv6PartKey,
  customColorHex?: string,
): THREE.BufferGeometry {
  const normColor = customColorHex ? normalizeHexColor(customColorHex) : 'RAW';
  const cacheKey = `${partKey}:${normColor}`;
  const cached = geometryCache.get(cacheKey);
  if (cached) {
    touchCacheEntry(geometryCache, cacheKey, cached);
    return cached;
  }

  const data = buildPivotCenteredPartData(partKey, customColorHex);
  const hydrated = hydrateVoxelGeometry(data);
  geometryCache.set(cacheKey, hydrated.geometry);
  return hydrated.geometry;
}

/**
 * Safely evicts and disposes the oldest unused cached player geometries above
 * MAX_PLAYER_CACHE_ENTRIES without touching geometries actively mounted in the scene.
 */
export function prunePlayerModelGeometryCache(
  activeGeometries: ReadonlySet<THREE.BufferGeometry>,
  maxEntries = MAX_PLAYER_CACHE_ENTRIES,
): number {
  if (geometryCache.size <= maxEntries) return 0;
  let disposed = 0;
  for (const [key, geo] of geometryCache.entries()) {
    if (geometryCache.size <= maxEntries) break;
    if (activeGeometries.has(geo)) continue;
    geometryCache.delete(key);
    geo.dispose();
    disposed++;
  }
  return disposed;
}

export function disposePlayerModelGeometryCache(): void {
  for (const geo of geometryCache.values()) {
    geo.dispose();
  }
  geometryCache.clear();
  recoloredDataCache.clear();
}

/**
 * Selects ZeroSpades KV6 part keys matching character type, style, stance, and weapon.
 * Zombies always use the ZeroSpades `Zombie/*` limb/corpse models and hold a spade.
 */
export function selectPlayerPartKeys(
  style: PlayerStyle,
  stance: PlayerStance,
  weapon: PlayerWeapon,
  characterType: PlayerCharacterType = 'player',
): PlayerPartKeySet {
  const crouched = stance === 'crouched';
  const toolMap: Record<PlayerWeapon, PlayerKv6PartKey> = {
    rifle: 'weapon_rifle',
    shotgun: 'weapon_shotgun',
    smg: 'weapon_smg',
    grenade: 'weapon_grenade',
    spade: 'weapon_spade',
    block: 'weapon_block',
  };

  if (characterType === 'zombie') {
    return {
      head: 'zombie_head',
      torso: crouched ? 'zombie_torso_crouch' : 'zombie_torso',
      arms: 'zombie_arms',
      legLeft: crouched ? 'zombie_leg_crouch' : 'zombie_leg',
      legRight: crouched ? 'zombie_leg_right_crouch' : 'zombie_leg_right',
      tool: 'weapon_spade',
      corpse: 'zombie_dead',
    };
  }

  if (style === 'classic') {
    return {
      head: 'classic_head',
      torso: crouched ? 'classic_torso_crouch' : 'classic_torso',
      arms: 'classic_arms',
      legLeft: crouched ? 'classic_leg_crouch' : 'classic_leg',
      legRight: crouched ? 'classic_leg_crouch' : 'classic_leg',
      tool: toolMap[weapon],
      corpse: 'classic_dead',
    };
  }

  const classPrefix: 'rifle' | 'shotgun' | 'smg' =
    weapon === 'shotgun' ? 'shotgun' : weapon === 'smg' ? 'smg' : 'rifle';

  return {
    head: `${classPrefix}_head`,
    torso: crouched ? `${classPrefix}_torso_crouch` : `${classPrefix}_torso`,
    arms: 'rifle_arms',
    legLeft: crouched ? 'rifle_leg_crouch' : 'rifle_leg',
    legRight: crouched ? 'rifle_leg_right_crouch' : 'rifle_leg_right',
    tool: toolMap[weapon],
    corpse: `${classPrefix}_dead`,
  };
}

/**
 * Computes the local transform for a ZeroSpades `Dead.kv6` corpse model so its
 * lowest voxel rests flush on `y = 0` at `scale = 0.1`.
 */
export function computeCorpseTransform(corpsePartKey: PlayerKv6PartKey): PartLocalTransform {
  const data = buildPivotCenteredPartData(corpsePartKey);
  let minY = Infinity;
  for (let i = 1; i < data.positions.length; i += 3) {
    if (data.positions[i] < minY) minY = data.positions[i];
  }
  const scale = 0.1;
  const groundOffsetY = Number.isFinite(minY) ? -minY * scale : 0.2;
  return {
    position: [0, groundOffsetY, 0],
    rotationX: 0,
    rotationY: Math.PI,
    scale,
  };
}

/**
 * Computes exact third-person ZeroSpades limb & tool transforms in Three.js Y-up
 * space relative to the player's feet at (0, 0, 0), facing -Z when yaw = 0.
 *
 * Coordinate conversion from ZeroSpades AoS (X east, Y south, Z down):
 *   P(x, y, z) = (x, -z, y)
 *   - AoS Scale(0.1) * Scale(-1, -1, 1) -> scale 0.1 + rotateY(PI)
 *   - AoS R_x(pitch) -> R_x(+pitch)
 */
export function computePlayerPoseTransforms(
  stance: PlayerStance,
  _weapon: PlayerWeapon,
  pitchDeg: number,
): PlayerPoseTransforms {
  const clampedPitchDeg = Math.max(-45, Math.min(45, pitchDeg));
  const pitchRad = (clampedPitchDeg * Math.PI) / 180;
  const crouched = stance === 'crouched';
  const sprinting = stance === 'sprinting';

  // Height from feet (y = 0) to ZeroSpades torso/hip origin (`p.GetOrigin()`).
  // Standing Leg.kv6 bottom voxel reaches -11.5 * 0.1 = -1.15 below leg hip (+0.10 above origin),
  // so origin = 1.05 puts boots flush on y = 0.00.
  // Crouched LegCrouch.kv6 reaches -6.5 * 0.1 = -0.65 below leg hip (+0.05 above origin),
  // so origin = 0.60 puts crouched boots flush on y = 0.00.
  // When sprinting, the 0.58 rad leg swing lowers reach by ~0.12, so lower origin by 0.11.
  const hipY = crouched ? 0.6 : sprinting ? 0.94 : 1.05;

  const legsPosX = 0.25;
  const legsPosZ = crouched ? 0.25 : 0.0;
  const legsPosY = crouched ? 0.05 : 0.1;
  const torsoPosY = crouched ? 0.5 : 1.0;
  const headPosY = crouched ? 0.05 : 0.0;
  const armsPosY = crouched ? 0.0 : -0.1;

  let armPitch = pitchRad;
  if (sprinting) {
    armPitch -= 0.9;
  }
  if (armPitch < 0) {
    armPitch = Math.max(armPitch, -Math.PI * 0.5) * 0.9;
  }

  const legStrideAngle = sprinting ? 0.58 : 0.0;

  return {
    hipY,
    legLeft: {
      position: [-legsPosX, hipY + legsPosY, legsPosZ],
      rotationX: -legStrideAngle,
      rotationY: Math.PI,
      scale: 0.1,
    },
    legRight: {
      position: [legsPosX, hipY + legsPosY, legsPosZ],
      rotationX: legStrideAngle,
      rotationY: Math.PI,
      scale: 0.1,
    },
    torso: {
      position: [0, hipY + torsoPosY, 0],
      rotationX: 0,
      rotationY: Math.PI,
      scale: 0.1,
    },
    head: {
      position: [0, hipY + torsoPosY + headPosY, 0],
      rotationX: pitchRad,
      rotationY: Math.PI,
      scale: 0.1,
    },
    arms: {
      position: [0, hipY + torsoPosY + armsPosY, 0],
      rotationX: armPitch,
      rotationY: Math.PI,
      scale: 0.1,
    },
    toolInArms: {
      // Relative to un-scaled/un-rotated arms origin (where -Z is forward & +X is right)
      position: [0.4, 0.0, -0.9],
      rotationX: 0,
      rotationY: Math.PI,
      scale: 0.051,
    },
  };
}

export function generatePlayerId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `player-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export const DEFAULT_ZOMBIE_CLOTH_COLOR = '#2F855A';

export function createSpawnedPlayer(
  x: number,
  y: number,
  z: number,
  overrides?: Partial<Omit<SpawnedPlayer, 'id' | 'x' | 'y' | 'z'>>,
): SpawnedPlayer {
  const characterType: PlayerCharacterType = overrides?.characterType ?? 'player';
  const weapon: PlayerWeapon =
    characterType === 'zombie' ? 'spade' : (overrides?.weapon ?? 'rifle');
  const defaultTeamColor =
    characterType === 'zombie' ? DEFAULT_ZOMBIE_CLOTH_COLOR : '#2B6CB0';
  return {
    id: generatePlayerId(),
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    z: Math.round(z * 100) / 100,
    yaw: overrides?.yaw ?? 0,
    pitch: overrides?.pitch ?? 0,
    characterType,
    stance: overrides?.stance ?? 'standing',
    weapon,
    style: overrides?.style ?? 'classic',
    teamColor: overrides?.teamColor ?? defaultTeamColor,
    blockColor: overrides?.blockColor ?? '#7F5539',
  };
}

export function createSpawnedPlayerFromPreset(
  preset: PlayerSpawnPreset,
  x: number,
  y: number,
  z: number,
): SpawnedPlayer {
  switch (preset) {
    case 'zombie':
      return createSpawnedPlayer(x, y, z, {
        characterType: 'zombie',
        stance: 'standing',
        weapon: 'spade',
      });
    case 'player_corpse':
      return createSpawnedPlayer(x, y, z, {
        characterType: 'player',
        stance: 'corpse',
      });
    case 'zombie_corpse':
      return createSpawnedPlayer(x, y, z, {
        characterType: 'zombie',
        stance: 'corpse',
        weapon: 'spade',
      });
    case 'player':
    default:
      return createSpawnedPlayer(x, y, z, {
        characterType: 'player',
        stance: 'standing',
      });
  }
}

/**
 * Applies a partial update to a SpawnedPlayer while enforcing ZeroSpades invariants
 * (zombies always hold spades).
 */
export function applySpawnedPlayerPatch(
  player: SpawnedPlayer,
  patch: Partial<SpawnedPlayer>,
): SpawnedPlayer {
  const next: SpawnedPlayer = { ...player, ...patch };
  if (next.characterType === 'zombie') {
    next.weapon = 'spade';
  }
  return next;
}

/**
 * Duplicates a spawned player in its exact current state (stance, weapon, style,
 * teamColor, blockColor, yaw, pitch), placing the clone cleanly beside the source
 * without overlapping another player or leaving map bounds.
 */
export function duplicateSpawnedPlayer(
  source: SpawnedPlayer,
  existingPlayers: readonly SpawnedPlayer[],
  mapSize?: { width: number; height: number; depth: number } | null,
): SpawnedPlayer | null {
  if (existingPlayers.length >= MAX_SPAWNED_PLAYERS) return null;

  const halfW = mapSize ? mapSize.width * 0.5 - 1 : 255;
  const halfD = mapSize ? mapSize.depth * 0.5 - 1 : 255;
  const maxH = mapSize ? mapSize.height + 8 : 128;

  const clampX = (vx: number) => Math.max(-halfW, Math.min(halfW, vx));
  const clampZ = (vz: number) => Math.max(-halfD, Math.min(halfD, vz));
  const clampY = (vy: number) => Math.max(0, Math.min(maxH, vy));

  // Try side steps perpendicular to facing direction, then spiral offsets until free.
  const yawRad = (source.yaw * Math.PI) / 180;
  const rightX = Math.cos(yawRad);
  const rightZ = -Math.sin(yawRad);
  const fwdX = -Math.sin(yawRad);
  const fwdZ = -Math.cos(yawRad);

  const candidates: [number, number][] = [];
  for (let step = 1; step <= 8; step++) {
    const d = step * 2.2;
    candidates.push([source.x + rightX * d, source.z + rightZ * d]);
    candidates.push([source.x - rightX * d, source.z - rightZ * d]);
    candidates.push([source.x + fwdX * d, source.z + fwdZ * d]);
    candidates.push([source.x - fwdX * d, source.z - fwdZ * d]);
  }

  let chosenX = clampX(source.x + 2.2);
  let chosenZ = clampZ(source.z);
  for (const [cx, cz] of candidates) {
    const x = clampX(cx);
    const z = clampZ(cz);
    const occupied = existingPlayers.some(
      (p) => Math.hypot(p.x - x, p.z - z) < 1.3 && Math.abs(p.y - source.y) < 2.2,
    );
    if (!occupied) {
      chosenX = x;
      chosenZ = z;
      break;
    }
  }

  return {
    ...source,
    id: generatePlayerId(),
    x: Math.round(chosenX * 100) / 100,
    y: Math.round(clampY(source.y) * 100) / 100,
    z: Math.round(chosenZ * 100) / 100,
  };
}

/**
 * Finds the highest solid voxel surface directly beneath or near `(worldX, worldY, worldZ)`
 * in a `.vxl` grid so a player can snap cleanly onto the terrain/roof below.
 */
export function snapPlayerYToGround(
  grid: VoxelGrid | null,
  worldX: number,
  currentY: number,
  worldZ: number,
): number {
  if (!grid) return currentY;
  const gx = Math.max(0, Math.min(grid.width - 1, Math.floor(worldX + grid.width * 0.5)));
  const gz = Math.max(0, Math.min(grid.depth - 1, Math.floor(worldZ + grid.depth * 0.5)));
  const startGy = Math.max(0, Math.min(grid.height - 1, Math.floor(currentY + 1)));
  for (let gy = startGy; gy >= 0; gy--) {
    if (grid.isSolid(gx, gy, gz)) {
      return gy + 1;
    }
  }
  for (let gy = grid.height - 1; gy >= 0; gy--) {
    if (grid.isSolid(gx, gy, gz)) {
      return gy + 1;
    }
  }
  return 0;
}
