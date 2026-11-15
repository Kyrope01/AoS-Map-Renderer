import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BuiltVoxelMesh } from '../voxel/mesher';
import { CameraPreset, RenderSettings } from '../voxel/types';
import {
  BACKDROP_THEMES,
  createMaterialBank,
  createOceanMaterial,
  createSharedUniforms,
  createSkyDomeMaterial,
  MaterialBank,
  SharedShaderUniforms,
  syncSharedUniforms,
} from './shaders';

export interface VoxelViewportHandle {
  applyCameraPreset: (preset: CameraPreset) => void;
  exportPng: (filename: string) => void;
}

interface VoxelViewportProps {
  builtMesh: BuiltVoxelMesh | null;
  settings: RenderSettings;
  onFileDrop: (file: File) => void;
  onAdjustFlySpeed?: (nextSpeed: number) => void;
}

const StudioPostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1440, 900) },
    uVignette: { value: 0.14 },
    uChromatic: { value: 0.0 },
    uPixelate: { value: 0.0 },
    uTiltShift: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uVignette;
    uniform float uChromatic;
    uniform float uPixelate;
    uniform float uTiltShift;
    varying vec2 vUv;

    vec3 sampleScene(vec2 uv) {
      if (uChromatic > 0.001) {
        vec2 dir = uv - 0.5;
        float dist = length(dir);
        float shift = uChromatic * 0.0075 * dist;
        return vec3(
          texture2D(tDiffuse, uv - dir * shift).r,
          texture2D(tDiffuse, uv).g,
          texture2D(tDiffuse, uv + dir * shift).b
        );
      }
      return texture2D(tDiffuse, uv).rgb;
    }

    void main() {
      vec2 uv = vUv;
      if (uPixelate > 1.5) {
        vec2 stepSize = vec2(uPixelate) / max(uResolution, vec2(1.0));
        uv = floor(uv / stepSize) * stepSize + stepSize * 0.5;
      }

      vec3 col = sampleScene(uv);

      if (uTiltShift > 0.01) {
        float focusBand = smoothstep(0.12, 0.48, abs(vUv.y - 0.5));
        float blurPx = focusBand * uTiltShift * 4.5;
        if (blurPx > 0.2) {
          vec2 texel = blurPx / max(uResolution, vec2(1.0));
          vec3 acc = col * 0.24;
          acc += sampleScene(uv + vec2(texel.x, 0.0)) * 0.12;
          acc += sampleScene(uv - vec2(texel.x, 0.0)) * 0.12;
          acc += sampleScene(uv + vec2(0.0, texel.y)) * 0.12;
          acc += sampleScene(uv - vec2(0.0, texel.y)) * 0.12;
          acc += sampleScene(uv + vec2(texel.x, texel.y) * 0.7) * 0.07;
          acc += sampleScene(uv + vec2(-texel.x, texel.y) * 0.7) * 0.07;
          acc += sampleScene(uv + vec2(texel.x, -texel.y) * 0.7) * 0.07;
          acc += sampleScene(uv + vec2(-texel.x, -texel.y) * 0.7) * 0.07;
          col = acc;
        }
      }

      if (uVignette > 0.001) {
        float d = distance(vUv, vec2(0.5));
        float vig = smoothstep(0.85, 0.28, d);
        col *= mix(1.0, mix(0.45, 1.0, vig), uVignette);
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.5,
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.22)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const _lightDir = new THREE.Vector3();
const _lightColor = new THREE.Color();
const _fogColor = new THREE.Color();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _offsetVec = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

export const VoxelViewport = forwardRef<VoxelViewportHandle, VoxelViewportProps>(
  function VoxelViewport({ builtMesh, settings, onFileDrop, onAdjustFlySpeed }, ref) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const builtMeshRef = useRef(builtMesh);
    builtMeshRef.current = builtMesh;
    const flySpeedCbRef = useRef(onAdjustFlySpeed);
    flySpeedCbRef.current = onAdjustFlySpeed;

    const [contextLost, setContextLost] = useState(false);
    const [isDraggingFile, setIsDraggingFile] = useState(false);

    const engineRef = useRef<{
      applyPreset: (preset: CameraPreset, instant?: boolean) => void;
      syncMesh: (meshData: BuiltVoxelMesh | null, instantCamera?: boolean) => void;
      syncSettings: () => void;
      exportPng: (filename: string) => void;
    } | null>(null);

    useImperativeHandle(ref, () => ({
      applyCameraPreset: (preset: CameraPreset) => {
        engineRef.current?.applyPreset(preset, false);
      },
      exportPng: (filename: string) => {
        engineRef.current?.exportPng(filename);
      },
    }));

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const isSoftwareGl = (() => {
        try {
          const probe = document.createElement('canvas').getContext('webgl2');
          if (!probe) return true;
          const ext = probe.getExtension('WEBGL_debug_renderer_info');
          const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
          const gpu = String(probe.getParameter(param));
          probe.getExtension('WEBGL_lose_context')?.loseContext();
          return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
        } catch {
          return true;
        }
      })();

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

      const renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = settingsRef.current.exposure;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      container.appendChild(renderer.domElement);

      const handleContextLost = (e: Event) => {
        e.preventDefault();
        setContextLost(true);
      };
      const handleContextRestored = () => {
        setContextLost(false);
        renderer.shadowMap.needsUpdate = true;
      };
      renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

      const scene = new THREE.Scene();
      const initialTheme = BACKDROP_THEMES[settingsRef.current.backdrop];
      scene.background = new THREE.Color(initialTheme.bgHex);
      scene.fog = null;

      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;
      pmrem.dispose();

      // Cameras (far plane 12000 for procedural sky dome and infinite ocean horizon)
      const perspCamera = new THREE.PerspectiveCamera(
        settingsRef.current.cameraFov,
        width / height,
        0.5,
        12000,
      );
      const orthoHalf = 36;
      const aspect = width / height;
      const orthoCamera = new THREE.OrthographicCamera(
        -orthoHalf * aspect,
        orthoHalf * aspect,
        orthoHalf,
        -orthoHalf,
        0.5,
        12000,
      );
      let activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
        settingsRef.current.orthographic ? orthoCamera : perspCamera;

      const controls = new OrbitControls(activeCamera, renderer.domElement);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.06;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 4;
      controls.maxDistance = 1200;

      // Free Cam state
      let lastCameraMode = settingsRef.current.cameraMode;
      let freeYaw = 0;
      let freePitch = 0;
      let isFreeDragging = false;
      let lastPointerX = 0;
      let lastPointerY = 0;
      const keysDown = new Set<string>();

      const syncFreeAnglesFromCamera = () => {
        _euler.setFromQuaternion(activeCamera.quaternion, 'YXZ');
        freeYaw = _euler.y;
        freePitch = THREE.MathUtils.clamp(_euler.x, -Math.PI * 0.49, Math.PI * 0.49);
      };

      // 3-Point Studio / Map Lighting Rig
      const hemiLight = new THREE.HemisphereLight(
        initialTheme.skyHex,
        initialTheme.groundHex,
        0.65,
      );
      scene.add(hemiLight);

      const keyLight = new THREE.DirectionalLight(settingsRef.current.sunColor, 1.3);
      keyLight.castShadow = !isSoftwareGl;
      keyLight.shadow.mapSize.width = 2048;
      keyLight.shadow.mapSize.height = 2048;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
      scene.add(keyLight);
      scene.add(keyLight.target);

      const rimLight = new THREE.DirectionalLight('#C8DFFF', 0.4);
      rimLight.position.set(-40, 28, -45);
      scene.add(rimLight);

      if (!isSoftwareGl) {
        RectAreaLightUniformsLib.init();
        const softboxA = new THREE.RectAreaLight('#FFFFFF', 1.8, 24, 14);
        softboxA.position.set(28, 32, 24);
        softboxA.lookAt(0, 10, 0);
        scene.add(softboxA);

        const softboxB = new THREE.RectAreaLight('#C4DCFF', 1.1, 24, 14);
        softboxB.position.set(-30, 22, -20);
        softboxB.lookAt(0, 10, 0);
        scene.add(softboxB);
      }

      // Shared Shader Uniforms + Material Bank
      const sharedUniforms: SharedShaderUniforms = createSharedUniforms();
      sharedUniforms.uTime.value = 1.4;
      const materials: MaterialBank = createMaterialBank(sharedUniforms);

      // Procedural Atmospheric Sky Dome
      const skyGeo = new THREE.SphereGeometry(5200, 32, 20);
      const skyMat = createSkyDomeMaterial(sharedUniforms);
      const skyMesh = new THREE.Mesh(skyGeo, skyMat);
      skyMesh.frustumCulled = false;
      skyMesh.renderOrder = -10;
      scene.add(skyMesh);

      // Infinite Procedural Water Ocean (for .vxl maps with water)
      const oceanGeo = new THREE.PlaneGeometry(8800, 8800, 1, 1);
      oceanGeo.rotateX(-Math.PI / 2);
      const { material: oceanMat, uniforms: oceanUniforms } = createOceanMaterial(sharedUniforms);
      const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
      oceanMesh.position.y = 0.96;
      oceanMesh.visible = false;
      scene.add(oceanMesh);

      // Sub-surface catch plane with identical lit+fogged water shading
      const underlayGeo = new THREE.PlaneGeometry(1, 1);
      underlayGeo.rotateX(-Math.PI / 2);
      const { material: underlayMat, uniforms: underlayUniforms } = createOceanMaterial(
        sharedUniforms,
        false,
      );
      underlayUniforms.uWaveStrength.value = 0.0;
      const underlayMesh = new THREE.Mesh(underlayGeo, underlayMat);
      underlayMesh.position.y = 0.94;
      underlayMesh.visible = false;
      scene.add(underlayMesh);

      // Studio Stage: Contact shadow & circular pedestal (strictly for .kv6 models; no floor grid)
      const stageGroup = new THREE.Group();
      scene.add(stageGroup);

      const shadowTex = createContactShadowTexture();
      const contactShadowGeo = new THREE.PlaneGeometry(1, 1);
      contactShadowGeo.rotateX(-Math.PI / 2);
      const contactShadowMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
      contactShadow.position.y = 0.015;
      stageGroup.add(contactShadow);

      const pedestalGroup = new THREE.Group();
      const platterGeo = new THREE.CylinderGeometry(1, 1.03, 0.6, 64);
      const platterMat = new THREE.MeshStandardMaterial({
        color: '#232730',
        roughness: 0.72,
        metalness: 0.12,
      });
      const platterMesh = new THREE.Mesh(platterGeo, platterMat);
      platterMesh.position.y = -0.31;
      platterMesh.receiveShadow = true;

      const trimGeo = new THREE.TorusGeometry(1.015, 0.014, 12, 64);
      trimGeo.rotateX(Math.PI / 2);
      const trimMat = new THREE.MeshStandardMaterial({
        color: '#5B6270',
        roughness: 0.3,
        metalness: 0.75,
      });
      const trimMesh = new THREE.Mesh(trimGeo, trimMat);
      trimMesh.position.y = -0.02;

      const baseGeo = new THREE.CylinderGeometry(1.08, 1.12, 0.45, 64);
      const baseMat = new THREE.MeshStandardMaterial({
        color: '#191C22',
        roughness: 0.85,
        metalness: 0.08,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -0.84;
      baseMesh.receiveShadow = true;

      pedestalGroup.add(platterMesh, trimMesh, baseMesh);
      stageGroup.add(pedestalGroup);

      // Voxel Model Mesh
      const voxelMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(
        new THREE.BufferGeometry(),
        materials.atmospheric,
      );
      voxelMesh.castShadow = !isSoftwareGl;
      voxelMesh.receiveShadow = !isSoftwareGl;
      voxelMesh.visible = false;
      scene.add(voxelMesh);

      // Post-Processing Composer (GPU only; crisp high-threshold bloom)
      let composer: EffectComposer | null = null;
      let renderPass: RenderPass | null = null;
      let bloomPass: UnrealBloomPass | null = null;
      let studioPass: ShaderPass | null = null;

      if (!isSoftwareGl) {
        composer = new EffectComposer(renderer);
        renderPass = new RenderPass(scene, activeCamera);
        composer.addPass(renderPass);

        bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          settingsRef.current.bloomStrength,
          0.32,
          0.94,
        );
        composer.addPass(bloomPass);

        studioPass = new ShaderPass(StudioPostShader);
        studioPass.uniforms.uResolution.value.set(width, height);
        composer.addPass(studioPass);

        composer.addPass(new OutputPass());
      }

      // Smooth camera transition targets
      let modelRadius = 120;
      let modelCenterY = 24;
      const modelBounds = new THREE.Box3(
        new THREE.Vector3(-128, 0, -128),
        new THREE.Vector3(128, 48, 128),
      );
      const camTargetPos = new THREE.Vector3();
      const camTargetLook = new THREE.Vector3();
      let camAnimating = false;

      const cancelCamAnim = () => {
        camAnimating = false;
      };
      controls.addEventListener('start', cancelCamAnim);

      const computeCameraForPreset = (preset: CameraPreset) => {
        const isMap = builtMeshRef.current?.format === 'vxl' || !builtMeshRef.current;
        const dist = Math.max(18, modelRadius * (isMap ? 1.85 : 2.35));
        const lookY = modelCenterY * 0.72;
        camTargetLook.set(0, lookY, 0);

        if (preset === 'front') {
          camTargetPos.set(0, lookY + dist * 0.16, dist);
        } else if (preset === 'side') {
          camTargetPos.set(dist, lookY + dist * 0.16, 0);
        } else if (preset === 'top') {
          camTargetPos.set(0.01, lookY + dist * 1.15, 0.01);
        } else if (preset === 'low') {
          camTargetPos.set(dist * 0.72, Math.max(4, modelCenterY * 0.45), dist * 0.72);
        } else {
          camTargetPos.set(dist * 0.74, lookY + dist * 0.44, dist * 0.78);
        }
      };

      const applyPreset = (preset: CameraPreset, instant = false) => {
        computeCameraForPreset(preset);
        if (instant || settingsRef.current.cameraMode === 'free') {
          activeCamera.position.copy(camTargetPos);
          activeCamera.lookAt(camTargetLook);
          controls.target.copy(camTargetLook);
          controls.update();
          syncFreeAnglesFromCamera();
          camAnimating = false;
          requestRender();
        } else {
          camAnimating = true;
          startOrPokeLoop();
        }
      };

      let frameId = 0;
      let isLoopRunning = false;
      let renderBusy = false;
      let renderDirty = false;
      let lastTime = performance.now();
      let elapsedSec = 1.4;

      const drawFrame = () => {
        skyMesh.position.copy(activeCamera.position);
        if (composer && !isSoftwareGl) {
          composer.render();
        } else {
          renderer.render(scene, activeCamera);
        }
      };

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      }

      const hasActiveFreeKeys = () => {
        if (settingsRef.current.cameraMode !== 'free') return false;
        return (
          keysDown.has('KeyW') ||
          keysDown.has('KeyS') ||
          keysDown.has('KeyA') ||
          keysDown.has('KeyD') ||
          keysDown.has('KeyE') ||
          keysDown.has('KeyQ') ||
          keysDown.has('KeyC') ||
          keysDown.has('Space') ||
          keysDown.has('ArrowUp') ||
          keysDown.has('ArrowDown') ||
          keysDown.has('ArrowLeft') ||
          keysDown.has('ArrowRight')
        );
      };

      const needsContinuousLoop = () => {
        const s = settingsRef.current;
        return (
          s.autoRotate ||
          camAnimating ||
          hasActiveFreeKeys()
        );
      };

      const advanceFrame = (dt: number) => {
        const s = settingsRef.current;
        elapsedSec += dt;
        sharedUniforms.uTime.value = elapsedSec;

        if (s.cameraMode === 'free') {
          _euler.set(freePitch, freeYaw, 0, 'YXZ');
          activeCamera.quaternion.setFromEuler(_euler);

          _forward.set(0, 0, -1).applyQuaternion(activeCamera.quaternion).normalize();
          _right.set(1, 0, 0).applyQuaternion(activeCamera.quaternion).normalize();
          _moveVec.set(0, 0, 0);

          if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) _moveVec.add(_forward);
          if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) _moveVec.sub(_forward);
          if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) _moveVec.add(_right);
          if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) _moveVec.sub(_right);
          if (keysDown.has('KeyE') || keysDown.has('Space')) _moveVec.add(_worldUp);
          if (keysDown.has('KeyQ') || keysDown.has('KeyC')) _moveVec.sub(_worldUp);

          if (_moveVec.lengthSq() > 0) {
            _moveVec.normalize();
            const boost = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') ? 2.8 : 1.0;
            activeCamera.position.addScaledVector(_moveVec, s.flySpeed * boost * dt);
          }
        } else {
          if (s.autoRotate && !camAnimating) {
            const speed = 0.32 * dt;
            _offsetVec.copy(activeCamera.position).sub(controls.target);
            _offsetVec.applyAxisAngle(_worldUp, speed);
            activeCamera.position.copy(controls.target).add(_offsetVec);
          }

          if (camAnimating) {
            activeCamera.position.x = THREE.MathUtils.damp(
              activeCamera.position.x,
              camTargetPos.x,
              7,
              dt,
            );
            activeCamera.position.y = THREE.MathUtils.damp(
              activeCamera.position.y,
              camTargetPos.y,
              7,
              dt,
            );
            activeCamera.position.z = THREE.MathUtils.damp(
              activeCamera.position.z,
              camTargetPos.z,
              7,
              dt,
            );
            controls.target.x = THREE.MathUtils.damp(controls.target.x, camTargetLook.x, 7, dt);
            controls.target.y = THREE.MathUtils.damp(controls.target.y, camTargetLook.y, 7, dt);
            controls.target.z = THREE.MathUtils.damp(controls.target.z, camTargetLook.z, 7, dt);

            if (
              activeCamera.position.distanceTo(camTargetPos) < 0.08 &&
              controls.target.distanceTo(camTargetLook) < 0.08
            ) {
              activeCamera.position.copy(camTargetPos);
              controls.target.copy(camTargetLook);
              camAnimating = false;
            }
          }

          controls.update();
        }
      };

      function tick() {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;

        advanceFrame(dt);
        drawFrame();

        if (needsContinuousLoop()) {
          if (isSoftwareGl) afterDraw(tick);
          else frameId = requestAnimationFrame(tick);
        } else {
          isLoopRunning = false;
        }
      }

      function requestRender() {
        if (isLoopRunning) return;
        if (renderBusy) {
          renderDirty = true;
          return;
        }
        renderBusy = true;
        frameId = requestAnimationFrame(() => {
          renderDirty = false;
          const now = performance.now();
          const dt = Math.min(0.05, (now - lastTime) / 1000);
          lastTime = now;
          if (settingsRef.current.cameraMode === 'orbit') {
            controls.update();
          }
          sharedUniforms.uTime.value = elapsedSec + dt;
          drawFrame();
          const done = () => {
            renderBusy = false;
            if (renderDirty) requestRender();
          };
          if (isSoftwareGl) afterDraw(done);
          else done();
        });
      }

      function startOrPokeLoop() {
        if (needsContinuousLoop()) {
          if (!isLoopRunning) {
            isLoopRunning = true;
            lastTime = performance.now();
            if (isSoftwareGl) afterDraw(tick);
            else frameId = requestAnimationFrame(tick);
          }
        } else {
          requestRender();
        }
      }

      controls.addEventListener('change', () => {
        if (!isLoopRunning && settingsRef.current.cameraMode === 'orbit') {
          requestRender();
        }
      });

      // Free Cam pointer & keyboard handlers
      const onPointerDown = (e: PointerEvent) => {
        if (settingsRef.current.cameraMode !== 'free') return;
        if (e.button !== 0 && e.button !== 2) return;
        isFreeDragging = true;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
      };

      const onContextMenu = (e: MouseEvent) => {
        if (settingsRef.current.cameraMode === 'free') {
          e.preventDefault();
        }
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!isFreeDragging || settingsRef.current.cameraMode !== 'free') return;
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;

        freeYaw -= dx * 0.0042;
        freePitch = THREE.MathUtils.clamp(freePitch - dy * 0.0042, -Math.PI * 0.49, Math.PI * 0.49);
        _euler.set(freePitch, freeYaw, 0, 'YXZ');
        activeCamera.quaternion.setFromEuler(_euler);
        requestRender();
      };

      const onPointerUp = (e: PointerEvent) => {
        if (!isFreeDragging) return;
        isFreeDragging = false;
        if (renderer.domElement.hasPointerCapture(e.pointerId)) {
          renderer.domElement.releasePointerCapture(e.pointerId);
        }
      };

      const onWheel = (e: WheelEvent) => {
        if (settingsRef.current.cameraMode !== 'free') return;
        e.preventDefault();
        const step = e.deltaY < 0 ? 1.15 : 0.87;
        const nextSpeed = Math.round(
          THREE.MathUtils.clamp(settingsRef.current.flySpeed * step, 10, 240),
        );
        flySpeedCbRef.current?.(nextSpeed);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        if (settingsRef.current.cameraMode !== 'free') return;
        if (
          e.code === 'Space' ||
          e.code === 'ArrowUp' ||
          e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight'
        ) {
          e.preventDefault();
        }
        keysDown.add(e.code);
        if (hasActiveFreeKeys()) {
          startOrPokeLoop();
        }
      };

      const onKeyUp = (e: KeyboardEvent) => {
        keysDown.delete(e.code);
      };

      const onWindowBlur = () => {
        keysDown.clear();
        isFreeDragging = false;
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('contextmenu', onContextMenu);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerup', onPointerUp);
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onWindowBlur);

      let lastLightAz = settingsRef.current.lightAzimuth;
      let lastLightEl = settingsRef.current.lightElevation;

      const syncSettings = () => {
        const s = settingsRef.current;
        const theme = BACKDROP_THEMES[s.backdrop];
        const meshData = builtMeshRef.current;

        const targetFogHex = s.fogSyncSky ? theme.fogHex : s.fogColor || theme.fogHex;
        _fogColor.set(targetFogHex);
        (scene.background as THREE.Color).copy(_fogColor);

        const fogScale = Math.min(1, 32 / Math.max(32, modelRadius));
        const scaledFog = theme.fogDensity * s.fogDensity * fogScale;

        hemiLight.color.set(theme.skyHex);
        hemiLight.groundColor.set(theme.groundHex);

        const az = THREE.MathUtils.degToRad(s.lightAzimuth);
        const el = THREE.MathUtils.degToRad(s.lightElevation);
        _lightDir
          .set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
          .normalize();
        const lightDist = Math.max(60, modelRadius * 2.6);
        keyLight.position.copy(_lightDir).multiplyScalar(lightDist);
        keyLight.position.y += modelCenterY;
        keyLight.target.position.set(0, modelCenterY * 0.4, 0);

        if (s.lightAzimuth !== lastLightAz || s.lightElevation !== lastLightEl) {
          lastLightAz = s.lightAzimuth;
          lastLightEl = s.lightElevation;
          renderer.shadowMap.needsUpdate = true;
        }

        _lightColor.set(s.sunColor || theme.defaultSunHex);
        keyLight.color.copy(_lightColor);
        keyLight.intensity = s.lightIntensity;

        renderer.toneMappingExposure = s.exposure;

        voxelMesh.material = materials[s.shaderMode];
        materials.pbr.roughness = s.roughness;
        materials.pbr.metalness = s.metalness;
        materials.pbr.clearcoat = s.metalness > 0.35 ? 0.35 : 0.08;

        syncSharedUniforms(
          sharedUniforms,
          s,
          modelBounds,
          _lightDir,
          _lightColor,
          _fogColor,
          scaledFog,
        );

        // Update Perspective FOV
        if (Math.abs(perspCamera.fov - s.cameraFov) > 0.01) {
          perspCamera.fov = s.cameraFov;
          perspCamera.updateProjectionMatrix();
        }

        // Camera Mode switch (Orbit <-> Free Cam)
        if (s.cameraMode !== lastCameraMode) {
          lastCameraMode = s.cameraMode;
          if (s.cameraMode === 'free') {
            controls.enabled = false;
            camAnimating = false;
            syncFreeAnglesFromCamera();
          } else {
            _forward.set(0, 0, -1).applyQuaternion(activeCamera.quaternion).normalize();
            const targetDist = Math.max(24, modelRadius * 0.55);
            controls.target.copy(activeCamera.position).addScaledVector(_forward, targetDist);
            controls.target.y = Math.max(0, controls.target.y);
            controls.enabled = true;
            controls.update();
          }
        } else {
          controls.enabled = s.cameraMode === 'orbit';
        }

        // Circular pedestal strictly for .kv6, Infinite Water Ocean automatically for .vxl water maps
        const isKv6 = meshData?.format === 'kv6';
        const isVxl = meshData?.format === 'vxl';
        const hasWaterOverride = s.waterColorOverride.trim().length > 0;
        const vxlHasWater = isVxl && (meshData?.waterColorHex !== null || hasWaterOverride);

        if (vxlHasWater) {
          const wHex = hasWaterOverride
            ? s.waterColorOverride
            : meshData!.waterColorHex || '#3B6D96';
          oceanMesh.visible = true;
          oceanUniforms.uWaterColor.value.set(wHex);
          oceanUniforms.uWaveStrength.value = s.waveStrength;
          oceanUniforms.uMapHalfSize.value.set(meshData!.size.x * 0.5, meshData!.size.z * 0.5);

          underlayMesh.visible = true;
          underlayMesh.scale.set(meshData!.size.x, 1, meshData!.size.z);
          underlayUniforms.uWaterColor.value.set(wHex);
          underlayUniforms.uMapHalfSize.value.set(meshData!.size.x * 0.5, meshData!.size.z * 0.5);
        } else {
          oceanMesh.visible = false;
          underlayMesh.visible = false;
        }

        pedestalGroup.visible = isKv6 && s.showPedestal;
        contactShadow.visible = isKv6 && s.showPedestal;
        platterMat.color.set(theme.isLight ? '#DED8CE' : '#232730');
        baseMat.color.set(theme.isLight ? '#CFC7BB' : '#181B21');

        // Perspective vs Orthographic switch (only in Orbit mode; Free Cam uses Perspective)
        const targetCam =
          s.orthographic && s.cameraMode === 'orbit' ? orthoCamera : perspCamera;
        if (targetCam !== activeCamera) {
          targetCam.position.copy(activeCamera.position);
          targetCam.quaternion.copy(activeCamera.quaternion);
          const dist = activeCamera.position.distanceTo(controls.target);
          if (targetCam === orthoCamera) {
            const halfH = Math.max(4, dist * Math.tan(THREE.MathUtils.degToRad(perspCamera.fov * 0.5)));
            const curAspect = (container.clientWidth || 1) / (container.clientHeight || 1);
            orthoCamera.left = -halfH * curAspect;
            orthoCamera.right = halfH * curAspect;
            orthoCamera.top = halfH;
            orthoCamera.bottom = -halfH;
            orthoCamera.zoom = 1;
            orthoCamera.updateProjectionMatrix();
          }
          activeCamera = targetCam;
          controls.object = activeCamera;
          if (renderPass) renderPass.camera = activeCamera;
        }

        if (bloomPass) {
          bloomPass.enabled = s.bloomStrength > 0.005;
          bloomPass.strength = s.bloomStrength;
        }
        if (studioPass) {
          studioPass.uniforms.uVignette.value = s.vignette;
          studioPass.uniforms.uChromatic.value = s.chromatic;
          studioPass.uniforms.uPixelate.value = s.pixelate;
          studioPass.uniforms.uTiltShift.value = s.tiltShift;
        }

        startOrPokeLoop();
      };

      const syncMesh = (meshData: BuiltVoxelMesh | null, instantCamera = false) => {
        if (!meshData) {
          voxelMesh.visible = false;
          renderer.shadowMap.needsUpdate = true;
          syncSettings();
          return;
        }
        voxelMesh.visible = true;
        const oldGeo = voxelMesh.geometry;
        voxelMesh.geometry = meshData.geometry;
        oldGeo.dispose();

        if (meshData.geometry.boundingBox) {
          modelBounds.copy(meshData.geometry.boundingBox);
        }
        const sx = meshData.size.x;
        const sy = meshData.size.y;
        const sz = meshData.size.z;
        modelRadius = Math.max(6, Math.hypot(sx, sy, sz) * 0.5);
        modelCenterY = sy * 0.5;

        const d = Math.max(16, modelRadius * 1.45);
        keyLight.shadow.camera.left = -d;
        keyLight.shadow.camera.right = d;
        keyLight.shadow.camera.top = d;
        keyLight.shadow.camera.bottom = -d;
        keyLight.shadow.camera.near = 1;
        keyLight.shadow.camera.far = Math.max(200, d * 6);
        keyLight.shadow.camera.updateProjectionMatrix();

        const footprint = Math.max(sx, sz);
        const shadowSize = Math.max(12, footprint * 1.55);
        contactShadow.scale.set(shadowSize, 1, shadowSize);

        const pedRadius = Math.max(12, footprint * 0.88);
        pedestalGroup.scale.set(pedRadius, 1, pedRadius);

        controls.maxDistance = Math.max(400, modelRadius * 9);
        renderer.shadowMap.needsUpdate = true;
        syncSettings();
        applyPreset('iso', instantCamera);
      };

      const exportPng = (filename: string) => {
        drawFrame();
        const dataUrl = renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      engineRef.current = {
        applyPreset,
        syncMesh,
        syncSettings,
        exportPng,
      };

      if (builtMeshRef.current) {
        syncMesh(builtMeshRef.current, true);
      } else {
        syncSettings();
        applyPreset('low', true);
      }

      if (!isSoftwareGl) {
        renderer.compile(scene, activeCamera);
      }

      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        const asp = w / Math.max(1, h);

        perspCamera.aspect = asp;
        perspCamera.updateProjectionMatrix();

        const halfH = orthoCamera.top;
        orthoCamera.left = -halfH * asp;
        orthoCamera.right = halfH * asp;
        orthoCamera.updateProjectionMatrix();

        renderer.setSize(w, h);
        if (composer) composer.setSize(w, h);
        if (bloomPass) bloomPass.resolution.set(w, h);
        if (studioPass) studioPass.uniforms.uResolution.value.set(w, h);
        requestRender();
      };
      window.addEventListener('resize', handleResize);

      return () => {
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onWindowBlur);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('contextmenu', onContextMenu);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('wheel', onWheel);
        controls.removeEventListener('start', cancelCamAnim);
        controls.dispose();
        renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

        voxelMesh.geometry.dispose();
        materials.dispose();
        skyGeo.dispose();
        skyMat.dispose();
        oceanGeo.dispose();
        oceanMat.dispose();
        underlayGeo.dispose();
        underlayMat.dispose();
        contactShadowGeo.dispose();
        contactShadowMat.dispose();
        shadowTex.dispose();
        platterGeo.dispose();
        platterMat.dispose();
        trimGeo.dispose();
        trimMat.dispose();
        baseGeo.dispose();
        baseMat.dispose();
        envTex.dispose();
        if (composer) composer.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
        engineRef.current = null;
      };
    }, []);

    useEffect(() => {
      engineRef.current?.syncMesh(builtMesh, false);
    }, [builtMesh]);

    useEffect(() => {
      engineRef.current?.syncSettings();
    }, [settings]);

    return (
      <div
        className="relative w-full h-full overflow-hidden"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingFile(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDraggingFile(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingFile(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFileDrop(file);
        }}
      >
        <div
          ref={mountRef}
          data-testid="voxel-canvas-mount"
          className="w-full h-full cursor-grab active:cursor-grabbing"
        />

        {contextLost && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#14171D] text-[#F3F1EC] z-30">
            <div className="max-w-sm text-center px-6 py-5 border border-white/10 rounded-lg bg-[#1A1D24]">
              <p className="font-display text-base font-semibold">WebGL Context Suspended</p>
              <p className="text-sm text-[#9DA3AE] mt-1.5">
                Your graphics driver paused the 3D viewport. Reload or wait for restoration.
              </p>
            </div>
          </div>
        )}

        {isDraggingFile && (
          <div className="absolute inset-4 z-30 pointer-events-none rounded-lg border-2 border-dashed border-[#E05A2B] bg-[#14171D]/85 flex flex-col items-center justify-center gap-2">
            <p className="font-display text-lg font-semibold text-[#F3F1EC]">
              Drop .vxl map or .kv6 model
            </p>
            <p className="text-sm text-[#9DA3AE]">
              Supports Ace of Spades 512×512×64 .vxl maps and Voxlap .kv6 models
            </p>
          </div>
        )}
      </div>
    );
  },
);
