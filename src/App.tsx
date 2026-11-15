import { AlertCircle, Upload, X } from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlSidebar } from './components/ControlSidebar';
import { TopBar } from './components/TopBar';
import { BACKDROP_THEMES } from './renderer/shaders';
import { VoxelViewport, VoxelViewportHandle } from './renderer/VoxelViewport';
import { parseKv6 } from './voxel/kv6Parser';
import { buildVoxelGeometry, BuiltVoxelMesh } from './voxel/mesher';
import {
  MeshStats,
  RenderSettings,
  VoxelFormat,
  VoxelGrid,
  VoxelParseError,
} from './voxel/types';
import { parseVxl } from './voxel/vxlParser';

const DEFAULT_SETTINGS: RenderSettings = {
  shaderMode: 'atmospheric',
  backdrop: 'alpine',
  customSkyName: 'Custom Sky',
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
  heightFog: 0.2,
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
  orthographic: false,
  exposure: 1.0,
  bloomStrength: 0.03,
  tiltShift: 0,
  vignette: 0.14,
  chromatic: 0,
  pixelate: 0,
};

interface LoadedModel {
  name: string;
  grid: VoxelGrid;
  parseMs: number;
}

export default function App() {
  const viewportRef = useRef<VoxelViewportHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadedModel, setLoadedModel] = useState<LoadedModel | null>(null);

  const { builtMesh, stats } = useMemo<{
    builtMesh: BuiltVoxelMesh | null;
    stats: MeshStats | null;
  }>(() => {
    if (!loadedModel) {
      return { builtMesh: null, stats: null };
    }

    const { grid, name, parseMs } = loadedModel;
    const t0 = performance.now();
    const built = buildVoxelGeometry(grid);
    const meshMs = performance.now() - t0;

    return {
      builtMesh: built,
      stats: {
        name,
        format: grid.format,
        width: grid.width,
        height: grid.height,
        depth: grid.depth,
        voxelCount: grid.voxelCount,
        quadCount: built.quadCount,
        triangleCount: built.triangleCount,
        waterColorHex: built.waterColorHex,
        parseMs,
        meshMs,
      },
    };
  }, [loadedModel]);

  const updateSettings = useCallback((patch: Partial<RenderSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
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

    try {
      const arrayBuffer = await file.arrayBuffer();
      const t0 = performance.now();
      const grid = format === 'kv6' ? parseKv6(arrayBuffer) : parseVxl(arrayBuffer);
      const parseMs = performance.now() - t0;
      const baseName = file.name.replace(/\.(kv6|vxl)$/i, '');
      setLoadedModel({
        name: baseName,
        grid,
        parseMs,
      });
      setSettings((prev) => ({ ...prev, waterColorOverride: '' }));
    } catch (err) {
      if (err instanceof VoxelParseError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(
          `Could not read "${file.name}". Make sure it is a valid uncompressed .kv6 or 512×512×64 Ace of Spades .vxl binary.`,
        );
      }
    }
  }, []);

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFileLoad(file);
      e.target.value = '';
    },
    [handleFileLoad],
  );

  // Keyboard shortcuts: 'H' toggles sidebar / Zen View, 'F' toggles Free Cam
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
        settings={settings}
        onFileDrop={(f) => void handleFileLoad(f)}
        onAdjustFlySpeed={(flySpeed) => updateSettings({ flySpeed })}
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

      {/* Clean Minimal Empty Stage Prompt (when no file is imported yet) */}
      {!loadedModel && (
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
        onResetDefaults={() => setSettings(DEFAULT_SETTINGS)}
      />
    </main>
  );
}
