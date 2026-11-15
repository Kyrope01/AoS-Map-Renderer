import * as THREE from 'three';
import {
  BackdropPreset,
  FogMode,
  RenderSettings,
  ShaderCategory,
  ShaderMode,
} from '../voxel/types';

export interface BackdropTheme {
  id: BackdropPreset;
  label: string;
  bgHex: string;
  zenithHex: string;
  horizonHex: string;
  fogHex: string;
  fogDensity: number;
  skyHex: string;
  groundHex: string;
  defaultSunHex: string;
  isLight: boolean;
  isSkyDome: boolean;
}

export const BACKDROP_THEMES: Record<BackdropPreset, BackdropTheme> = {
  alpine: {
    id: 'alpine',
    label: 'Clear Alpine',
    bgHex: '#9AC6EA',
    zenithHex: '#2F6FB3',
    horizonHex: '#CBE3F5',
    fogHex: '#CBE3F5',
    fogDensity: 0.0024,
    skyHex: '#E5F2FF',
    groundHex: '#556554',
    defaultSunHex: '#FFF7E2',
    isLight: true,
    isSkyDome: true,
  },
  overcast: {
    id: 'overcast',
    label: 'Nordic Sky',
    bgHex: '#C5D3DF',
    zenithHex: '#6E8EB0',
    horizonHex: '#CEDAE4',
    fogHex: '#CEDAE4',
    fogDensity: 0.0028,
    skyHex: '#DCE9F6',
    groundHex: '#59636C',
    defaultSunHex: '#FFF6E8',
    isLight: true,
    isSkyDome: true,
  },
  golden: {
    id: 'golden',
    label: 'Golden Hour',
    bgHex: '#E7B48B',
    zenithHex: '#3B5680',
    horizonHex: '#F2BC8D',
    fogHex: '#EAB48B',
    fogDensity: 0.0032,
    skyHex: '#FFD8B0',
    groundHex: '#5C4438',
    defaultSunHex: '#FFC684',
    isLight: false,
    isSkyDome: true,
  },
  dusk: {
    id: 'dusk',
    label: 'Crimson Dusk',
    bgHex: '#9C6D7E',
    zenithHex: '#212645',
    horizonHex: '#C9837D',
    fogHex: '#B1797D',
    fogDensity: 0.0035,
    skyHex: '#E6A8A0',
    groundHex: '#3A2C34',
    defaultSunHex: '#FF9875',
    isLight: false,
    isSkyDome: true,
  },
  midnight: {
    id: 'midnight',
    label: 'Moonlit Night',
    bgHex: '#131C2B',
    zenithHex: '#070B14',
    horizonHex: '#1C293D',
    fogHex: '#192537',
    fogDensity: 0.0038,
    skyHex: '#7A9AC8',
    groundHex: '#10151E',
    defaultSunHex: '#BBD6FF',
    isLight: false,
    isSkyDome: true,
  },
  graphite: {
    id: 'graphite',
    label: 'Pitch Black',
    bgHex: '#000000',
    zenithHex: '#000000',
    horizonHex: '#000000',
    fogHex: '#000000',
    fogDensity: 0.0022,
    skyHex: '#DCE6F5',
    groundHex: '#2B2825',
    defaultSunHex: '#FFF6EB',
    isLight: false,
    isSkyDome: false,
  },
  paper: {
    id: 'paper',
    label: 'Warm Paper',
    bgHex: '#EAE5DC',
    zenithHex: '#F3EFE8',
    horizonHex: '#E7E1D6',
    fogHex: '#EAE5DC',
    fogDensity: 0.002,
    skyHex: '#FFFDF8',
    groundHex: '#8E8478',
    defaultSunHex: '#FFF9F0',
    isLight: true,
    isSkyDome: false,
  },
};

export interface ShaderPresetMeta {
  id: ShaderMode;
  category: ShaderCategory;
  label: string;
  description: string;
}

export const SHADER_CATEGORIES: { id: ShaderCategory; label: string }[] = [
  { id: 'cinematic', label: 'Map & Cinematic' },
];

export const SHADER_PRESETS: ShaderPresetMeta[] = [
  { id: 'atmospheric', category: 'cinematic', label: 'Scenic GI', description: 'Soft sky bounce & aerial mist' },
  { id: 'pbr', category: 'cinematic', label: 'Studio PBR', description: 'Physical reflections & AO' },
  { id: 'cinema', category: 'cinematic', label: 'Cinema Warm', description: 'Golden sun & teal shadows' },
  { id: 'diorama', category: 'cinematic', label: 'Diorama', description: 'Crisp miniature model bounce' },
  { id: 'voxlap', category: 'cinematic', label: 'Voxlap 2011', description: 'Classic AoS face shading' },
  { id: 'rim', category: 'cinematic', label: 'Chiaroscuro', description: 'Warm key light & cool rim' },
];

