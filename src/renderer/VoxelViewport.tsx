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
import {
  canUseSinglePassExport,
  computeExportTiles,
  computeUpscaledDimensions,
} from '../voxel/exportResolution';
import { CameraPreset, MAX_VOXEL_LIGHTS, RenderSettings, VoxelGrid, VoxelLight } from '../voxel/types';
import { sortVoxelLightsByIntensity, updateVoxelLightTexture } from './voxelLightTexture';
import {
  createVoxelShadowTexture,
  hydrateVoxelShadowTexture,
  VoxelShadowAtlasData,
} from './voxelShadows';
import {
  BACKDROP_THEMES,
  createMaterialBank,
  createOceanMaterial,
  createSharedUniforms,
  createSkyDomeMaterial,
  MaterialBank,
  MAX_VOXEL_SHADOW_CASTERS,
  SharedShaderUniforms,
  StudioPostShader,
  syncSharedUniforms,
} from './shaders';
import { computeSlicePlane, isInsideSlice as pointInsideSlice } from './slice';

export interface VoxelViewportHandle {
  applyCameraPreset: (preset: CameraPreset) => void;
  getDisplayResolution: () => { width: number; height: number };
  getMaxTextureSize: () => number;
  exportPng: (filename: string, targetWidth?: number) => Promise<void>;
  /** Projects a voxel-grid coordinate to viewport-relative CSS pixels. */
  projectVoxelToScreen: (
    x: number,
    y: number,
    z: number,
  ) => { x: number; y: number; visible: boolean };
}

export interface PrecomputedShadowData {
  atlas: VoxelShadowAtlasData | null;
  error: string | null;
}

