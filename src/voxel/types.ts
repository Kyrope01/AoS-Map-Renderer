export type VoxelFormat = 'kv6' | 'vxl';

export interface VoxelGrid {
  readonly format: VoxelFormat;
  readonly width: number;  // X (Three.js right)
  readonly height: number; // Y (Three.js up)
  readonly depth: number;  // Z (Three.js forward)
  readonly voxelCount: number;
  readonly pivot: readonly [number, number, number];
  /** Dominant exposed water-level (gy=0) RGB color for .vxl maps, or null. */
  readonly waterColor: number | null;
  isSolid(x: number, y: number, z: number): boolean;
  /** Returns 0 if air, or 0xFF000000 | (r << 16) | (g << 8) | b if solid. */
  getColor(x: number, y: number, z: number): number;
  /** Iterates all solid voxels within optional region bounds. */
  forEachSolid?(
    cb: (x: number, y: number, z: number, color: number) => void,
    bounds?: RegionBounds,
  ): void;
}

export interface RegionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type ShaderCategory = 'cinematic';

export type ShaderMode =
  | 'atmospheric'
  | 'diorama'
  | 'cinema'
  | 'voxlap';

export type BackdropPreset =
  | 'overcast'
  | 'golden'
  | 'alpine'
  | 'dusk'
  | 'midnight'
  | 'graphite'
  | 'paper'
  | 'custom';

export type CameraPreset = 'iso' | 'front' | 'side' | 'top' | 'low';

export type CameraMode = 'orbit' | 'free';

export type FogMode = 'ingame' | 'atmospheric';

export type SliceAxis = 'none' | 'x' | 'y' | 'z';

export interface RenderSettings {
  shaderMode: ShaderMode;
  backdrop: BackdropPreset;
  // Custom sky parameters
  customZenithColor: string;    // hex e.g. '#2F6FB3'
  customHorizonColor: string;   // hex e.g. '#CBE3F5'
  // Material & shader parameters
  aoStrength: number;       // 0..1.5
  roughness: number;        // 0.05..1.0
  metalness: number;        // 0..1.0
  outlineStrength: number;  // 0..1.0
  // Cross-section slicing
  sliceAxis: SliceAxis;
  slicePosition: number;    // 0..1.0 normalized
  // Sky, Sun & Fog + Additive Bottom Volumetric Clouds
  lightAzimuth: number;     // degrees 0..360
  lightElevation: number;   // degrees 0..85
  lightIntensity: number;   // 0..2.5
  sunColor: string;         // hex sunlight color
  fogMode: FogMode;         // ingame | atmospheric
  fogColor: string;         // hex fog color
  fogSyncSky: boolean;      // auto-match fogColor to sky horizon
  fogDensity: number;       // 0..2.5 multiplier
  fogRange: number;         // 40..900 voxels (AoS in-game linear fog distance)
  heightFog: number;        // 0..1.0 low-altitude valley mist
  volumetricClouds: boolean; // additive dense billowing clouds at bottom of map
  volumetricStrength: number; // 0..1.5 volumetric cloud density
  cloudAltitude: number;    // 0.12..0.75 normalized cloud ceiling height
  // Camera & Navigation
  cameraMode: CameraMode;   // orbit | free
  cameraFov: number;        // 24..95 degrees
  flySpeed: number;         // 10..240 units/sec
  // View, Ocean & Post
  showPedestal: boolean;    // circular plate for .kv6
  waterColorOverride: string; // empty = sampled .vxl water color
  waveStrength: number;     // 0..1.0 ocean ripple & shimmer
  autoRotate: boolean;
  autoRotateSpeed: number;  // 0.2..10.0
  orthographic: boolean;
  exposure: number;         // 0.6..1.6
  bloomStrength: number;    // 0..1.0
  godRays: boolean;         // volumetric light rays from sun/moon
  godRaysIntensity: number; // 0.1..1.5
  tiltShift: number;        // 0..1.0 miniature DOF blur
  vignette: number;         // 0..1.0
  chromatic: number;        // 0..1.0
  pixelate: number;         // 0 (off) or 2..8
}

/**
 * A point light anchored to a single voxel in the loaded grid.
 * Coordinates are voxel-grid indices (x: 0..width-1, y: 0..height-1, z: 0..depth-1).
 */
export const MAX_VOXEL_LIGHTS = 512;

export interface VoxelLight {
  id: string;
  x: number;
  y: number;
  z: number;
  normal: [number, number, number]; // picked surface normal
  intensity: number; // 0..100 (0 = off)
  range: number;     // 4..120 voxels (light falloff distance)
  color: string;     // hex e.g. '#FFB35C'
}

export interface MeshStats {
  name: string;
  format: VoxelFormat;
  width: number;
  height: number;
  depth: number;
  voxelCount: number;
  quadCount: number;
  triangleCount: number;
  waterColorHex: string | null;
  parseMs: number;
  meshMs: number;
}

export type PlayerCharacterType = 'player' | 'zombie';

export type PlayerStance = 'standing' | 'crouched' | 'sprinting' | 'corpse';

export type PlayerWeapon = 'rifle' | 'shotgun' | 'smg' | 'grenade' | 'spade' | 'block';

export type PlayerStyle = 'classic' | 'tactical';

export type PlayerSpawnPreset = 'player' | 'zombie' | 'player_corpse' | 'zombie_corpse';

export const MAX_SPAWNED_PLAYERS = 64;

export interface SpawnedPlayer {
  id: string;
  /** World X coordinate (Three.js scene space, centered around 0). */
  x: number;
  /** World Y coordinate of the player's feet. */
  y: number;
  /** World Z coordinate (Three.js scene space, centered around 0). */
  z: number;
  /** Facing azimuth in degrees (0..360, 0 faces -Z). */
  yaw: number;
  /** Aim / look pitch in degrees (-45..+45). */
  pitch: number;
  characterType: PlayerCharacterType;
  stance: PlayerStance;
  weapon: PlayerWeapon;
  style: PlayerStyle;
  /** Hex color for player uniform / armor (0,0,0 sentinel in .kv6). */
  teamColor: string;
  /** Hex color for held Block tool (0,0,0 sentinel in Block.kv6). */
  blockColor: string;
  /** Flashlight state */
  flashlight: {
    enabled: boolean;
    reach: number;      // 0..255 (0 = no light)
    cone: number;       // 0..255 (255 = ~179.3 degrees)
    red: number;        // 0..255
    green: number;      // 0..255
    blue: number;       // 0..255
    intensity: number; // 0..255 (0 = off, 255 = full)
  };
}

export class VoxelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoxelParseError';
  }
}
