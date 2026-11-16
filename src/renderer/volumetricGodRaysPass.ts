import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { GodRaysCompositeShader, GodRaysShader } from './shaders';

export interface VolumetricGodRaysSceneParams {
  lightDir: THREE.Vector3;
  sunColor: THREE.Color;
  intensity: number;
  modelBounds: THREE.Box3;
  modelRadius: number;
}

/**
 * Two-stage 3D Volumetric Shadow-Map God Rays pass:
 *  1. Raymarches 3D camera rays against `keyLight.shadow.map.depthTexture`
 *     (`sampler2DShadow`) with Interleaved Gradient Noise jitter into `raysTarget`
 *     (0.5× linear resolution live for 60fps, 1.0× full native resolution on PNG export).
 *  2. Upsamples and composites `raysTarget` onto `readBuffer` using a 5×5 depth-aware
 *     bilateral filter so light shafts are completely smooth (zero stepped rectangles
 *     or grain) while foreground voxel silhouettes stay razor-sharp.
 */
export class VolumetricGodRaysPass extends Pass {
  private readonly getCamera: () => THREE.Camera;
  private readonly keyLight: THREE.DirectionalLight;

  private readonly fallbackShadowTex: THREE.DepthTexture;
  private readonly fallbackDepthTex: THREE.DataTexture;
  private readonly raysTarget: THREE.WebGLRenderTarget;

  private readonly raymarchMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly raymarchQuad: FullScreenQuad;
  private readonly compositeQuad: FullScreenQuad;

  private fullWidth: number;
  private fullHeight: number;
  private highQuality = false;

