import { AlertCircle, Crosshair, Loader2, Move, Upload, UserPlus, X } from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ControlSidebar } from './components/ControlSidebar';
import { PLAYER_PANEL_GAP, PLAYER_PANEL_W, PlayerModelPanel } from './components/PlayerModelPanel';
import { TopBar } from './components/TopBar';
import {
  computeFloatingPanelCoords,
  VOXEL_LIGHT_PANEL_GAP,
  VOXEL_LIGHT_PANEL_H,
  VOXEL_LIGHT_PANEL_W,
  VoxelLightPanel,
  VoxelScreenPos,
} from './components/VoxelLightPanel';
import { BACKDROP_THEMES } from './renderer/shaders';
import { PrecomputedShadowData, VoxelViewport, VoxelViewportHandle } from './renderer/VoxelViewport';
import { hydrateKv6Grid } from './voxel/kv6Parser';
import { BuiltVoxelMesh, hydrateVoxelGeometry } from './voxel/mesher';
import {
  applySpawnedPlayerPatch,
  createSpawnedPlayerFromPreset,
  duplicateSpawnedPlayer,
  snapPlayerYToGround,
} from './voxel/playerModel';
import {
  MAX_SPAWNED_PLAYERS,
  MAX_VOXEL_LIGHTS,
  MeshStats,
  PlayerSpawnPreset,
  RenderSettings,
  SpawnedPlayer,
  VoxelFormat,
  VoxelGrid,
  VoxelLight,
} from './voxel/types';
import { hydrateVxlGrid } from './voxel/vxlParser';
import type { VoxelWorkerResponse } from './voxel/worker';
import VoxelWorker from './voxel/worker?worker&inline';

const DEFAULT_SETTINGS: RenderSettings = {
  shaderMode: 'atmospheric',
  backdrop: 'alpine',
  customZenithColor: '#2F6FB3',
  customHorizonColor: '#CBE3F5',
  aoStrength: 0.9,
  roughness: 0.55,
  metalness: 0.06,
  outlineStrength: 0,
  sliceAxis: 'none',
  slicePosition: 0.65,
  lightAzimuth: 130,
  lightElevation: 42,
  lightIntensity: 1.3,
  sunColor: BACKDROP_THEMES.alpine.defaultSunHex,
  fogMode: 'ingame',
  fogColor: BACKDROP_THEMES.alpine.fogHex,
  fogSyncSky: true,
  fogDensity: 1.0,
  fogRange: 320,
  heightFog: 0,
  volumetricClouds: false,
  volumetricStrength: 0.85,
  cloudAltitude: 0.34,
  cameraMode: 'orbit',
  cameraFov: 42,
  flySpeed: 85,
  showPedestal: true,
  waterColorOverride: '',
  waveStrength: 0.45,
  autoRotate: false,
  autoRotateSpeed: 1.2,
  orthographic: false,
  exposure: 1.0,
  bloomStrength: 0.03,
  godRays: false,
  godRaysIntensity: 0.65,
  tiltShift: 0,
  vignette: 0.14,
  chromatic: 0,
  pixelate: 0,
};

interface LoadedModel {
  name: string;
  grid: VoxelGrid;
  builtMesh: BuiltVoxelMesh;
  stats: MeshStats;
  precomputedShadow: PrecomputedShadowData;
}