export interface SharedShaderUniforms {
  uTime: { value: number };
  uAoStrength: { value: number };
  uOutlineStrength: { value: number };
  uRoughness: { value: number };
  uMetalness: { value: number };
  uModelRadius: { value: number };
  uModelHeight: { value: number };
  uSliceAxis: { value: number };
  uSliceCoord: { value: number };
  uLightDir: { value: THREE.Vector3 };
  uLightColor: { value: THREE.Color };
  uLightIntensity: { value: number };
  uSkyColor: { value: THREE.Color };
  uGroundColor: { value: THREE.Color };
  uZenithColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uFogMode: { value: number };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uFogStrength: { value: number };
  uFogRange: { value: number };
  uHeightFog: { value: number };
  uVolumetricClouds: { value: number };
  uVolumetricStrength: { value: number };
  uCloudAltitude: { value: number };
  uShowSky: { value: number };
}

export function createSharedUniforms(): SharedShaderUniforms {
  return {
    uTime: { value: 0 },
    uAoStrength: { value: 0.9 },
    uOutlineStrength: { value: 0.0 },
    uRoughness: { value: 0.55 },
    uMetalness: { value: 0.06 },
    uModelRadius: { value: 120 },
    uModelHeight: { value: 64 },
    uSliceAxis: { value: 0 },
    uSliceCoord: { value: 1000 },
    uLightDir: { value: new THREE.Vector3(0.55, 0.75, 0.35).normalize() },
    uLightColor: { value: new THREE.Color('#FFF7E2') },
    uLightIntensity: { value: 1.3 },
    uSkyColor: { value: new THREE.Color('#E5F2FF') },
    uGroundColor: { value: new THREE.Color('#556554') },
    uZenithColor: { value: new THREE.Color('#2F6FB3') },
    uHorizonColor: { value: new THREE.Color('#CBE3F5') },
    uFogMode: { value: 1 },
    uFogColor: { value: new THREE.Color('#CBE3F5') },
    uFogDensity: { value: 0.0024 },
    uFogStrength: { value: 1.0 },
    uFogRange: { value: 320 },
    uHeightFog: { value: 0.2 },
    uVolumetricClouds: { value: 0 },
    uVolumetricStrength: { value: 0.85 },
    uCloudAltitude: { value: 0.34 },
    uShowSky: { value: 1.0 },
  };
}

const FOG_MODE_INDEX: Record<FogMode, number> = {
  atmospheric: 0,
  ingame: 1,
};

export function syncSharedUniforms(
  uniforms: SharedShaderUniforms,
  settings: RenderSettings,
  bounds: THREE.Box3,
  lightDir: THREE.Vector3,
  lightColor: THREE.Color,
  resolvedFogColor: THREE.Color,
  scaledFogDensity: number,
): void {
  uniforms.uAoStrength.value = settings.aoStrength;
  uniforms.uOutlineStrength.value = settings.outlineStrength;
  uniforms.uRoughness.value = settings.roughness;
  uniforms.uMetalness.value = settings.metalness;
  uniforms.uLightDir.value.copy(lightDir);
  uniforms.uLightColor.value.copy(lightColor);
  uniforms.uLightIntensity.value = settings.lightIntensity;

  const theme = BACKDROP_THEMES[settings.backdrop];
  uniforms.uSkyColor.value.set(theme.skyHex);
  uniforms.uGroundColor.value.set(theme.groundHex);
  uniforms.uZenithColor.value.set(theme.zenithHex);
  uniforms.uHorizonColor.value.set(theme.horizonHex);
  uniforms.uFogMode.value = FOG_MODE_INDEX[settings.fogMode];
  uniforms.uFogColor.value.copy(resolvedFogColor);
  uniforms.uFogDensity.value = scaledFogDensity;
  uniforms.uFogStrength.value = settings.fogDensity;
  uniforms.uFogRange.value = settings.fogRange;
  uniforms.uHeightFog.value = settings.heightFog;
  uniforms.uVolumetricClouds.value = settings.volumetricClouds ? 1.0 : 0.0;
  uniforms.uVolumetricStrength.value = settings.volumetricStrength;
  uniforms.uCloudAltitude.value = settings.cloudAltitude;
  uniforms.uShowSky.value = theme.isSkyDome ? 1.0 : 0.0;

  const size = new THREE.Vector3();
  bounds.getSize(size);
  uniforms.uModelRadius.value = Math.max(4, size.length() * 0.5);
  uniforms.uModelHeight.value = Math.max(8, size.y);

  if (settings.sliceAxis === 'none') {
    uniforms.uSliceAxis.value = 0;
    uniforms.uSliceCoord.value = 1e6;
  } else if (settings.sliceAxis === 'x') {
    uniforms.uSliceAxis.value = 1;
    uniforms.uSliceCoord.value = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, settings.slicePosition);
  } else if (settings.sliceAxis === 'y') {
    uniforms.uSliceAxis.value = 2;
    uniforms.uSliceCoord.value = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, settings.slicePosition);
  } else {
    uniforms.uSliceAxis.value = 3;
    uniforms.uSliceCoord.value = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, settings.slicePosition);
  }
}