  constructor(
    width: number,
    height: number,
    getCamera: () => THREE.Camera,
    keyLight: THREE.DirectionalLight,
  ) {
    super();
    this.getCamera = getCamera;
    this.keyLight = keyLight;
    this.fullWidth = Math.max(1, Math.round(width));
    this.fullHeight = Math.max(1, Math.round(height));

    // Guaranteed valid shadow-comparison texture before the first shadow pass runs
    this.fallbackShadowTex = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.fallbackShadowTex.format = THREE.DepthFormat;
    this.fallbackShadowTex.compareFunction = THREE.LessEqualCompare;
    this.fallbackShadowTex.minFilter = THREE.LinearFilter;
    this.fallbackShadowTex.magFilter = THREE.LinearFilter;

    this.fallbackDepthTex = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    this.fallbackDepthTex.needsUpdate = true;

    const rayW = Math.max(1, Math.round(this.fullWidth * 0.5));
    const rayH = Math.max(1, Math.round(this.fullHeight * 0.5));
    this.raysTarget = new THREE.WebGLRenderTarget(rayW, rayH, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    this.raysTarget.texture.generateMipmaps = false;

    this.raymarchMaterial = new THREE.ShaderMaterial({
      name: 'VolumetricGodRaysRaymarch',
      uniforms: THREE.UniformsUtils.clone(GodRaysShader.uniforms),
      vertexShader: GodRaysShader.vertexShader,
      fragmentShader: GodRaysShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.raymarchMaterial.uniforms.uShadowMap.value = this.fallbackShadowTex;
    this.raymarchMaterial.uniforms.tDepth.value = this.fallbackDepthTex;

    this.compositeMaterial = new THREE.ShaderMaterial({
      name: 'VolumetricGodRaysComposite',
      uniforms: THREE.UniformsUtils.clone(GodRaysCompositeShader.uniforms),
      vertexShader: GodRaysCompositeShader.vertexShader,
      fragmentShader: GodRaysCompositeShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial.uniforms.tRays.value = this.raysTarget.texture;
    this.compositeMaterial.uniforms.uRaysTexelSize.value.set(1 / rayW, 1 / rayH);

    this.raymarchQuad = new FullScreenQuad(this.raymarchMaterial);
    this.compositeQuad = new FullScreenQuad(this.compositeMaterial);
  }

  private updateRaysTargetSize(): void {
    const scale = this.highQuality ? 1.0 : 0.5;
    const rayW = Math.max(1, Math.round(this.fullWidth * scale));
    const rayH = Math.max(1, Math.round(this.fullHeight * scale));
    if (this.raysTarget.width !== rayW || this.raysTarget.height !== rayH) {
      this.raysTarget.setSize(rayW, rayH);
    }
    this.compositeMaterial.uniforms.uRaysTexelSize.value.set(1 / rayW, 1 / rayH);
  }

  override setSize(width: number, height: number): void {
    this.fullWidth = Math.max(1, Math.round(width));
    this.fullHeight = Math.max(1, Math.round(height));
    this.updateRaysTargetSize();
  }

  setQualityMode(highQuality: boolean): void {
    this.highQuality = highQuality;
    this.raymarchMaterial.uniforms.uSamples.value = highQuality ? 128 : 48;
    this.updateRaysTargetSize();
  }

  syncSceneParams(params: VolumetricGodRaysSceneParams): void {
    const u = this.raymarchMaterial.uniforms;
    u.uLightDir.value.copy(params.lightDir).normalize();
    u.uSunColor.value.copy(params.sunColor);
    u.uIntensity.value = params.intensity;

    const bounds = params.modelBounds;
    const heightSpan = Math.max(8, bounds.max.y - bounds.min.y);
    const padXZ = Math.max(20, params.modelRadius * 0.28);
    const padTop = Math.max(14, heightSpan * 0.72);

    u.uVolumeMin.value.set(bounds.min.x - padXZ, bounds.min.y - 2, bounds.min.z - padXZ);
    u.uVolumeMax.value.set(bounds.max.x + padXZ, bounds.max.y + padTop, bounds.max.z + padXZ);
    u.uGroundY.value = bounds.min.y;
    u.uHeightFalloff.value = 1.0 / Math.max(12.0, heightSpan * 0.9);
    u.uMaxDistance.value = Math.max(96.0, params.modelRadius * 1.45);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const cam = this.getCamera();
    cam.updateMatrixWorld();

    const ru = this.raymarchMaterial.uniforms;
    const cu = this.compositeMaterial.uniforms;

    const depthTex = readBuffer.depthTexture ?? this.fallbackDepthTex;
    ru.tDepth.value = depthTex;
    ru.uInvProjectionMatrix.value.copy(cam.projectionMatrixInverse);
    ru.uCameraMatrixWorld.value.copy(cam.matrixWorld);

    const shadow = this.keyLight.shadow;
    const shadowDepthTex = shadow.map?.depthTexture ?? null;
    if (shadowDepthTex) {
      ru.uShadowMap.value = shadowDepthTex;
      ru.uShadowMatrix.value.copy(shadow.matrix);
      ru.uShadowReady.value = 1.0;

      const shadowCam = shadow.camera;
      const orthoW = Math.max(16, Math.abs(shadowCam.right - shadowCam.left));
      const orthoH = Math.max(16, Math.abs(shadowCam.top - shadowCam.bottom));
      const depthSpan = Math.max(32, shadowCam.far - shadowCam.near);
      // ~8.5 voxels on a 512x512 map (scaled proportionally for smaller .kv6 models),
      // converted separately along ortho X & Y so the aperture check stays circular
      // in world space even at low sun elevations (e.g. 12 deg).
      const worldShaftRadius = Math.max(1.5, Math.min(9.0, orthoW * 0.012));
      ru.uShaftRadiusUv.value.set(worldShaftRadius / orthoW, worldShaftRadius / orthoH);
      ru.uShadowDepthBias.value = 0.28 / depthSpan;
    } else {
      ru.uShadowMap.value = this.fallbackShadowTex;
      ru.uShadowReady.value = 0.0;
    }

    // Pass 1: Raymarch 3D volumetric scattered radiance into raysTarget
    renderer.setRenderTarget(this.raysTarget);
    renderer.clear(true, false, false);
    this.raymarchQuad.render(renderer);

    // Pass 2: Depth-aware 5x5 bilateral upsample & composite onto scene color
    cu.tDiffuse.value = readBuffer.texture;
    cu.tDepth.value = depthTex;
    cu.tRays.value = this.raysTarget.texture;
    cu.uInvProjectionMatrix.value.copy(cam.projectionMatrixInverse);
    cu.uCameraMatrixWorld.value.copy(cam.matrixWorld);

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.compositeQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) {
        renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      }
      this.compositeQuad.render(renderer);
    }
  }

  override dispose(): void {
    this.raysTarget.dispose();
    this.fallbackShadowTex.dispose();
    this.fallbackDepthTex.dispose();
    this.raymarchMaterial.dispose();
    this.compositeMaterial.dispose();
    this.raymarchQuad.dispose();
    this.compositeQuad.dispose();
  }
}