export default function App() {
  const viewportRef = useRef<VoxelViewportHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const loadRequestIdRef = useRef(0);

  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [loadedModel, setLoadedModel] = useState<LoadedModel | null>(null);

  // Miscellaneous: voxel lights (point lights anchored to picked voxels)
  const [voxelLights, setVoxelLights] = useState<VoxelLight[]>([]);
  const [pickingLight, setPickingLight] = useState(false);
  const [shadowWarning, setShadowWarning] = useState<string | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);

  // Miscellaneous: player, zombie & corpse models (.vxl maps only)
  const [spawnedPlayers, setSpawnedPlayers] = useState<SpawnedPlayer[]>([]);
  const [placingPlayerPreset, setPlacingPlayerPreset] = useState<PlayerSpawnPreset | null>(null);
  const placingPlayer = placingPlayerPreset !== null;
  const [movingPlayerId, setMovingPlayerId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  // DOM refs for zero-lag GPU-composited panel anchoring synced to WebGL frames
  const lightPanelRef = useRef<HTMLDivElement | null>(null);
  const lightDotRef = useRef<HTMLDivElement | null>(null);
  const playerPanelRef = useRef<HTMLDivElement | null>(null);
  const selectedLightRef = useRef<VoxelLight | null>(null);
  const selectedPlayerRef = useRef<SpawnedPlayer | null>(null);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;

  const workerCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      workerCancelRef.current?.();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const builtMesh = loadedModel?.builtMesh ?? null;
  const stats = loadedModel?.stats ?? null;

  const updateSettings = useCallback((patch: Partial<RenderSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearVoxelLights = useCallback(() => {
    setVoxelLights([]);
    setSelectedLightId(null);
    setPickingLight(false);
  }, []);

  const clearSpawnedPlayers = useCallback(() => {
    setSpawnedPlayers([]);
    setSelectedPlayerId(null);
    setPlacingPlayerPreset(null);
    setMovingPlayerId(null);
  }, []);

  const handleVoxelPicked = useCallback((x: number, y: number, z: number, normal: [number, number, number]) => {
    setSelectedPlayerId(null);
    setMovingPlayerId(null);
    setPlacingPlayerPreset(null);
    const existing = voxelLights.find((light) => light.x === x && light.y === y && light.z === z);
    if (existing) {
      setSelectedLightId(existing.id);
      setPickingLight(false);
      return;
    }
    if (voxelLights.length >= MAX_VOXEL_LIGHTS) {
      // Without this the pick mode stays armed and clicks silently do nothing.
      setPickingLight(false);
      setErrorMsg(
        `Maximum of ${MAX_VOXEL_LIGHTS} voxel lights reached. Remove one to add another.`,
      );
      return;
    }
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `light-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const newLight: VoxelLight = {
      id,
      x,
      y,
      z,
      normal,
      intensity: 3.5,
      range: 28,
      color: '#FFB35C',
    };
    setVoxelLights((prev) => [...prev, newLight]);
    setSelectedLightId(id);
    setPickingLight(false);
  }, [voxelLights]);

  const updateVoxelLight = useCallback((id: string, patch: Partial<VoxelLight>) => {
    setVoxelLights((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }, []);

  const removeVoxelLight = useCallback((id: string) => {
    setVoxelLights((prev) => prev.filter((l) => l.id !== id));
    setSelectedLightId((prev) => (prev === id ? null : prev));
  }, []);

  const handlePlacePlayer = useCallback(
    (x: number, y: number, z: number) => {
      if (loadedModel?.stats.format !== 'vxl') {
        setPlacingPlayerPreset(null);
        return;
      }
      if (spawnedPlayers.length >= MAX_SPAWNED_PLAYERS) {
        setPlacingPlayerPreset(null);
        setErrorMsg(
          `Maximum of ${MAX_SPAWNED_PLAYERS} player models reached. Remove one to add another.`,
        );
        return;
      }
      const next = createSpawnedPlayerFromPreset(placingPlayerPreset ?? 'player', x, y, z);
      setSpawnedPlayers((prev) => [...prev, next]);
      setSelectedLightId(null);
      setSelectedPlayerId(next.id);
      setPlacingPlayerPreset(null);
    },
    [loadedModel?.stats.format, placingPlayerPreset, spawnedPlayers.length],
  );

  const handleSelectPlayer = useCallback((id: string | null) => {
    if (id !== null) {
      setSelectedLightId(null);
      setPickingLight(false);
    }
    setMovingPlayerId((prev) => (prev && prev !== id ? null : prev));
    setSelectedPlayerId(id);
  }, []);

  const updateSpawnedPlayer = useCallback((id: string, patch: Partial<SpawnedPlayer>) => {
    setSpawnedPlayers((prev) =>
      prev.map((p) => (p.id === id ? applySpawnedPlayerPatch(p, patch) : p)),
    );
  }, []);

  const handleMovePlayer = useCallback((id: string, x: number, y: number, z: number) => {
    setSpawnedPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, x, y, z } : p)));
    setMovingPlayerId(null);
  }, []);

  const handleDuplicatePlayer = useCallback(
    (id: string) => {
      if (loadedModel?.stats.format !== 'vxl') return;
      const source = spawnedPlayers.find((p) => p.id === id);
      if (!source) return;
      const dup = duplicateSpawnedPlayer(source, spawnedPlayers, loadedModel.grid);
      if (!dup) {
        setErrorMsg(
          `Maximum of ${MAX_SPAWNED_PLAYERS} player models reached. Remove one to duplicate.`,
        );
        return;
      }
      setSpawnedPlayers((prev) => [...prev, dup]);
      setSelectedLightId(null);
      setSelectedPlayerId(dup.id);
    },
    [loadedModel, spawnedPlayers],
  );

  const handleSnapPlayerToGround = useCallback(
    (id: string) => {
      const grid = loadedModel?.grid ?? null;
      if (!grid) return;
      setSpawnedPlayers((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, y: snapPlayerYToGround(grid, p.x, p.y, p.z) } : p,
        ),
      );
    },
    [loadedModel?.grid],
  );

  const removeSpawnedPlayer = useCallback((id: string) => {
    setSpawnedPlayers((prev) => prev.filter((p) => p.id !== id));
    setSelectedPlayerId((prev) => (prev === id ? null : prev));
    setMovingPlayerId((prev) => (prev === id ? null : prev));
  }, []);

  const handleFileLoad = useCallback(async (file: File) => {
    setErrorMsg(null);
    const lower = file.name.toLowerCase();

    let format: VoxelFormat | null = null;
    if (lower.endsWith('.kv6')) format = 'kv6';
    else if (lower.endsWith('.vxl')) format = 'vxl';

    if (!format) {
      setErrorMsg(
        `Unsupported file "${file.name}". Please choose an Ace of Spades .vxl map or Voxlap .kv6 model.`,
      );
      return;
    }

    const requestId = ++loadRequestIdRef.current;
    setLoadingFile(file.name);
    let worker: Worker | null = null;

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (loadRequestIdRef.current !== requestId) return;

      // Cancel & terminate any stale in-flight worker so rapid successive drops
      // immediately settle superseded promises without starving CPU cores.
      workerCancelRef.current?.();
      workerCancelRef.current = null;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }

      const activeWorker = new VoxelWorker();
      worker = activeWorker;
      workerRef.current = activeWorker;

      const maxTextureSize = viewportRef.current?.getMaxTextureSize() ?? 4096;

      const response = await new Promise<VoxelWorkerResponse | null>((resolve, reject) => {
        workerCancelRef.current = () => resolve(null);
        activeWorker.onmessage = (e: MessageEvent<VoxelWorkerResponse>) => {
          workerCancelRef.current = null;
          resolve(e.data);
        };
        activeWorker.onerror = (e: ErrorEvent) => {
          workerCancelRef.current = null;
          reject(new Error(e.message || 'Background voxel loader failed.'));
        };
        activeWorker.postMessage(
          { id: requestId, format, buffer: arrayBuffer, maxTextureSize },
          [arrayBuffer],
        );
      });

      if (!response || loadRequestIdRef.current !== requestId) return;

      if (!response.ok) {
        if (response.isParseError) {
          setErrorMsg(response.error);
        } else {
          setErrorMsg(
            `Could not read "${file.name}". Make sure it is a valid uncompressed .kv6 or 512×512×64 Ace of Spades .vxl binary.`,
          );
        }
        return;
      }

      const grid =
        response.grid.format === 'kv6'
          ? hydrateKv6Grid(response.grid)
          : hydrateVxlGrid(response.grid);
      const built = hydrateVoxelGeometry(response.mesh);
      const baseName = file.name.replace(/\.(kv6|vxl)$/i, '');

      if (grid.format === 'kv6') {
        setSettings((prev) => ({
          ...prev,
          backdrop: 'custom',
          customZenithColor: '#000000',
          customHorizonColor: '#000000',
        }));
      }

      setLoadedModel({
        name: baseName,
        grid,
        builtMesh: built,
        precomputedShadow: {
          atlas: response.shadowAtlas,
          error: response.shadowError,
        },
        stats: {
          name: baseName,
          format: grid.format,
          width: grid.width,
          height: grid.height,
          depth: grid.depth,
          voxelCount: grid.voxelCount,
          quadCount: built.quadCount,
          triangleCount: built.triangleCount,
          waterColorHex: built.waterColorHex,
          parseMs: response.parseMs,
          meshMs: response.meshMs,
        },
      });
      setSettings((prev) => ({ ...prev, waterColorOverride: '' }));
      clearVoxelLights();
      clearSpawnedPlayers();
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return;
      setErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : `Could not read "${file.name}". Make sure it is a valid uncompressed .kv6 or 512×512×64 Ace of Spades .vxl binary.`,
      );
    } finally {
      if (worker) {
        worker.terminate();
        if (workerRef.current === worker) {
          workerRef.current = null;
          workerCancelRef.current = null;
        }
      }
      if (loadRequestIdRef.current === requestId) {
        setLoadingFile(null);
      }
    }
  }, [clearVoxelLights, clearSpawnedPlayers]);

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFileLoad(file);
      e.target.value = '';
    },
    [handleFileLoad],
  );

  // Keyboard shortcuts: 'H' toggles sidebar / Zen View, 'F' toggles Free Cam,
  // 'Esc' cancels voxel picking / closes the floating light panel.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setSidebarCollapsed((prev) => !prev);
      } else if (e.key === 'f' || e.key === 'F') {
        setSettings((prev) => ({
          ...prev,
          cameraMode: prev.cameraMode === 'orbit' ? 'free' : 'orbit',
        }));
      } else if (e.key === 'Escape') {
        setPickingLight((prev) => (prev ? false : prev));
        setSelectedLightId((prev) => (prev ? null : prev));
        setPlacingPlayerPreset((prev) => (prev ? null : prev));
        setMovingPlayerId((prev) => (prev ? null : prev));
        setSelectedPlayerId((prev) => (prev ? null : prev));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectedLight = useMemo(
    () => voxelLights.find((l) => l.id === selectedLightId) ?? null,
    [voxelLights, selectedLightId],
  );
  selectedLightRef.current = selectedLight;

  const selectedPlayer = useMemo(
    () => spawnedPlayers.find((p) => p.id === selectedPlayerId) ?? null,
    [spawnedPlayers, selectedPlayerId],
  );
  selectedPlayerRef.current = selectedPlayer;

  const hiddenScreenPos: VoxelScreenPos = useMemo(
    () => ({ x: 0, y: 0, visible: false }),
    [],
  );

  const lightPanelSizeRef = useRef<{ w: number; h: number } | null>(null);
  const playerPanelSizeRef = useRef<{ w: number; h: number } | null>(null);

  const measureFloatingPanels = useCallback(() => {
    const lightEl = lightPanelRef.current;
    if (lightEl) {
      lightPanelSizeRef.current = {
        w: lightEl.offsetWidth || VOXEL_LIGHT_PANEL_W,
        h: lightEl.offsetHeight || VOXEL_LIGHT_PANEL_H,
      };
    } else {
      lightPanelSizeRef.current = null;
    }

    const playerEl = playerPanelRef.current;
    if (playerEl) {
      const p = selectedPlayerRef.current;
      const fallbackH =
        p && p.characterType !== 'zombie' && p.stance !== 'corpse' && p.weapon === 'block'
          ? 500
          : 454;
      playerPanelSizeRef.current = {
        w: playerEl.offsetWidth || PLAYER_PANEL_W,
        h: playerEl.offsetHeight || fallbackH,
      };
    } else {
      playerPanelSizeRef.current = null;
    }
  }, []);

  // Directly update floating panel & dot transforms on the DOM inside every WebGL
  // frame callback so orbiting, panning, and Free Cam flight track at full 60/120Hz
  // without React re-render stepping or 50ms polling lag.
  const syncFloatingAnchors = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rightMargin = !sidebarCollapsedRef.current && vw >= 640 ? 328 : 12;

    const light = selectedLightRef.current;
    const lightPanelEl = lightPanelRef.current;
    const lightDotEl = lightDotRef.current;
    if (light && (lightPanelEl || lightDotEl)) {
      const pos = vp.projectVoxelToScreen(light.x, light.y, light.z);
      if (lightDotEl) {
        lightDotEl.style.visibility = pos.visible ? 'visible' : 'hidden';
        if (pos.visible) {
          lightDotEl.style.transform = `translate3d(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px, 0) translate(-50%, -50%)`;
        }
      }
      if (lightPanelEl) {
        lightPanelEl.style.visibility = pos.visible ? 'visible' : 'hidden';
        if (pos.visible) {
          const panelW = lightPanelSizeRef.current?.w ?? VOXEL_LIGHT_PANEL_W;
          const panelH = lightPanelSizeRef.current?.h ?? VOXEL_LIGHT_PANEL_H;
          const { left, top } = computeFloatingPanelCoords(
            pos.x,
            pos.y,
            panelW,
            panelH,
            VOXEL_LIGHT_PANEL_GAP,
            vw,
            vh,
            rightMargin,
          );
          lightPanelEl.style.transform = `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0)`;
        }
      }
    }

    const player = selectedPlayerRef.current;
    const playerPanelEl = playerPanelRef.current;
    if (player && playerPanelEl) {
      const anchorOffset =
        player.stance === 'corpse'
          ? 0.35
          : player.stance === 'crouched'
            ? 1.1
            : 1.7;
      const anchorY = player.y + anchorOffset;
      const pos = vp.projectWorldToScreen(player.x, anchorY, player.z);
      playerPanelEl.style.visibility = pos.visible ? 'visible' : 'hidden';
      if (pos.visible) {
        const fallbackH =
          player.characterType !== 'zombie' &&
          player.stance !== 'corpse' &&
          player.weapon === 'block'
            ? 500
            : 454;
        const panelW = playerPanelSizeRef.current?.w ?? PLAYER_PANEL_W;
        const panelH = playerPanelSizeRef.current?.h ?? fallbackH;
        const { left, top } = computeFloatingPanelCoords(
          pos.x,
          pos.y,
          panelW,
          panelH,
          PLAYER_PANEL_GAP,
          vw,
          vh,
          rightMargin,
        );
        playerPanelEl.style.transform = `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0)`;
      }
    }
  }, []);

  useLayoutEffect(() => {
    measureFloatingPanels();
    syncFloatingAnchors();
  }, [
    selectedLightId,
    selectedLight?.x,
    selectedLight?.y,
    selectedLight?.z,
    selectedPlayerId,
    selectedPlayer?.x,
    selectedPlayer?.y,
    selectedPlayer?.z,
    selectedPlayer?.characterType,
    selectedPlayer?.stance,
    selectedPlayer?.weapon,
    selectedPlayer?.flashlight.enabled,
    sidebarCollapsed,
    measureFloatingPanels,
    syncFloatingAnchors,
  ]);

  useEffect(() => {
    const onResize = () => {
      measureFloatingPanels();
      syncFloatingAnchors();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureFloatingPanels, syncFloatingAnchors]);

  return (
    <main
      className="relative w-screen h-screen overflow-hidden select-none"
      data-shader={settings.shaderMode}
      data-fog-mode={settings.fogMode}
      data-clouds={settings.volumetricClouds ? 'on' : 'off'}
      data-camera-mode={settings.cameraMode}
      data-model={loadedModel ? loadedModel.name : 'empty'}
    >
      {/* Hidden native file picker for .vxl and .kv6 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".kv6,.vxl"
        className="hidden"
        onChange={onFileInputChange}
        aria-label="Upload .kv6 or .vxl voxel file"
      />

      {/* Full-bleed 3D Studio Viewport */}
      <VoxelViewport
        ref={viewportRef}
        builtMesh={builtMesh}
        voxelGrid={loadedModel?.grid ?? null}
        precomputedShadow={loadedModel?.precomputedShadow ?? null}
        onShadowWarning={setShadowWarning}
        settings={settings}
        onFileDrop={(f) => void handleFileLoad(f)}
        onAdjustFlySpeed={(flySpeed) => updateSettings({ flySpeed })}
        onDisableAutoRotate={() => updateSettings({ autoRotate: false })}
        voxelLights={voxelLights}
        pickingMode={pickingLight}
        onVoxelPicked={handleVoxelPicked}
        spawnedPlayers={spawnedPlayers}
        selectedPlayerId={selectedPlayerId}
        placingPlayer={placingPlayer}
        movingPlayerId={movingPlayerId}
        onPlacePlayer={handlePlacePlayer}
        onMovePlayer={handleMovePlayer}
        onSelectPlayer={handleSelectPlayer}
        onFrameRendered={syncFloatingAnchors}
      />

      {/* Minimal Top HUD */}
      <TopBar
        stats={stats}
        sidebarCollapsed={sidebarCollapsed}
        cameraMode={settings.cameraMode}
        onOpenFile={() => fileInputRef.current?.click()}
        onResetCamera={() => viewportRef.current?.applyCameraPreset('iso')}
        onToggleCameraMode={() =>
          updateSettings({
            cameraMode: settings.cameraMode === 'orbit' ? 'free' : 'orbit',
          })
        }
        getDisplayResolution={() =>
          viewportRef.current?.getDisplayResolution() ?? {
            width: window.innerWidth,
            height: window.innerHeight,
          }
        }
        isKv6={loadedModel?.stats.format === 'kv6'}
        onExportGif={async () => {
          if (!loadedModel || !viewportRef.current) return;
          try {
            await viewportRef.current.exportGif(
              `${loadedModel.name.toLowerCase().replace(/\s+/g, '-')}-${settings.shaderMode}-turntable.gif`,
            );
          } catch (err) {
            setErrorMsg(
              err instanceof Error ? err.message : 'GIF export failed.',
            );
          }
        }}
        onExportPng={async (targetWidth?: number) => {
          if (!loadedModel || !viewportRef.current) return;
          const suffix = targetWidth ? `-${targetWidth}w` : '';
          try {
            await viewportRef.current.exportPng(
              `${loadedModel.name.toLowerCase().replace(/\s+/g, '-')}-${settings.shaderMode}${suffix}.png`,
              targetWidth,
            );
          } catch (err) {
            setErrorMsg(
              err instanceof Error
                ? err.message
                : 'PNG export failed at this resolution.',
            );
          }
        }}
        onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
      />

      {/* Minimal 1-line Free Cam Navigation Hint */}
      {settings.cameraMode === 'free' && !sidebarCollapsed && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-10 px-2.5 py-1.5 rounded-md border text-[11px] font-medium shadow-sm bg-[#14171D]/90 text-[#C6CDD9] border-white/10">
          Drag look · WASD fly · E/Q up/down · Shift boost · Scroll speed · F exit
        </div>
      )}

      {/* Voxel-light picking banner */}
      {pickingLight && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-[#E05A2B]/40 bg-[#14171D]/94 text-[#F3F1EC] shadow-xl">
          <Crosshair className="w-4 h-4 text-[#E05A2B] shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium whitespace-nowrap">
            Click a voxel to make it a light source
          </span>
          <button
            type="button"
            onClick={() => setPickingLight(false)}
            className="px-2 py-1 rounded border border-white/15 text-[11px] font-medium text-[#C6CDD9] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* Floating voxel-light controls, anchored next to the selected voxel */}
      {selectedLight && (
        <VoxelLightPanel
          light={selectedLight}
          initialScreenPos={hiddenScreenPos}
          panelRef={lightPanelRef}
          dotRef={lightDotRef}
          onUpdate={updateVoxelLight}
          onRemove={removeVoxelLight}
          onClose={() => setSelectedLightId(null)}
        />
      )}

      {/* Player-model placement / relocation banner */}
      {placingPlayerPreset && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-[#E05A2B]/40 bg-[#14171D]/94 text-[#F3F1EC] shadow-xl">
          <UserPlus className="w-4 h-4 text-[#E05A2B] shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium whitespace-nowrap">
            {placingPlayerPreset === 'zombie'
              ? 'Click on the map to spawn a zombie (holding spade)'
              : placingPlayerPreset === 'player_corpse'
                ? 'Click on the map to spawn a player corpse'
                : placingPlayerPreset === 'zombie_corpse'
                  ? 'Click on the map to spawn a zombie corpse'
                  : 'Click on the map to spawn a player model'}
          </span>
          <button
            type="button"
            onClick={() => setPlacingPlayerPreset(null)}
            className="px-2 py-1 rounded border border-white/15 text-[11px] font-medium text-[#C6CDD9] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {movingPlayerId && !placingPlayer && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-[#E05A2B]/40 bg-[#14171D]/94 text-[#F3F1EC] shadow-xl">
          <Move className="w-4 h-4 text-[#E05A2B] shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium whitespace-nowrap">
            Click anywhere on the map to move the selected model
          </span>
          <button
            type="button"
            onClick={() => setMovingPlayerId(null)}
            className="px-2 py-1 rounded border border-white/15 text-[11px] font-medium text-[#C6CDD9] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* Floating player-model controls, anchored next to the selected player */}
      {selectedPlayer && (
        <PlayerModelPanel
          player={selectedPlayer}
          initialScreenPos={hiddenScreenPos}
          panelRef={playerPanelRef}
          isMovingOnMap={movingPlayerId === selectedPlayer.id}
          canDuplicate={spawnedPlayers.length < MAX_SPAWNED_PLAYERS}
          onUpdate={updateSpawnedPlayer}
          onDuplicate={handleDuplicatePlayer}
          onToggleMoveOnMap={(id) => {
            setPlacingPlayerPreset(null);
            setPickingLight(false);
            setMovingPlayerId((prev) => (prev === id ? null : id));
          }}
          onSnapToGround={handleSnapPlayerToGround}
          onRemove={removeSpawnedPlayer}
          onClose={() => {
            setSelectedPlayerId(null);
            setMovingPlayerId(null);
          }}
        />
      )}

      {/* Clean Minimal Empty Stage Prompt (when no file is imported yet) */}
      {!loadedModel && !loadingFile && (
        <div
          className={`pointer-events-none fixed inset-0 z-10 flex items-center justify-center p-4 transition-all duration-200 ${
            sidebarCollapsed ? '' : 'sm:pr-[316px]'
          }`}
        >
          <div className="pointer-events-auto max-w-sm w-full px-6 py-5 rounded-lg border shadow-lg text-center bg-[#14171D]/92 text-[#F3F1EC] border-white/10">
            <p className="font-display text-base font-semibold tracking-tight">
              Import a Map or Model
            </p>
            <p className="text-xs mt-1.5 leading-relaxed text-[#9CA4B3]">
              Drop an Ace of Spades <span className="font-mono-tabular">.vxl</span> map or Voxlap{' '}
              <span className="font-mono-tabular">.kv6</span> file anywhere on the canvas.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-[#E05A2B] text-white hover:bg-[#C94D22] transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Choose .vxl / .kv6 File</span>
            </button>
          </div>
        </div>
      )}

      {/* Non-blocking Background Worker Loading Indicator */}
      {loadingFile && (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed inset-0 z-20 flex items-center justify-center p-4 transition-all duration-200 ${
            sidebarCollapsed ? '' : 'sm:pr-[316px]'
          }`}
        >
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-white/12 bg-[#14171D]/95 text-[#F3F1EC] shadow-xl">
            <Loader2 className="w-4 h-4 text-[#E05A2B] animate-spin shrink-0" aria-hidden="true" />
            <span className="text-xs font-medium">
              Parsing &amp; meshing <span className="font-mono-tabular">{loadingFile}</span>...
            </span>
          </div>
        </div>
      )}

      {/* Inline File Parse Error Toast */}
      {errorMsg && (
        <div
          role="alert"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-red-400/30 bg-[#231416] text-red-100 text-xs shadow-lg max-w-md"
        >
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
          <span className="flex-1 leading-relaxed">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            aria-label="Dismiss error"
            className="p-1 rounded hover:bg-white/10 text-red-200 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Minimal Collapsible Right Sidebar */}
      <ControlSidebar
        settings={settings}
        stats={stats}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        onUpdateSettings={updateSettings}
        onResetDefaults={() => {
          setSettings(DEFAULT_SETTINGS);
          clearVoxelLights();
          clearSpawnedPlayers();
        }}
        voxelLights={voxelLights}
        shadowWarning={shadowWarning}
        pickingLight={pickingLight}
        selectedLightId={selectedLightId}
        onStartPickLight={() => {
          setSelectedLightId(null);
          setSelectedPlayerId(null);
          setPlacingPlayerPreset(null);
          setMovingPlayerId(null);
          setPickingLight(true);
        }}
        onSelectLight={(id) => {
          if (id !== null) setSelectedPlayerId(null);
          setSelectedLightId(id);
        }}
        onRemoveLight={removeVoxelLight}
        onClearLights={clearVoxelLights}
        spawnedPlayers={spawnedPlayers}
        placingPlayerPreset={placingPlayerPreset}
        selectedPlayerId={selectedPlayerId}
        onStartPlacePlayer={(preset) => {
          setPickingLight(false);
          setSelectedLightId(null);
          setSelectedPlayerId(null);
          setMovingPlayerId(null);
          setPlacingPlayerPreset((prev) => (prev === preset ? null : preset));
        }}
        onSelectPlayer={handleSelectPlayer}
        onDuplicatePlayer={handleDuplicatePlayer}
        onRemovePlayer={removeSpawnedPlayer}
        onClearPlayers={clearSpawnedPlayers}
      />
    </main>
  );
}