/**
 * Shared GLSL snippet for distance fog (In-Game AoS or Atmospheric) PLUS
 * additive raymarched 3D Volumetric Clouds pooling along the bottom of the map.
 */
const FOG_AND_VOLUMETRIC_GLSL = /* glsl */ `
  float hgPhase(float cosTheta, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * 3.14159 * pow(max(0.05, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
  }

  float cloudFbm(vec3 p) {
    float v = noise3D(p) * 0.64;
    v += noise3D(p * 2.09 + vec3(11.3, 5.7, 8.2)) * 0.36;
    return v;
  }

  vec3 computeSceneFog(vec3 col, vec3 worldPos, float depthDist, float extraHorizonFade) {
    vec3 rayVec = worldPos - cameraPosition;
    float rayLen = max(length(rayVec), 0.001);
    vec3 rayDir = rayVec / rayLen;
    vec3 sunDir = normalize(uLightDir);
    float cosSun = dot(rayDir, sunDir);
    float camOffset = max(0.0, length(cameraPosition) - uModelRadius * 0.85);

    // 1. Additive raymarched 3D Volumetric Clouds pooling at the bottom of the map
    if (uVolumetricClouds > 0.5 && uVolumetricStrength > 0.01) {
      float cloudTop = max(5.0, uModelHeight * clamp(uCloudAltitude, 0.10, 0.80));
      float tStart = 0.0;
      float tEnd = -1.0;

      if (abs(rayDir.y) > 0.0008) {
        float tPlane = (cloudTop - cameraPosition.y) / rayDir.y;
        if (cameraPosition.y > cloudTop) {
          if (rayDir.y < 0.0 && tPlane < rayLen) {
            tStart = max(0.0, tPlane);
            tEnd = min(rayLen, tStart + 1200.0);
          }
        } else {
          tStart = 0.0;
          tEnd = rayDir.y > 0.0 ? min(rayLen, max(0.0, tPlane)) : min(rayLen, 1200.0);
        }
      } else if (cameraPosition.y <= cloudTop) {
        tStart = 0.0;
        tEnd = min(rayLen, 1200.0);
      }

      if (tEnd > tStart + 0.25) {
        float span = tEnd - tStart;
        float stepLen = span / 10.0;
        float freq = 0.046 * clamp(120.0 / max(24.0, uModelRadius), 0.38, 2.2);
        float densityScale = (0.042 + 0.095 * uVolumetricStrength) * clamp(110.0 / max(36.0, uModelRadius), 0.32, 1.8);
        float phase = hgPhase(cosSun, 0.52);

        vec3 brightCloud = mix(uFogColor, vec3(1.0), 0.52) + uLightColor * (0.28 + phase * 0.35) * uLightIntensity * 0.45;
        vec3 shadowCloud = mix(uFogColor * 0.72, uSkyColor * 0.62, 0.42);

        float transmittance = 1.0;
        vec3 inscatter = vec3(0.0);

        for (int i = 0; i < 10; i++) {
          float t = tStart + (float(i) + 0.5) * stepLen;
          vec3 sp = cameraPosition + rayDir * t;

          float hNorm = clamp((sp.y + 0.5) / cloudTop, 0.0, 1.0);
          float heightEnv = smoothstep(1.0, 0.16, hNorm);

          vec3 np = vec3(sp.x * freq + uTime * 0.07, sp.y * freq * 1.9, sp.z * freq - uTime * 0.045);
          float n = cloudFbm(np);
          float puff = smoothstep(0.30, 0.74, n + (1.0 - hNorm) * 0.28);

          float localD = puff * heightEnv * densityScale;
          float stepExt = exp(-localD * stepLen);

          float sunTerm = clamp(hNorm * 0.72 + n * 0.42, 0.0, 1.0);
          vec3 stepCol = mix(shadowCloud, brightCloud, sunTerm);

          inscatter += transmittance * stepCol * (1.0 - stepExt);
          transmittance *= stepExt;
        }

        col = col * transmittance + inscatter;
      }
    }

    // 2. Active Distance Fog (In-Game AoS linear cutoff OR Atmospheric Exp2)
    if (uFogMode == 1) {
      float fogStart = camOffset + uFogRange * 0.24;
      float fogEnd = max(fogStart + 20.0, camOffset + uFogRange * 1.55);
      float linFog = smoothstep(fogStart, fogEnd, depthDist) * clamp(uFogStrength, 0.0, 1.35);
      float distRamp = smoothstep(camOffset + uModelRadius * 0.15, fogEnd, depthDist);
      float valleyFog = exp(-max(0.0, worldPos.y) * 0.065) * uHeightFog * 0.65 * distRamp;
      float f = clamp(max(max(linFog, valleyFog), extraHorizonFade), 0.0, 1.0);
      vec3 inGameTint = mix(uFogColor, uFogColor + uLightColor * 0.12, pow(max(cosSun, 0.0), 4.0) * 0.45);
      return mix(col, inGameTint, f);
    }

    // Mode 0: Smooth Atmospheric Exp2 + Valley Mist + subtle Mie haze
    float distFog = 1.0 - exp(-uFogDensity * uFogDensity * depthDist * depthDist);
    float distRamp = smoothstep(uModelRadius * 0.35, uModelRadius * 3.0, max(0.0, depthDist));
    float valleyFog = exp(-max(0.0, worldPos.y) * 0.065) * uHeightFog * distRamp;
    float fogFactor = clamp(max(max(distFog, valleyFog), extraHorizonFade), 0.0, 1.0);
    vec3 mieFog = mix(uFogColor, uFogColor + uLightColor * 0.10, pow(max(cosSun, 0.0), 5.0) * 0.35);
    return mix(col, mieFog, fogFactor);
  }
`;

