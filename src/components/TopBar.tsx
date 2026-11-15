import {
  Camera,
  ChevronDown,
  FolderOpen,
  Navigation,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  computeUpscaledDimensions,
  getMaxExportWidth,
} from '../voxel/exportResolution';
import { CameraMode, MeshStats } from '../voxel/types';

interface TopBarProps {
  stats: MeshStats | null;
  sidebarCollapsed: boolean;
  cameraMode: CameraMode;
  onOpenFile: () => void;
  onResetCamera: () => void;
  onToggleCameraMode: () => void;
  getDisplayResolution: () => { width: number; height: number };
  onExportPng: (targetWidth?: number) => Promise<void>;
  onToggleSidebar: () => void;
}

export function TopBar({
  stats,
  sidebarCollapsed,
  cameraMode,
  onOpenFile,
  onResetCamera,
  onToggleCameraMode,
  getDisplayResolution,
  onExportPng,
  onToggleSidebar,
}: TopBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [baseRes, setBaseRes] = useState<{ width: number; height: number }>({
    width: 1440,
    height: 900,
  });
  const [upscaleWidth, setUpscaleWidth] = useState<number>(3840);
  const [isEditingRes, setIsEditingRes] = useState(false);
  const [customInputVal, setCustomInputVal] = useState('');
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const surfaceClass = 'bg-[#14171D]/92 text-[#F3F1EC] border-white/10';
  const btnHoverClass = 'hover:bg-white/8 text-[#E8E6E0]';

  useEffect(() => {
    if (!exportOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExportOpen(false);
        setIsEditingRes(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExportOpen(false);
        setIsEditingRes(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [exportOpen]);

  const openOrToggleExportMenu = () => {
    if (!exportOpen) {
      const current = getDisplayResolution();
      setBaseRes(current);
      const maxW = getMaxExportWidth(current.width, current.height);
      setUpscaleWidth((prev) =>
        Math.min(maxW, Math.max(current.width, prev || Math.min(maxW, current.width * 2))),
      );
      setIsEditingRes(false);
    }
    setExportOpen((prev) => !prev);
  };

  const maxExportWidth = getMaxExportWidth(baseRes.width, baseRes.height);
  const minSliderVal = Math.min(baseRes.width, upscaleWidth);
  const clampedSliderVal = Math.min(maxExportWidth, Math.max(minSliderVal, upscaleWidth));
  const upscaledDims = computeUpscaledDimensions(
    baseRes.width,
    baseRes.height,
    clampedSliderVal,
  );
  const sliderPct =
    maxExportWidth > minSliderVal
      ? ((clampedSliderVal - minSliderVal) / (maxExportWidth - minSliderVal)) * 100
      : 100;

  const triggerExport = async (targetWidth?: number) => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await onExportPng(targetWidth);
      setExportOpen(false);
    } finally {
      setIsExporting(false);
    }
  };

  const commitCustomRes = () => {
    setIsEditingRes(false);
    const trimmed = customInputVal.trim().toLowerCase();
    let targetW = 0;
    if (trimmed === '4k') targetW = 3840;
    else if (trimmed === '8k') targetW = 7680;
    else if (trimmed === '16k') targetW = 15360;
    else {
      const match = trimmed.match(/(\d+)/);
      if (match) targetW = parseInt(match[1], 10);
    }
    if (targetW > 0) {
      setUpscaleWidth(Math.min(maxExportWidth, Math.max(64, targetW)));
    }
  };

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

            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={openOrToggleExportMenu}
                aria-expanded={exportOpen}
                aria-haspopup="menu"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[#E05A2B] text-white hover:bg-[#C94D22] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Export PNG options"
              >
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Export PNG</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${exportOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              {exportOpen && (
                <div
                  role="menu"
                  aria-label="Export PNG Options"
                  className="absolute right-0 top-full mt-2 w-72 p-2 rounded-lg border border-white/12 bg-[#14171D]/96 text-[#F3F1EC] shadow-2xl space-y-2 z-30"
                >
                  {/* Export PNG: subtle dark button without icons, name on left, resolution on right */}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isExporting}
                    onClick={() => void triggerExport()}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-left transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <span className="text-xs font-semibold text-[#F3F1EC]">Export PNG</span>
                    <span className="font-mono-tabular text-[10px] text-[#8F98A6]">
                      {baseRes.width}×{baseRes.height}
                    </span>
                  </button>

                  {/* Export Upscaled: looks just like Export PNG button with integrated slider & editable resolution */}
                  <div className="w-full rounded-md border border-white/10 bg-white/5 p-2.5 space-y-2">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={isExporting}
                      onClick={() => void triggerExport(upscaledDims.width)}
                      className="w-full flex items-center justify-between text-left transition-colors cursor-pointer disabled:opacity-50 group"
                    >
                      <span className="text-xs font-semibold text-[#F3F1EC] group-hover:text-[#E05A2B] transition-colors">
                        {isExporting ? 'Exporting...' : 'Export Upscaled'}
                      </span>
                    </button>

                    <div className="flex items-center gap-2">
                      <input
                        id="export-upscale-slider"
                        type="range"
                        min={minSliderVal}
                        max={maxExportWidth}
                        step={16}
                        value={clampedSliderVal}
                        onChange={(e) => setUpscaleWidth(parseInt(e.target.value, 10))}
                        style={{
                          background: `linear-gradient(to right, #E05A2B ${sliderPct}%, rgba(255,255,255,0.15) ${sliderPct}%)`,
                        }}
                        className="studio-slider flex-1 min-w-0"
                        aria-label="Upscale resolution slider"
                      />
                      {isEditingRes ? (
                        <input
                          ref={customInputRef}
                          type="text"
                          value={customInputVal}
                          onChange={(e) => setCustomInputVal(e.target.value)}
                          onBlur={commitCustomRes}
                          onKeyDown={(e) => {
                            // The window-level Escape handler would close the whole
                            // export menu while the user is only cancelling the edit.
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setIsEditingRes(false);
                            } else if (e.key === 'Enter') {
                              commitCustomRes();
                            }
                          }}
                          className="w-22 px-1 py-0.5 text-right font-mono-tabular text-[10px] bg-black/60 border border-[#E05A2B] rounded text-white focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomInputVal(`${upscaledDims.width}×${upscaledDims.height}`);
                            setIsEditingRes(true);
                          }}
                          title="Click to type custom resolution"
                          className="font-mono-tabular text-[10px] text-[#A6AEBC] hover:text-white cursor-text shrink-0 text-right px-1 py-0.5 rounded hover:bg-white/10 transition-colors"
                        >
                          {upscaledDims.width}×{upscaledDims.height}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
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