interface VoxelViewportProps {
  builtMesh: BuiltVoxelMesh | null;
  voxelGrid: VoxelGrid | null;
  precomputedShadow?: PrecomputedShadowData | null;
  onShadowWarning: (message: string | null) => void;
  settings: RenderSettings;
  onFileDrop: (file: File) => void;
  onAdjustFlySpeed?: (nextSpeed: number) => void;
  /** Called when free cam makes the orbit-only turntable spin meaningless. */
  onDisableAutoRotate?: () => void;
  voxelLights: VoxelLight[];
  pickingMode: boolean;
  onVoxelPicked: (x: number, y: number, z: number, normal: [number, number, number]) => void;
}

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
  function VoxelViewport(
    { builtMesh, voxelGrid, precomputedShadow, onShadowWarning, settings, onFileDrop, onAdjustFlySpeed, onDisableAutoRotate, voxelLights, pickingMode, onVoxelPicked },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const voxelGridRef = useRef(voxelGrid);
    voxelGridRef.current = voxelGrid;
    const precomputedShadowRef = useRef(precomputedShadow);
    precomputedShadowRef.current = precomputedShadow;
    const shadowWarningRef = useRef(onShadowWarning);
    shadowWarningRef.current = onShadowWarning;
    const builtMeshRef = useRef(builtMesh);
    builtMeshRef.current = builtMesh;
    const flySpeedCbRef = useRef(onAdjustFlySpeed);
    flySpeedCbRef.current = onAdjustFlySpeed;
    const disableAutoRotateRef = useRef(onDisableAutoRotate);
    disableAutoRotateRef.current = onDisableAutoRotate;
    const voxelLightsRef = useRef(voxelLights);
    voxelLightsRef.current = voxelLights;
    const pickingModeRef = useRef(pickingMode);
    pickingModeRef.current = pickingMode;
    const onVoxelPickedRef = useRef(onVoxelPicked);
    onVoxelPickedRef.current = onVoxelPicked;

    const [contextLost, setContextLost] = useState(false);
    const [isDraggingFile, setIsDraggingFile] = useState(false);

    const engineRef = useRef<{
      applyPreset: (preset: CameraPreset, instant?: boolean) => void;
      syncMesh: (meshData: BuiltVoxelMesh | null, instantCamera?: boolean) => void;
      syncSettings: () => void;
      syncVoxelLights: () => void;
      syncVoxelGrid: (grid: VoxelGrid | null) => void;
      getDisplayResolution: () => { width: number; height: number };
      getMaxTextureSize: () => number;
      exportPng: (filename: string, targetWidth?: number) => Promise<void>;
      projectVoxelToScreen: (
        x: number,
        y: number,
        z: number,
      ) => { x: number; y: number; visible: boolean };
    } | null>(null);

    useImperativeHandle(ref, () => ({
      applyCameraPreset: (preset: CameraPreset) => {
        engineRef.current?.applyPreset(preset, false);
      },
      getDisplayResolution: () => {
        if (engineRef.current) return engineRef.current.getDisplayResolution();
        return {
          width: Math.max(1, Math.round((mountRef.current?.clientWidth || window.innerWidth) * Math.min(window.devicePixelRatio || 1, 2))),
          height: Math.max(1, Math.round((mountRef.current?.clientHeight || window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2))),
        };
      },
      getMaxTextureSize: () => {
        return engineRef.current?.getMaxTextureSize() ?? 4096;
      },
      exportPng: async (filename: string, targetWidth?: number) => {
        if (engineRef.current) {
          await engineRef.current.exportPng(filename, targetWidth);
        }
      },
      projectVoxelToScreen: (x: number, y: number, z: number) => {
        if (engineRef.current) return engineRef.current.projectVoxelToScreen(x, y, z);
        return { x: 0, y: 0, visible: false };
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
        // GPU resources are gone until three re-uploads them; the shadow atlas and
        // the visible frame both have to be rebuilt, and the canvas stays black
        // until something asks for a draw.
        renderer.shadowMap.needsUpdate = true;
        requestRender();
      };
      renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

      const scene = new THREE.Scene();
      const initialTheme = BACKDROP_THEMES[settingsRef.current.backdrop];
      scene.background = new THREE.Color(initialTheme.bgHex);
      scene.fog = null;

      const pmrem = new THREE.PMREMGenerator(renderer);
      const roomEnvironment = new RoomEnvironment();
      const envTex = pmrem.fromScene(roomEnvironment, 0.04).texture;
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

      // Section slicing is expressed as a local clipping plane instead of a shader
      // `discard`, because the shadow (depth) pass honours clipping planes
      // (`clipShadows`) while a `discard` only affects the visible material.
      // Raycasting still ignores clipping planes, so picking filters hits through
      // `isInsideSlice` below.
      const slicePlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
      renderer.localClippingEnabled = true;

      const materials: MaterialBank = createMaterialBank(sharedUniforms);

      let shadowGrid: VoxelGrid | null | undefined;
      const syncVoxelGrid = (grid: VoxelGrid | null) => {
        if (grid === shadowGrid) return;
        shadowGrid = grid;
        sharedUniforms.uVoxelShadowTexture.value.dispose();
        const emptyTexture = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
        emptyTexture.needsUpdate = true;
        sharedUniforms.uVoxelShadowTexture.value = emptyTexture;
        sharedUniforms.uVoxelShadowsEnabled.value = 0;
        if (grid) {
          try {
            const pre = precomputedShadowRef.current;
            if (pre) {
              if (pre.atlas) {
                const atlas = hydrateVoxelShadowTexture(pre.atlas);
                emptyTexture.dispose();
                sharedUniforms.uVoxelShadowTexture.value = atlas.texture;
                sharedUniforms.uVoxelShadowAtlas.value.set(atlas.width, atlas.height, atlas.stride);
                sharedUniforms.uVoxelGridSize.value.set(grid.width, grid.height, grid.depth);
                sharedUniforms.uVoxelGridOffset.value.set(grid.width * 0.5, 0, grid.depth * 0.5);
                sharedUniforms.uVoxelShadowsEnabled.value = 1;
                shadowWarningRef.current(null);
              } else {
                shadowWarningRef.current(
                  pre.error ?? 'Could not create voxel-light shadows. Lights will be unshadowed.',
                );
              }
            } else {
              const atlas = createVoxelShadowTexture(grid, renderer.capabilities.maxTextureSize);
              emptyTexture.dispose();
              sharedUniforms.uVoxelShadowTexture.value = atlas.texture;
              sharedUniforms.uVoxelShadowAtlas.value.set(atlas.width, atlas.height, atlas.stride);
              sharedUniforms.uVoxelGridSize.value.set(grid.width, grid.height, grid.depth);
              sharedUniforms.uVoxelGridOffset.value.set(grid.width * 0.5, 0, grid.depth * 0.5);
              sharedUniforms.uVoxelShadowsEnabled.value = 1;
              shadowWarningRef.current(null);
            }
          } catch (error) {
            shadowWarningRef.current(error instanceof Error ? error.message : 'Could not create voxel-light shadows. Lights will be unshadowed.');
          }
        } else {
          shadowWarningRef.current(null);
        }
        requestRender();
      };

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

      // --- Voxel Lights (Special Effects) -----------------------------------
      // Grid mapping: mesher centers X/Z at 0 and grounds Y at 0, so a voxel
      // (x, y, z) center sits at (x + 0.5 - size.x/2, y + 0.5, z + 0.5 - size.z/2).
      const gridSize = new THREE.Vector3(1, 1, 1);
      const gridOffset = new THREE.Vector3(0.5, 0, 0.5);

      const voxelToWorld = (x: number, y: number, z: number, out: THREE.Vector3) => {
        out.set(x + 0.5 - gridOffset.x, y + 0.5 - gridOffset.y, z + 0.5 - gridOffset.z);
        return out;
      };

      const markerGroup = new THREE.Group();
      markerGroup.name = 'voxel-light-markers';
      scene.add(markerGroup);

      // A single instanced draw keeps the editor markers cheap even with many lights.
      const markerGeo = new THREE.BoxGeometry(1.06, 1.06, 1.06);
      const markerMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.45, depthWrite: false,
      });
      const markers = new THREE.InstancedMesh(markerGeo, markerMaterial, MAX_VOXEL_LIGHTS);
      markers.count = 0;
      markers.frustumCulled = false;
      markerGroup.add(markers);
      const markerMatrix = new THREE.Matrix4();
      const markerPosition = new THREE.Vector3();
      const markerColor = new THREE.Color();

      const syncVoxelLights = () => {
        const sortedLights = sortVoxelLightsByIntensity(voxelLightsRef.current);
        sharedUniforms.uVoxelLightCount.value = updateVoxelLightTexture(
          sharedUniforms.uVoxelLightTexture.value, sortedLights, gridOffset,
        );
        sharedUniforms.uShadowCasterCount.value = Math.min(
          sortedLights.length,
          MAX_VOXEL_SHADOW_CASTERS,
        );
        markers.count = sortedLights.length;
        sortedLights.forEach((light, i) => {
          voxelToWorld(light.x, light.y, light.z, markerPosition);
          const scale = light.intensity > 0.001 ? 1 : 0;
          markerMatrix.makeScale(scale, scale, scale).setPosition(markerPosition);
          markers.setMatrixAt(i, markerMatrix);
          markers.setColorAt(i, markerColor.set(light.color));
        });
        markers.instanceMatrix.needsUpdate = true;
        if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
        if (!pickingModeRef.current) hoverBox.visible = false;
        requestRender();
      };

      // Hover highlight box (shown while picking a voxel)
      const hoverBox = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
        new THREE.LineBasicMaterial({ color: '#E05A2B', toneMapped: false }),
      );
      hoverBox.visible = false;
      hoverBox.frustumCulled = false;
      scene.add(hoverBox);

      const raycaster = new THREE.Raycaster();
      const pointerNdc = new THREE.Vector2();
      const hitPoint = new THREE.Vector3();
      const hitNormal = new THREE.Vector3();
      const hoverVoxel = new THREE.Vector3(-1, -1, -1);

      /**
       * Closest raycast hit that is not hidden by the section slice. three's
       * raycast only tests triangles, so sliced-away geometry would otherwise be
       * pickable and lights could be attached to invisible voxels.
       */
      const firstVisibleHit = (): THREE.Intersection | null => {
        const hits = raycaster.intersectObject(voxelMesh, false);
        for (const candidate of hits) {
          if (isInsideSlice(candidate.point.x, candidate.point.y, candidate.point.z)) {
            return candidate;
          }
        }
        return null;
      };

      const pickVoxelAt = (clientX: number, clientY: number): boolean => {
        if (!voxelMesh.visible) return false;
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        pointerNdc.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointerNdc, activeCamera);
        const hit = firstVisibleHit();
        if (!hit) return false;
        hitPoint.copy(hit.point);
        if (hit.face && hit.face.normal) {
          hitNormal.copy(hit.face.normal);
        } else {
          hitNormal.set(0, 1, 0);
        }
        // Step slightly inside the face so floor() lands on the solid voxel.
        hitPoint.addScaledVector(hitNormal, -0.02);
        const vx = Math.floor(hitPoint.x + gridOffset.x);
        const vy = Math.floor(hitPoint.y + gridOffset.y);
        const vz = Math.floor(hitPoint.z + gridOffset.z);
        if (
          vx < 0 || vy < 0 || vz < 0 ||
          vx >= Math.round(gridSize.x) ||
          vy >= Math.round(gridSize.y) ||
          vz >= Math.round(gridSize.z)
        ) {
          return false;
        }
        hoverVoxel.set(vx, vy, vz);
        voxelToWorld(vx, vy, vz, hoverBox.position);
        hoverBox.visible = pickingModeRef.current;
        onVoxelPickedRef.current(vx, vy, vz, [hitNormal.x, hitNormal.y, hitNormal.z]);
        return true;
      };

      const updateHoverAt = (clientX: number, clientY: number) => {
        if (!pickingModeRef.current || !voxelMesh.visible) {
          hoverBox.visible = false;
          return;
        }
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
          hoverBox.visible = false;
          return;
        }
        pointerNdc.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointerNdc, activeCamera);
        const hit = firstVisibleHit();
        if (!hit) {
          hoverBox.visible = false;
          return;
        }
        hitPoint.copy(hit.point);
        if (hit.face && hit.face.normal) hitNormal.copy(hit.face.normal);
        else hitNormal.set(0, 1, 0);
        hitPoint.addScaledVector(hitNormal, -0.02);
        const vx = Math.floor(hitPoint.x + gridOffset.x);
        const vy = Math.floor(hitPoint.y + gridOffset.y);
        const vz = Math.floor(hitPoint.z + gridOffset.z);
        if (
          vx < 0 || vy < 0 || vz < 0 ||
          vx >= Math.round(gridSize.x) ||
          vy >= Math.round(gridSize.y) ||
          vz >= Math.round(gridSize.z)
        ) {
          hoverBox.visible = false;
          return;
        }
        hoverVoxel.set(vx, vy, vz);
        voxelToWorld(vx, vy, vz, hoverBox.position);
        hoverBox.visible = true;
        requestRender();
      };

      const projectedScratch = new THREE.Vector3();
      let lastCanvasRect: DOMRect | null = null;
      const projectVoxelToScreen = (x: number, y: number, z: number) => {
        // Cached rect: the panel probes this every animation frame and a layout
        // read per frame is what actually costs here.
        const rect = lastCanvasRect ?? (lastCanvasRect = renderer.domElement.getBoundingClientRect());
        voxelToWorld(x, y, z, projectedScratch);
        const projected = projectedScratch.project(activeCamera);
        const visible =
          projected.z > -1 && projected.z < 1 &&
          projected.x > -1.2 && projected.x < 1.2 &&
          projected.y > -1.2 && projected.y < 1.2;
        return {
          x: rect.left + ((projected.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - projected.y) / 2) * rect.height,
          visible,
        };
      };

      // Post-Processing Composer (GPU only; crisp high-threshold bloom)
      let composer: EffectComposer | null = null;
      let renderPass: RenderPass | null = null;
      let bloomPass: UnrealBloomPass | null = null;
      let studioPass: ShaderPass | null = null;
      let outputPass: OutputPass | null = null;

      if (!isSoftwareGl) {
        composer = new EffectComposer(renderer);
        renderPass = new RenderPass(scene, activeCamera);
        composer.addPass(renderPass);
        bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height), settingsRef.current.bloomStrength, 0.32, 0.94,
        );
        composer.addPass(bloomPass);
        studioPass = new ShaderPass(StudioPostShader);
        const initialPixelRatio = renderer.getPixelRatio();
        bloomPass.resolution.set(
          Math.round(width * initialPixelRatio),
          Math.round(height * initialPixelRatio),
        );
        studioPass.uniforms.uResolution.value.set(
          Math.round(width * initialPixelRatio),
          Math.round(height * initialPixelRatio),
        );
        composer.addPass(studioPass);
        outputPass = new OutputPass();
        composer.addPass(outputPass);
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
      // While a tiled export resizes the canvas and sets a view offset, any other
      // render (settings change, resize, hover) would corrupt a tile and flash the
      // stretched canvas. Defer those until the export restores its state.
      let isExporting = false;
      let lastTime = performance.now();
      let elapsedSec = 1.4;

      const drawFrame = () => {
        skyMesh.position.copy(activeCamera.position);
        if (composer && !isSoftwareGl) composer.render();
        else renderer.render(scene, activeCamera);
      };

      // Software GL (SwiftShader / llvmpipe) renders on the CPU, so waiting for the
      // fence and then sleeping used to hard-cap the loop at ~12 fps with ~80 ms of
      // input latency on every frame. Poll faster and shorten the post-draw pause;
      // the fence already guarantees we never queue work faster than it drains.
      const SOFT_GL_POLL_MS = 2;
      const SOFT_GL_SETTLE_MS = 16;

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, SOFT_GL_POLL_MS);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, SOFT_GL_SETTLE_MS);
          }
        };
        frameId = window.setTimeout(poll, SOFT_GL_POLL_MS);
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

      const hasAnimatedWater = () => {
        const meshData = builtMeshRef.current;
        const s = settingsRef.current;
        if (meshData?.format !== 'vxl') return false;
        const hasWater =
          meshData.waterColorHex !== null || s.waterColorOverride.trim().length > 0;
        return hasWater && s.waveStrength > 0.001;
      };

      const needsContinuousLoop = () => {
        const s = settingsRef.current;
        return (
          s.autoRotate ||
          camAnimating ||
          hasActiveFreeKeys() ||
          // `uTime` only advances inside the loop, so waves, drifting volumetric
          // clouds and cloud shadows freeze into a static (wrong-looking) frame
          // when the camera is idle.
          (s.volumetricClouds && s.volumetricStrength > 0.01) ||
          hasAnimatedWater()
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
        if (isExporting) {
          renderDirty = true;
          return;
        }
        if (isLoopRunning) return;
        if (renderBusy) {
          renderDirty = true;
          return;
        }
        renderBusy = true;
        frameId = requestAnimationFrame(() => {
          if (isExporting) {
            renderBusy = false;
            renderDirty = true;
            return;
          }
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
        if (isExporting) {
          renderDirty = true;
          return;
        }
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

      // Voxel-light picking: click (not drag) selects a voxel while picking.
      let pickDownX = 0;
      let pickDownY = 0;
      const onPickPointerDown = (e: PointerEvent) => {
        pickDownX = e.clientX;
        pickDownY = e.clientY;
      };
      const onPickPointerUp = (e: PointerEvent) => {
        if (!pickingModeRef.current) return;
        if (e.button !== 0) return;
        const moved = Math.hypot(e.clientX - pickDownX, e.clientY - pickDownY);
        if (moved > 6) return;
        pickVoxelAt(e.clientX, e.clientY);
      };
      const onPickPointerMove = (e: PointerEvent) => {
        if (!pickingModeRef.current) return;
        updateHoverAt(e.clientX, e.clientY);
        requestRender();
      };
      const onPickPointerLeave = () => {
        if (hoverBox.visible) {
          hoverBox.visible = false;
          requestRender();
        }
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('contextmenu', onContextMenu);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerup', onPointerUp);
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
      renderer.domElement.addEventListener('pointerdown', onPickPointerDown);
      renderer.domElement.addEventListener('pointerup', onPickPointerUp);
      renderer.domElement.addEventListener('pointermove', onPickPointerMove);
      renderer.domElement.addEventListener('pointerleave', onPickPointerLeave);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onWindowBlur);

      // Orthographic zoom survives a perspective <-> orthographic round trip.
      let savedOrthoZoom = 1;

      let lastLightAz = settingsRef.current.lightAzimuth;
      let lastLightEl = settingsRef.current.lightElevation;
      let lastSliceAxis = settingsRef.current.sliceAxis;
      let sliceActive = false;

      /**
       * Mirrors the slice onto every voxel material.
       *
       * `slicePlane` is reused and only its normal/constant change, so three
       * re-projects it on every draw and the shadow pass (which reads
       * `material.clippingPlanes` per object) follows the cut immediately.
       * Registering/removing the plane flips `NUM_CLIPPING_PLANES`, which three
       * turns into a program rebuild by itself.
       */
      const applySlicePlanes = (active: boolean) => {
        for (const material of materials.all) {
          const planes = material.clippingPlanes;
          if (active) {
            if (!planes || planes.length === 0) material.clippingPlanes = [slicePlane];
            else planes[0] = slicePlane;
          } else if (planes && planes.length > 0) {
            material.clippingPlanes = [];
          }
        }
        sliceActive = active;
      };

      const syncSlicePlanes = (s: RenderSettings, bounds: THREE.Box3) => {
        const active = computeSlicePlane(s.sliceAxis, s.slicePosition, bounds, slicePlane);
        applySlicePlanes(active);
      };

      /**
       * True when a world-space point survives the active section slice. Used to
       * filter raycast hits, because three's raycast ignores clipping planes.
       */
      const isInsideSlice = (worldX: number, worldY: number, worldZ: number): boolean =>
        !sliceActive || pointInsideSlice(slicePlane, worldX, worldY, worldZ);

      const syncSettings = () => {
        const s = settingsRef.current;
        const theme = BACKDROP_THEMES[s.backdrop];
        const meshData = builtMeshRef.current;
        const isCustom = s.backdrop === 'custom';

        const targetFogHex = s.fogSyncSky
          ? (isCustom ? s.customHorizonColor : theme.fogHex)
          : s.fogColor || theme.fogHex;
        _fogColor.set(targetFogHex);
        // Only visible where the sky dome is hidden (`graphite` / `paper`).
        (scene.background as THREE.Color).copy(_fogColor);
        skyMesh.visible = theme.isSkyDome;

        const fogScale = Math.min(1, 32 / Math.max(32, modelRadius));
        const scaledFog = theme.fogDensity * s.fogDensity * fogScale;

        hemiLight.color.set(isCustom ? s.customHorizonColor : theme.skyHex);
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

        syncSlicePlanes(s, modelBounds);
        if (sliceActive || s.sliceAxis !== lastSliceAxis) {
          // The shadow pass is manual (autoUpdate = false) and now respects the
          // clip plane, so the atlas must be rebuilt whenever the cut moves.
          lastSliceAxis = s.sliceAxis;
          renderer.shadowMap.needsUpdate = true;
        }

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
            // Turntable spin only orbits the camera, so having it "on" in free cam
            // is dead state that also keeps the animation loop alive. Switching to
            // free cam turns it off.
            if (s.autoRotate) disableAutoRotateRef.current?.();
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
        if (activeCamera !== orthoCamera) savedOrthoZoom = orthoCamera.zoom;
        if (targetCam !== activeCamera) {
          targetCam.position.copy(activeCamera.position);
          targetCam.quaternion.copy(activeCamera.quaternion);
          const dist = activeCamera.position.distanceTo(controls.target);
          if (targetCam === orthoCamera) {
            // Frame the same extent the perspective camera sees, and keep the
            // user's zoom instead of snapping back to 1 every time the toggle
            // flips (OrbitControls drives zoom on the ortho camera).
            const halfH = Math.max(4, dist * Math.tan(THREE.MathUtils.degToRad(perspCamera.fov * 0.5)));
            const curAspect = (container.clientWidth || 1) / (container.clientHeight || 1);
            // OrbitControls zooms the ortho camera directly while it is active, so
            // remember that value while still in perspective and restore it here.
            orthoCamera.left = -halfH * curAspect;
            orthoCamera.right = halfH * curAspect;
            orthoCamera.top = halfH;
            orthoCamera.bottom = -halfH;
            orthoCamera.zoom = savedOrthoZoom;
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
          hoverBox.visible = false;
          renderer.shadowMap.needsUpdate = true;
          syncSettings();
          return;
        }
        voxelMesh.visible = true;
        const oldGeo = voxelMesh.geometry;
        voxelMesh.geometry = meshData.geometry;
        // On HMR/remount the init effect and the `[builtMesh]` effect both call
        // syncMesh with the same mesh; disposing it would free the live geometry
        // and force a wasteful re-upload.
        if (oldGeo !== meshData.geometry) oldGeo.dispose();

        gridSize.copy(meshData.size);
        gridOffset.set(meshData.size.x * 0.5, 0, meshData.size.z * 0.5);

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

      const getDisplayResolution = () => ({
        width: Math.max(1, renderer.domElement.width),
        height: Math.max(1, renderer.domElement.height),
      });

      const downloadCanvasPng = (canvas: HTMLCanvasElement, filename: string): Promise<void> =>
        new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Failed to encode PNG image at this resolution.'));
              return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            resolve();
          }, 'image/png');
        });

      const exportPng = async (filename: string, targetWidth?: number) => {
        if (isExporting) return;
        isExporting = true;
        const resumeLoopAfterExport = isLoopRunning;
        if (isLoopRunning) {
          isLoopRunning = false;
          cancelAnimationFrame(frameId);
          clearTimeout(frameId);
        }
        frameId = 0;

        // Hide editor-only helpers (light markers, pick highlight) from exports.
        const savedMarkerVisible = markerGroup.visible;
        const savedHoverVisible = hoverBox.visible;
        markerGroup.visible = false;
        hoverBox.visible = false;

        const baseW = Math.max(1, renderer.domElement.width);
        const baseH = Math.max(1, renderer.domElement.height);

        try {
          if (!targetWidth || targetWidth <= baseW) {
            drawFrame();
            await downloadCanvasPng(renderer.domElement, filename);
            return;
          }

          const dims = computeUpscaledDimensions(baseW, baseH, targetWidth);
          const targetW = dims.width;
          const targetH = dims.height;

          const savedPixelRatio = renderer.getPixelRatio();
          const savedCssSize = new THREE.Vector2();
          renderer.getSize(savedCssSize);

          // The composer's bloom mips are sized for the viewport; while the canvas
          // is temporarily resized they must not sample stale targets. Both the
          // composer path and the single-pass path restore them afterwards.
          const restorePostSize = () => {
            const pixelRatio = renderer.getPixelRatio();
            const pixelW = Math.max(1, Math.round(savedCssSize.x * pixelRatio));
            const pixelH = Math.max(1, Math.round(savedCssSize.y * pixelRatio));
            if (bloomPass) bloomPass.resolution.set(pixelW, pixelH);
            if (studioPass) studioPass.uniforms.uResolution.value.set(pixelW, pixelH);
          };


          const gl = renderer.getContext();
          const maxTex = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 4096;
          const maxRb = (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) || 4096;

          // Tracked outside the tile branch so an error mid-export still restores
          // the canvas instead of leaving it hidden/stretched.
          let hiddenCanvas: HTMLCanvasElement | null = null;
          let savedVisibility = '';
          const restoreRendererSize = () => {
            if (hiddenCanvas) {
              hiddenCanvas.style.visibility = savedVisibility;
              hiddenCanvas.style.width = '100%';
              hiddenCanvas.style.height = '100%';
              hiddenCanvas = null;
            }
            activeCamera.clearViewOffset();
            renderer.setPixelRatio(savedPixelRatio);
            // `updateStyle = true`: setSize(tile, false) left the canvas CSS size
            // frozen at the tile size, which is why tiled exports looked stretched.
            renderer.setSize(savedCssSize.x, savedCssSize.y);
            renderer.domElement.style.width = '100%';
            renderer.domElement.style.height = '100%';
            if (composer) {
              composer.setPixelRatio(savedPixelRatio);
              composer.setSize(savedCssSize.x, savedCssSize.y);
            }
            restorePostSize();
          };

          try {
            // Prefer a single composer render at the requested size: it keeps
            // bloom / tilt-shift / chromatic / pixelate / vignette identical to
            // the viewport while staying below SINGLE_PASS_MAX_PIXELS (~400 MB).
            if (canUseSinglePassExport(targetW, targetH, maxTex, maxRb, Boolean(composer), isSoftwareGl)) {
              renderer.setPixelRatio(1);
              renderer.setSize(targetW, targetH, false);
              composer!.setPixelRatio(1);
              composer!.setSize(targetW, targetH);
              skyMesh.position.copy(activeCamera.position);
              composer!.render();
              await downloadCanvasPng(renderer.domElement, filename);
              return;
            }

            const outCanvas = document.createElement('canvas');
            outCanvas.width = targetW;
            outCanvas.height = targetH;
            const outCtx = outCanvas.getContext('2d');
            if (!outCtx) {
              throw new Error('Could not allocate upscaled export buffer at this resolution.');
            }

            // The canvas is temporarily resized to a single tile; hide it so the
            // user does not see a stretched, flickering frame while the tiles render.
            hiddenCanvas = renderer.domElement;
            savedVisibility = hiddenCanvas.style.visibility;
            hiddenCanvas.style.visibility = 'hidden';

            const tileCap = isSoftwareGl ? 1024 : Math.min(2048, maxTex, maxRb);
            const tiles = computeExportTiles(targetW, targetH, tileCap);

            renderer.setPixelRatio(1);
            for (let i = 0; i < tiles.length; i++) {
              const tile = tiles[i];
              renderer.setSize(tile.width, tile.height, false);
              activeCamera.setViewOffset(targetW, targetH, tile.x, tile.y, tile.width, tile.height);
              skyMesh.position.copy(activeCamera.position);
              // Direct render, deliberately not the composer: the composer's
              // offscreen targets are sized to the viewport, so reusing it per tile
              // would scale/crop the frame. The studio pass is approximated in 2D
              // on the assembled image below instead.
              renderer.render(scene, activeCamera);
              outCtx.drawImage(renderer.domElement, tile.x, tile.y);
              if (i % 4 === 3) {
                await new Promise((r) => window.setTimeout(r, 0));
              }
            }

            // The tile path bypasses the composer, so approximate the studio pass
            // in 2D: the vignette and pixelate below mirror the shader versions
            // (applied in sRGB space rather than linear, so the curve differs very
            // slightly at extreme sizes). Chromatic aberration, bloom, and tilt-shift
            // are skipped here; export at ~16 MP or below (e.g. 4K) to keep them.
            const post = settingsRef.current;
            if (post.vignette > 0.001) {
              const cx = targetW * 0.5;
              const cy = targetH * 0.5;
              const maxR = Math.hypot(cx, cy);
              const grad = outCtx.createRadialGradient(cx, cy, maxR * 0.32, cx, cy, maxR);
              grad.addColorStop(0, 'rgba(0,0,0,0)');
              grad.addColorStop(1, `rgba(0,0,0,${(post.vignette * 0.55).toFixed(3)})`);
              outCtx.fillStyle = grad;
              outCtx.fillRect(0, 0, targetW, targetH);
            }
            if (post.pixelate >= 2) {
              applyPixelate(outCtx, targetW, targetH, post.pixelate);
            }

            await downloadCanvasPng(outCanvas, filename);
          } finally {
            restoreRendererSize();
          }
        } finally {
          markerGroup.visible = savedMarkerVisible;
          hoverBox.visible = savedHoverVisible;
          isExporting = false;
          renderDirty = false;
          drawFrame();
          if (resumeLoopAfterExport && needsContinuousLoop()) {
            isLoopRunning = true;
            lastTime = performance.now();
            if (isSoftwareGl) afterDraw(tick);
            else frameId = requestAnimationFrame(tick);
          }
        }
      };

      /** 2D fallback for the retro pixel filter on tiled exports. */
      function applyPixelate(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number,
        block: number,
      ) {
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.round(w / block));
        small.height = Math.max(1, Math.round(h / block));
        const smallCtx = small.getContext('2d')!;
        smallCtx.imageSmoothingEnabled = true;
        smallCtx.drawImage(ctx.canvas, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
      }

      engineRef.current = {
        applyPreset,
        syncMesh,
        syncSettings,
        syncVoxelLights,
        syncVoxelGrid,
        getDisplayResolution,
        getMaxTextureSize: () => renderer.capabilities.maxTextureSize || 4096,
        exportPng,
        projectVoxelToScreen,
      };

      if (builtMeshRef.current) {
        syncMesh(builtMeshRef.current, true);
        syncVoxelGrid(voxelGridRef.current);
        syncVoxelLights();
      } else {
        syncSettings();
        applyPreset('low', true);
      }

      if (!isSoftwareGl) {
        renderer.compile(scene, activeCamera);
      }

      let lastDevicePixelRatio = window.devicePixelRatio || 1;
      const targetPixelRatio = () =>
        isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);

      const handleResize = () => {
        if (!container) return;
        lastCanvasRect = null;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        const asp = w / Math.max(1, h);

        perspCamera.aspect = asp;
        perspCamera.updateProjectionMatrix();

        const halfH = orthoCamera.top;
        orthoCamera.left = -halfH * asp;
        orthoCamera.right = halfH * asp;
        orthoCamera.updateProjectionMatrix();

        // Moving the window between monitors with different scale factors does
        // not always fire `resize`; recompute the ratio so the canvas stays sharp.
        const dpr = targetPixelRatio();
        if (dpr !== lastDevicePixelRatio) {
          lastDevicePixelRatio = dpr;
          renderer.setPixelRatio(dpr);
          if (composer) composer.setPixelRatio(dpr);
        }

        renderer.setSize(w, h);
        if (composer) composer.setSize(w, h);
        const pixelW = Math.max(1, Math.round(w * dpr));
        const pixelH = Math.max(1, Math.round(h * dpr));
        if (bloomPass) bloomPass.resolution.set(pixelW, pixelH);
        if (studioPass) studioPass.uniforms.uResolution.value.set(pixelW, pixelH);
        requestRender();
      };
      window.addEventListener('resize', handleResize);
      window.addEventListener('orientationchange', handleResize);
      const invalidateCanvasRect = () => {
        lastCanvasRect = null;
      };
      window.addEventListener('scroll', invalidateCanvasRect, true);

      // Some browsers expose DPR changes only through `matchMedia` resolution
      // queries; re-run the resize handler when it flips.
      let dprQuery: MediaQueryList | null = null;
      const watchDevicePixelRatio = () => {
        dprQuery?.removeEventListener('change', onDprChange);
        dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        dprQuery.addEventListener('change', onDprChange);
      };
      const onDprChange = () => {
        handleResize();
        watchDevicePixelRatio();
      };
      watchDevicePixelRatio();

      return () => {
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
        window.removeEventListener('scroll', invalidateCanvasRect, true);
        dprQuery?.removeEventListener('change', onDprChange);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onWindowBlur);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('contextmenu', onContextMenu);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('wheel', onWheel);
        renderer.domElement.removeEventListener('pointerdown', onPickPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPickPointerUp);
        renderer.domElement.removeEventListener('pointermove', onPickPointerMove);
        renderer.domElement.removeEventListener('pointerleave', onPickPointerLeave);
        controls.removeEventListener('start', cancelCamAnim);
        controls.dispose();
        renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

        voxelMesh.geometry.dispose();
        markers.dispose();
        markerGeo.dispose();
        markerMaterial.dispose();
        sharedUniforms.uVoxelLightTexture.value.dispose();
        sharedUniforms.uVoxelShadowTexture.value.dispose();
        hoverBox.geometry.dispose();
        (hoverBox.material as THREE.Material).dispose();
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
        // EffectComposer.dispose() only frees its own render targets; passes own
        // theirs (UnrealBloomPass keeps a full mip chain) and RoomEnvironment owns
        // its geometries/materials.
        outputPass?.dispose();
        bloomPass?.dispose();
        studioPass?.dispose();
        renderPass?.dispose();
        if (composer) composer.dispose();
        roomEnvironment.dispose();
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

    useEffect(() => {
      engineRef.current?.syncVoxelGrid(voxelGrid);
    }, [voxelGrid]);

    useEffect(() => {
      engineRef.current?.syncVoxelLights();
    }, [voxelLights]);

    useEffect(() => {
      // Leaving pick mode clears the hover highlight.
      if (!pickingMode) {
        engineRef.current?.syncVoxelLights();
      }
    }, [pickingMode]);

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
          className={`w-full h-full ${pickingMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
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
