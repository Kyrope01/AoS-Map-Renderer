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

export type ShaderMode =
  | 'pbr'
  | 'atmospheric'
  | 'diorama'
  | 'cinema'
  | 'clay'
  | 'ao'
  | 'voxlap'
  | 'toon'
  | 'rim'
  | 'topographic'
  | 'cyber'
  | 'matcap'
  | 'blueprint'
  | 'hologram';

export type BackdropPreset =
  | 'overcast'
  | 'golden'
  | 'alpine'
  | 'dusk'
  | 'midnight'
  | 'graphite'
  | 'paper';

export type CameraPreset = 'iso' | 'front' | 'side' | 'top' | 'low';

export type CameraMode = 'orbit' | 'free';

export type FogMode = 'ingame' | 'atmospheric';

export type SliceAxis = 'none' | 'x' | 'y' | 'z';

export type MatcapStyle = 'chrome' | 'pearl' | 'terracotta' | 'jade';

export interface RenderSettings {
  shaderMode: ShaderMode;
  backdrop: BackdropPreset;
  // Surface & shader parameters
  aoStrength: number;       // 0..1.5
  bevelStrength: number;    // 0..1.0
  roughness: number;        // 0.05..1.0
  metalness: number;        // 0..1.0
  outlineStrength: number;  // 0..1.0
  clayTint: string;         // hex color for clay/blueprint tint
  matcapStyle: MatcapStyle;
  // Section slicing
  sliceAxis: SliceAxis;
  slicePosition: number;    // 0..1.0 normalized
  // Sky, Sun & Fog + Additive Bottom Volumetric Clouds
  lightAzimuth: number;     // degrees 0..360
  lightElevation: number;   // degrees 5..85
  lightIntensity: number;   // 0.3..2.5
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
  // Stage, Ocean & Post
  showPedestal: boolean;    // circular plate for .kv6
  waterColorOverride: string; // empty = sampled .vxl water color
  waveStrength: number;     // 0..1.0 ocean ripple & shimmer
  showGrid: boolean;
  autoRotate: boolean;
  orthographic: boolean;
  exposure: number;         // 0.6..1.6
  bloomStrength: number;    // 0..1.0
  tiltShift: number;        // 0..1.0 miniature DOF blur
  vignette: number;         // 0..1.0
  chromatic: number;        // 0..1.0
  pixelate: number;         // 0 (off) or 2..8
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

export class VoxelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoxelParseError';
  }
}