/**
 * Procedural Sky Dome with Zenith-Horizon gradient, Solar Disc, and Mie Scattering Halo.
 */
export function createSkyDomeMaterial(shared: SharedShaderUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenithColor: shared.uZenithColor,
      uHorizonColor: shared.uHorizonColor,
      uFogColor: shared.uFogColor,
      uLightDir: shared.uLightDir,
      uLightColor: shared.uLightColor,
      uShowSky: shared.uShowSky,
      uVolumetricClouds: shared.uVolumetricClouds,
      uVolumetricStrength: shared.uVolumetricStrength,
    },
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: true,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uFogColor;
      uniform vec3 uLightDir;
      uniform vec3 uLightColor;
      uniform float uShowSky;
      uniform float uVolumetricClouds;
      uniform float uVolumetricStrength;
      varying vec3 vWorldDir;

      void main() {
        vec3 dir = normalize(vWorldDir);
        vec3 sunDir = normalize(uLightDir);

        float h = clamp(dir.y, -0.2, 1.0);
        float horizonBlend = pow(1.0 - max(h, 0.0), 2.4);
        vec3 baseHorizon = mix(uHorizonColor, uFogColor, 0.55);
        vec3 sky = mix(uZenithColor, baseHorizon, horizonBlend);

        if (dir.y < 0.0) {
          sky = mix(baseHorizon, baseHorizon * 0.72, clamp(-dir.y * 3.0, 0.0, 1.0));
        }

        if (uShowSky > 0.5) {
          float sunDot = max(dot(dir, sunDir), 0.0);
          float volBoost = uVolumetricClouds > 0.5 ? (1.0 + uVolumetricStrength * 0.35) : 1.0;
          float halo = pow(sunDot, 10.0) * 0.34 * volBoost;
          float coreHalo = pow(sunDot, 120.0) * 0.85;
          float disc = smoothstep(0.9988, 0.9996, sunDot) * 2.2;
          float aboveHorizon = smoothstep(-0.06, 0.08, dir.y);
          sky += uLightColor * (halo + coreHalo + disc) * aboveHorizon;
        }

        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export interface OceanUniforms {
  uTime: { value: number };
  uWaterColor: { value: THREE.Color };
  uWaveStrength: { value: number };
  uMapHalfSize: { value: THREE.Vector2 };
  uClipInside: { value: number };
  uLightDir: { value: THREE.Vector3 };
  uLightColor: { value: THREE.Color };
  uLightIntensity: { value: number };
  uSkyColor: { value: THREE.Color };
  uZenithColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uFogMode: { value: number };
  uFogColor: { value: THREE.Color };
  uModelRadius: { value: number };
  uModelHeight: { value: number };
  uFogDensity: { value: number };
  uFogStrength: { value: number };
  uFogRange: { value: number };
  uHeightFog: { value: number };
  uVolumetricClouds: { value: number };
  uVolumetricStrength: { value: number };
  uCloudAltitude: { value: number };
}

/**
 * Infinite procedural water ocean surrounding .vxl maps (clipped cleanly outside
 * the map's exact footprint so interior dry valleys/pits are never flooded).
 */
export function createOceanMaterial(
  shared: SharedShaderUniforms,
  clipInside = true,
): { material: THREE.ShaderMaterial; uniforms: OceanUniforms } {
  const uniforms: OceanUniforms = {
    uTime: shared.uTime,
    uWaterColor: { value: new THREE.Color('#3B6D96') },
    uWaveStrength: { value: 0.45 },
    uMapHalfSize: { value: new THREE.Vector2(256, 256) },
    uClipInside: { value: clipInside ? 1.0 : 0.0 },
    uLightDir: shared.uLightDir,
    uLightColor: shared.uLightColor,
    uLightIntensity: shared.uLightIntensity,
    uSkyColor: shared.uSkyColor,
    uZenithColor: shared.uZenithColor,
    uHorizonColor: shared.uHorizonColor,
    uFogMode: shared.uFogMode,
    uFogColor: shared.uFogColor,
    uModelRadius: shared.uModelRadius,
    uModelHeight: shared.uModelHeight,
    uFogDensity: shared.uFogDensity,
    uFogStrength: shared.uFogStrength,
    uFogRange: shared.uFogRange,
    uHeightFog: shared.uHeightFog,
    uVolumetricClouds: shared.uVolumetricClouds,
    uVolumetricStrength: shared.uVolumetricStrength,
    uCloudAltitude: shared.uCloudAltitude,
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    toneMapped: true,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying float vDepthDist;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDepthDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uWaterColor;
      uniform float uWaveStrength;
      uniform vec2 uMapHalfSize;
      uniform float uClipInside;
      uniform vec3 uLightDir;
      uniform vec3 uLightColor;
      uniform float uLightIntensity;
      uniform vec3 uSkyColor;
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform int uFogMode;
      uniform vec3 uFogColor;
      uniform float uModelRadius;
      uniform float uModelHeight;
      uniform float uFogDensity;
      uniform float uFogStrength;
      uniform float uFogRange;
      uniform float uHeightFog;
      uniform float uVolumetricClouds;
      uniform float uVolumetricStrength;
      uniform float uCloudAltitude;

      varying vec3 vWorldPos;
      varying float vDepthDist;

      float waveHeight(vec2 p, float t) {
        float w1 = sin(p.x * 0.22 + t * 0.9) * cos(p.y * 0.19 - t * 0.7);
        float w2 = sin((p.x + p.y) * 0.45 - t * 1.25) * 0.5;
        float w3 = cos((p.x * 0.85 - p.y * 0.72) + t * 1.6) * 0.25;
        return (w1 + w2 + w3) * 0.35;
      }

      ${FOG_AND_VOLUMETRIC_GLSL}

      void main() {
        vec2 distToEdge = abs(vWorldPos.xz) - uMapHalfSize;
        if (uClipInside > 0.5 && distToEdge.x < -0.5 && distToEdge.y < -0.5) {
          discard;
        }

        float edgeDist = max(distToEdge.x, distToEdge.y);

        vec2 p = vWorldPos.xz;
        float eps = 0.4;
        float hC = waveHeight(p, uTime);
        float hX = waveHeight(p + vec2(eps, 0.0), uTime);
        float hZ = waveHeight(p + vec2(0.0, eps), uTime);
        float hasMap = step(1.0, uMapHalfSize.x);
        float shoreBlend = mix(1.0, smoothstep(0.0, 56.0, edgeDist), hasMap);
        float waveAmp = uWaveStrength * mix(0.0, 0.36, shoreBlend);
        vec3 N = normalize(vec3((hC - hX) * waveAmp, 1.0, (hC - hZ) * waveAmp));

        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uLightDir);
        vec3 H = normalize(L + V);

        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.5);
        float ndl = max(dot(N, L), 0.0);
        float wrap = max(0.0, (dot(N, L) + 0.18) / 1.18);

        vec3 skyBounce = uSkyColor * 0.52 + vec3(0.16);
        vec3 sunlit = uLightColor * (ndl * 0.88 + wrap * 0.14) * uLightIntensity;
        vec3 waterLit = uWaterColor * (skyBounce + sunlit);
        waterLit += mix(uHorizonColor, uSkyColor, 0.5) * fresnel * 0.16;

        vec3 skyRefl = mix(uHorizonColor, uZenithColor, clamp(N.y * 0.55, 0.0, 1.0));
        float reflWeight = clamp(fresnel * 0.58 * shoreBlend, 0.0, 0.72);
        vec3 col = mix(waterLit, skyRefl, reflWeight);

        float spec = pow(max(dot(N, H), 0.0), mix(160.0, 44.0, uWaveStrength)) * (0.25 + uWaveStrength * 0.55) * shoreBlend;
        col += uLightColor * spec * uLightIntensity * 0.5;

        float horizonFade = smoothstep(700.0, 3400.0, vDepthDist) * 0.94;
        col = computeSceneFog(col, vWorldPos, vDepthDist, horizonFade);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  return { material, uniforms };
}

/**
 * Creates the Studio PBR material extended via onBeforeCompile to support
 * Voxel AO, section slicing, optional silhouette outlines, and unified fog.
 */
export function createPbrVoxelMaterial(
  shared: SharedShaderUniforms,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: shared.uRoughness.value,
    metalness: shared.uMetalness.value,
    clearcoat: 0.08,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.85,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uAoStrength = shared.uAoStrength;
    shader.uniforms.uOutlineStrength = shared.uOutlineStrength;
    shader.uniforms.uModelRadius = shared.uModelRadius;
    shader.uniforms.uModelHeight = shared.uModelHeight;
    shader.uniforms.uSliceAxis = shared.uSliceAxis;
    shader.uniforms.uSliceCoord = shared.uSliceCoord;
    shader.uniforms.uLightDir = shared.uLightDir;
    shader.uniforms.uLightColor = shared.uLightColor;
    shader.uniforms.uLightIntensity = shared.uLightIntensity;
    shader.uniforms.uSkyColor = shared.uSkyColor;
    shader.uniforms.uFogMode = shared.uFogMode;
    shader.uniforms.uFogColor = shared.uFogColor;
    shader.uniforms.uFogDensity = shared.uFogDensity;
    shader.uniforms.uFogStrength = shared.uFogStrength;
    shader.uniforms.uFogRange = shared.uFogRange;
    shader.uniforms.uHeightFog = shared.uHeightFog;
    shader.uniforms.uVolumetricClouds = shared.uVolumetricClouds;
    shader.uniforms.uVolumetricStrength = shared.uVolumetricStrength;
    shader.uniforms.uCloudAltitude = shared.uCloudAltitude;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aAo;
        uniform float uModelRadius;
        varying float vAo;
        varying vec3 vVoxelLocalPos;
        varying vec3 vVoxelWorldPos;
        varying float vVoxelDepth;
        varying vec3 vCustomViewNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vAo = aAo;
        vCustomViewNormal = normalize(normalMatrix * normal);
        vVoxelLocalPos = transformed;
        vec4 customWp = modelMatrix * vec4(transformed, 1.0);
        vVoxelWorldPos = customWp.xyz;
        vVoxelDepth = -(viewMatrix * customWp).z;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uAoStrength;
        uniform float uOutlineStrength;
        uniform int uSliceAxis;
        uniform float uSliceCoord;
        uniform vec3 uLightDir;
        uniform vec3 uLightColor;
        uniform float uLightIntensity;
        uniform vec3 uSkyColor;
        uniform int uFogMode;
        uniform vec3 uFogColor;
        uniform float uModelRadius;
        uniform float uModelHeight;
        uniform float uFogDensity;
        uniform float uFogStrength;
        uniform float uFogRange;
        uniform float uHeightFog;
        uniform float uVolumetricClouds;
        uniform float uVolumetricStrength;
        uniform float uCloudAltitude;
        varying float vAo;
        varying vec3 vVoxelLocalPos;
        varying vec3 vVoxelWorldPos;
        varying float vVoxelDepth;
        varying vec3 vCustomViewNormal;
        ${FOG_AND_VOLUMETRIC_GLSL}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uSliceAxis == 1 && vVoxelLocalPos.x > uSliceCoord) discard;
        if (uSliceAxis == 2 && vVoxelLocalPos.y > uSliceCoord) discard;
        if (uSliceAxis == 3 && vVoxelLocalPos.z > uSliceCoord) discard;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float aoFactor = mix(1.0, clamp(vAo, 0.0, 1.0), uAoStrength);
        diffuseColor.rgb *= aoFactor;
        if (uOutlineStrength > 0.001) {
          vec3 vDir = normalize(vViewPosition);
          float rim = 1.0 - abs(dot(normalize(vCustomViewNormal), vDir));
          float ink = smoothstep(0.66, 0.88, rim);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.025, 0.035), ink * uOutlineStrength * 0.85);
        }`,
      )
      .replace(
        '#include <fog_fragment>',
        `gl_FragColor.rgb = computeSceneFog(gl_FragColor.rgb, vVoxelWorldPos, max(0.0, vVoxelDepth), 0.0);`,
      );
  };

  mat.customProgramCacheKey = () => 'voxatelier-pbr-v5';
  return mat;
}

const SHARED_VERTEX_SHADER = /* glsl */ `
  attribute float aAo;

  varying vec3 vColor;
  varying float vAo;
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  varying float vDepthDist;

  void main() {
    vColor = color;
    vAo = aAo;
    vLocalPos = position;

    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewNormal = normalize(normalMatrix * normal);

    vec4 mvPosition = viewMatrix * worldPosition;
    vViewPos = -mvPosition.xyz;
    vDepthDist = -mvPosition.z;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_PREAMBLE = /* glsl */ `
  uniform float uTime;
  uniform float uAoStrength;
  uniform float uOutlineStrength;
  uniform float uRoughness;
  uniform float uMetalness;
  uniform int uSliceAxis;
  uniform float uSliceCoord;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uLightIntensity;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform int uFogMode;
  uniform vec3 uFogColor;
  uniform float uModelRadius;
  uniform float uModelHeight;
  uniform float uFogDensity;
  uniform float uFogStrength;
  uniform float uFogRange;
  uniform float uHeightFog;
  uniform float uVolumetricClouds;
  uniform float uVolumetricStrength;
  uniform float uCloudAltitude;

  varying vec3 vColor;
  varying float vAo;
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  varying float vDepthDist;

  void applySliceClip() {
    if (uSliceAxis == 1 && vLocalPos.x > uSliceCoord) discard;
    if (uSliceAxis == 2 && vLocalPos.y > uSliceCoord) discard;
    if (uSliceAxis == 3 && vLocalPos.z > uSliceCoord) discard;
  }

  ${FOG_AND_VOLUMETRIC_GLSL}

  vec3 applyFog(vec3 col) {
    return computeSceneFog(col, vWorldPos, max(0.0, vDepthDist), 0.0);
  }
`;

function makeStylizedShader(
  mode: Exclude<ShaderMode, 'pbr'>,
  uniforms: SharedShaderUniforms,
): THREE.ShaderMaterial {
  let body = '';

  if (mode === 'atmospheric') {
    body = /* glsl */ `
      void main() {
        applySliceClip();
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uLightDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 VN = normalize(vViewNormal);
        vec3 VV = normalize(vViewPos);

        float ao = mix(1.0, vAo, clamp(uAoStrength * 1.1, 0.0, 1.5));

        float ndl = max(0.0, dot(N, L));
        float wrap = max(0.0, (dot(N, L) + 0.18) / 1.18);
        float hemi = dot(N, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
        vec3 skyBounce = mix(uGroundColor * 0.42 + vec3(0.08), uSkyColor * 0.52 + vec3(0.16), hemi);

        vec3 shadowed = vColor * skyBounce * mix(0.65, 1.0, ao);
        vec3 sunlit = vColor * uLightColor * (ndl * 0.88 + wrap * 0.14) * uLightIntensity;
        vec3 col = shadowed + sunlit * ao;

        vec3 H = normalize(L + V);
        float spec = pow(max(0.0, dot(N, H)), mix(64.0, 10.0, uRoughness)) * (1.0 - uRoughness) * 0.28;
        float fresnel = pow(1.0 - max(0.0, dot(VN, VV)), 3.5) * 0.16;
        col += uLightColor * spec + mix(uHorizonColor, uSkyColor, 0.5) * fresnel * ao;

        if (uOutlineStrength > 0.001) {
          float rim = 1.0 - abs(dot(VN, VV));
          col = mix(col, vec3(0.04, 0.05, 0.07), smoothstep(0.66, 0.88, rim) * uOutlineStrength * 0.82);
        }

        gl_FragColor = vec4(applyFog(col), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;
  } else if (mode === 'diorama') {
    body = /* glsl */ `
      void main() {
        applySliceClip();
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uLightDir);
        vec3 VN = normalize(vViewNormal);
        vec3 VV = normalize(vViewPos);

        float ao = pow(mix(1.0, vAo, clamp(uAoStrength * 1.15, 0.0, 1.5)), 1.15);

        float lum = dot(vColor, vec3(0.299, 0.587, 0.114));
        vec3 vibrant = mix(vec3(lum), vColor, 1.18);

        float ndl = max(0.0, dot(N, L));
        float fill = max(0.0, dot(N, normalize(vec3(-L.x, 0.65, -L.z))));
        vec3 key = uLightColor * ndl * uLightIntensity * 0.95;
        vec3 coolFill = mix(vec3(0.32, 0.40, 0.54), uSkyColor * 0.55, 0.6) * (0.45 + 0.55 * fill);

        vec3 col = vibrant * (key + coolFill) * ao;

        if (uOutlineStrength > 0.001) {
          float rim = 1.0 - abs(dot(VN, VV));
          col = mix(col, vec3(0.03), smoothstep(0.66, 0.88, rim) * uOutlineStrength * 0.8);
        }

        gl_FragColor = vec4(applyFog(col), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;
  } else if (mode === 'cinema') {
    body = /* glsl */ `
      void main() {
        applySliceClip();
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uLightDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 VN = normalize(vViewNormal);
        vec3 VV = normalize(vViewPos);

        float ao = mix(1.0, vAo, clamp(uAoStrength * 1.2, 0.0, 1.5));

        float ndl = max(0.0, dot(N, L));
        vec3 warmSun = mix(uLightColor, vec3(1.0, 0.74, 0.44), 0.42) * ndl * uLightIntensity * 1.12;
        vec3 tealShadow = vec3(0.09, 0.17, 0.23) * (1.0 - ndl * 0.4);

        vec3 col = vColor * (warmSun + tealShadow) * ao;

        vec3 H = normalize(L + V);
        float spec = pow(max(0.0, dot(N, H)), mix(48.0, 10.0, uRoughness)) * (1.0 - uRoughness) * 0.35;
        float rim = pow(1.0 - max(0.0, dot(VN, VV)), 3.0);
        col += warmSun * spec * 0.6 + mix(vec3(0.22, 0.55, 0.68), uLightColor, ndl) * rim * 0.25;

        if (uOutlineStrength > 0.001) {
          float sil = 1.0 - abs(dot(VN, VV));
          col = mix(col, vec3(0.02, 0.03, 0.04), smoothstep(0.66, 0.88, sil) * uOutlineStrength * 0.8);
        }

        gl_FragColor = vec4(applyFog(col), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;
  } else if (mode === 'voxlap') {
    body = /* glsl */ `
      void main() {
        applySliceClip();
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uLightDir);
        float ao = mix(1.0, vAo, uAoStrength * 0.9);

        float faceShade = 1.0;
        if (N.y > 0.5) faceShade = 1.0;
        else if (N.y < -0.5) faceShade = 0.48;
        else if (abs(N.x) > 0.5) faceShade = 0.76;
        else faceShade = 0.86;

        float sun = max(0.0, dot(N, L));
        float combined = mix(faceShade, 0.52 + sun * 0.68, 0.38) * uLightIntensity * 0.82;
        vec3 col = vColor * mix(vec3(1.0), uLightColor, 0.55) * combined * ao;

        if (uOutlineStrength > 0.001) {
          vec3 VN = normalize(vViewNormal);
          vec3 V = normalize(vViewPos);
          float rim = 1.0 - abs(dot(VN, V));
          col = mix(col, vec3(0.02, 0.02, 0.03), smoothstep(0.66, 0.88, rim) * uOutlineStrength * 0.8);
        }

        gl_FragColor = vec4(applyFog(col), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;
  } else {
    // rim
    body = /* glsl */ `
      void main() {
        applySliceClip();
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uLightDir);
        vec3 VN = normalize(vViewNormal);
        vec3 V = normalize(vViewPos);

        float ao = mix(1.0, vAo, uAoStrength * 1.15);

        float ndl = max(0.0, dot(N, L));
        vec3 warmKey = uLightColor * ndl * uLightIntensity;
        vec3 coolShadow = mix(vec3(0.10, 0.16, 0.28), uSkyColor * 0.22, 0.4) * (1.0 - ndl * 0.5);

        float fresnel = pow(1.0 - max(0.0, dot(VN, V)), 2.6);
        vec3 rimColor = mix(vec3(0.28, 0.68, 1.0), uLightColor, step(0.0, dot(N, L)));

        vec3 col = vColor * (warmKey + coolShadow) * ao + rimColor * fresnel * 0.85;

        gl_FragColor = vec4(applyFog(col), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;
  }

  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: SHARED_VERTEX_SHADER,
    fragmentShader: FRAGMENT_PREAMBLE + body,
    vertexColors: true,
    toneMapped: true,
  });
}

export interface MaterialBank {
  pbr: THREE.MeshPhysicalMaterial;
  atmospheric: THREE.ShaderMaterial;
  diorama: THREE.ShaderMaterial;
  cinema: THREE.ShaderMaterial;
  voxlap: THREE.ShaderMaterial;
  rim: THREE.ShaderMaterial;
  dispose: () => void;
}

export function createMaterialBank(shared: SharedShaderUniforms): MaterialBank {
  const pbr = createPbrVoxelMaterial(shared);
  const atmospheric = makeStylizedShader('atmospheric', shared);
  const diorama = makeStylizedShader('diorama', shared);
  const cinema = makeStylizedShader('cinema', shared);
  const voxlap = makeStylizedShader('voxlap', shared);
  const rim = makeStylizedShader('rim', shared);

  return {
    pbr,
    atmospheric,
    diorama,
    cinema,
    voxlap,
    rim,
    dispose: () => {
      pbr.dispose();
      atmospheric.dispose();
      diorama.dispose();
      cinema.dispose();
      voxlap.dispose();
      rim.dispose();
    },
  };
}
