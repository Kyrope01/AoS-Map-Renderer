import {
  Camera,
  FolderOpen,
  Navigation,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
} from 'lucide-react';
import { CameraMode, MeshStats } from '../voxel/types';

interface TopBarProps {
  stats: MeshStats | null;
  sidebarCollapsed: boolean;
  cameraMode: CameraMode;
  onOpenFile: () => void;
  onResetCamera: () => void;
  onToggleCameraMode: () => void;
  onExportPng: () => void;
  onToggleSidebar: () => void;
}

export function TopBar({
  stats,
  sidebarCollapsed,
  cameraMode,
  onOpenFile,
  onResetCamera,
  onToggleCameraMode,
  onExportPng,
  onToggleSidebar,
}: TopBarProps) {
  const surfaceClass = 'bg-[#14171D]/92 text-[#F3F1EC] border-white/10';
  const btnHoverClass = 'hover:bg-white/8 text-[#E8E6E0]';

  return (
    <header
      className={`pointer-events-none fixed top-3 left-3 z-20 flex items-center justify-end gap-2 transition-all duration-200 ${
        sidebarCollapsed ? 'right-3' : 'right-3 sm:right-[324px]'
      }`}
    >
      {/* Compact Action Strip */}
      <div
        className={`pointer-events-auto flex items-center gap-1 p-1 rounded-lg border shadow-sm shrink-0 ${surfaceClass}`}
      >
        <button
          type="button"
          onClick={onOpenFile}
          aria-label="Open File"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${btnHoverClass}`}
          title="Import .vxl map or .kv6 model"
        >
          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Import</span>
        </button>

        <button
          type="button"
          onClick={onToggleCameraMode}
          aria-pressed={cameraMode === 'free'}
          aria-label="Free Cam"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            cameraMode === 'free'
              ? 'bg-[#E05A2B] text-white'
              : btnHoverClass
          }`}
          title="Toggle Free Cam (F) — Drag to look, WASD to fly"
        >
          <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Free Cam</span>
        </button>

        {stats && (
          <>
            <button
              type="button"
              onClick={onResetCamera}
              aria-label="Reset View"
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${btnHoverClass}`}
              title="Reset camera framing"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Reset</span>
            </button>

            <button
              type="button"
              onClick={onExportPng}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[#E05A2B] text-white hover:bg-[#C94D22] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Render and download PNG"
            >
              <Camera className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Export PNG</span>
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show Controls' : 'Hide Controls'}
          aria-expanded={!sidebarCollapsed}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${btnHoverClass}`}
          title="Toggle sidebar (H)"
        >
          {sidebarCollapsed ? (
            <PanelRightOpen className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <PanelRightClose className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
