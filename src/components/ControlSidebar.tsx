import {
  Camera,
  CloudSun,
  Copy,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { BACKDROP_THEMES, SHADER_CATEGORIES, SHADER_PRESETS } from '../renderer/shaders';
import {
  BackdropPreset,
  FogMode,
  MAX_SPAWNED_PLAYERS,
  MAX_VOXEL_LIGHTS,
  MeshStats,
  PlayerSpawnPreset,
  RenderSettings,
  SliceAxis,
  SpawnedPlayer,
  VoxelLight,
} from '../voxel/types';

type SidebarTab = 'effects' | 'shaders' | 'material' | 'atmosphere' | 'camera' | 'turntable';

interface ControlSidebarProps {
  settings: RenderSettings;
  stats: MeshStats | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onUpdateSettings: (patch: Partial<RenderSettings>) => void;
  onResetDefaults: () => void;
  voxelLights: VoxelLight[];
  shadowWarning: string | null;
  pickingLight: boolean;
  selectedLightId: string | null;
  onStartPickLight: () => void;
  onSelectLight: (id: string | null) => void;
  onRemoveLight: (id: string) => void;
  onClearLights: () => void;
  spawnedPlayers: SpawnedPlayer[];
  placingPlayerPreset: PlayerSpawnPreset | null;
  selectedPlayerId: string | null;
  onStartPlacePlayer: (preset: PlayerSpawnPreset) => void;
  onSelectPlayer: (id: string | null) => void;
  onDuplicatePlayer: (id: string) => void;
  onRemovePlayer: (id: string) => void;
  onClearPlayers: () => void;
}

const SUN_SWATCHES = [
  { label: 'Daylight', hex: '#FFF6E8' },
  { label: 'Golden', hex: '#FFC684' },
  { label: 'Sunset', hex: '#FF9068' },
  { label: 'Overcast', hex: '#DCEBFF' },
  { label: 'Moonlight', hex: '#B5D2FF' },
];

const FOG_MODES: { id: FogMode; label: string }[] = [
  { id: 'ingame', label: 'In-Game AoS' },
  { id: 'atmospheric', label: 'Atmospheric' },
];

interface SliderControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (val: number) => void;
}

function SliderControl({
  id,
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: SliderControlProps) {
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  const trackBg = `linear-gradient(to right, #E05A2B ${pct}%, rgba(255,255,255,0.15) ${pct}%)`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <label
          htmlFor={id}
          className="font-medium whitespace-nowrap text-[#B8C0CC]"
        >
          {label}
        </label>
        <span className="font-mono-tabular text-[#8992A2]">
          {displayValue}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ background: trackBg }}
        className="studio-slider w-full"
      />
    </div>
  );
}

const ZENITH_PALETTE = [
  { name: 'Alpine Blue', hex: '#2F6FB3' },
  { name: 'Deep Azure', hex: '#0284C7' },
  { name: 'Nordic Indigo', hex: '#6E8EB0' },
  { name: 'Twilight Navy', hex: '#0F172A' },
  { name: 'Sunset Violet', hex: '#3B5680' },
  { name: 'Crimson Sky', hex: '#212645' },
  { name: 'Warm Cream', hex: '#F3EFE8' },
  { name: 'Pitch Black', hex: '#000000' },
];

const HORIZON_PALETTE = [
  { name: 'Alpine Mist', hex: '#CBE3F5' },
  { name: 'Nordic Frost', hex: '#CEDAE4' },
  { name: 'Golden Amber', hex: '#F2BC8D' },
  { name: 'Sunset Crimson', hex: '#C9837D' },
  { name: 'Moonlit Steel', hex: '#1C293D' },
  { name: 'Rose Quartz', hex: '#E2B4BD' },
  { name: 'Warm Paper', hex: '#E7E1D6' },
  { name: 'Pitch Black', hex: '#000000' },
];

function hexToHsl(hex: string) {
  try {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    return hsl;
  } catch {
    return { h: 0.58, s: 0.6, l: 0.45 };
  }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = new THREE.Color();
  c.setHSL(
    THREE.MathUtils.clamp(h, 0, 1),
    THREE.MathUtils.clamp(s, 0, 1),
    THREE.MathUtils.clamp(l, 0, 1),
  );
  return '#' + c.getHexString().toUpperCase();
}

interface InlineColorPickerProps {
  id: string;
  label: string;
  subLabel?: string;
  value: string;
  presetPalette: { name: string; hex: string }[];
  onChange: (hex: string) => void;
}

function InlineColorPicker({
  id,
  label,
  subLabel,
  value,
  presetPalette,
  onChange,
}: InlineColorPickerProps) {
  const [hexInput, setHexInput] = useState(value);
  const [isEditingHex, setIsEditingHex] = useState(false);

  useEffect(() => {
    if (!isEditingHex) {
      setHexInput(value.toUpperCase());
    }
  }, [value, isEditingHex]);

  const hsl = hexToHsl(value);
  const hueDeg = Math.round(hsl.h * 360);
  const lightnessPct = Math.round(hsl.l * 100);

  const onHueChange = (newDeg: number) => {
    const newH = newDeg / 360;
    const s = hsl.s < 0.12 ? 0.75 : hsl.s;
    const l = hsl.l < 0.08 || hsl.l > 0.95 ? 0.5 : hsl.l;
    const nextHex = hslToHex(newH, s, l);
    onChange(nextHex);
  };

  const onLightnessChange = (newPct: number) => {
    const newL = newPct / 100;
    const nextHex = hslToHex(hsl.h, hsl.s, newL);
    onChange(nextHex);
  };

  const commitHex = (text: string) => {
    const trimmed = text.trim();
    const clean = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(clean)) {
      onChange(clean.toUpperCase());
      setHexInput(clean.toUpperCase());
    } else {
      setHexInput(value.toUpperCase());
    }
    setIsEditingHex(false);
  };

  const lightnessTrack = `linear-gradient(to right, #000000 0%, ${hslToHex(
    hsl.h,
    Math.max(0.65, hsl.s),
    0.5,
  )} 50%, #FFFFFF 100%)`;
  const hueTrack =
    'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';

  return (
    <div className="p-2.5 rounded-md border border-white/8 bg-[#101318]/80 space-y-2">
      {/* Header: Label + Swatch & Hex input */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <label htmlFor={id} className="text-[11px] font-semibold text-[#D4DAE4] block truncate">
            {label}
          </label>
          {subLabel && (
            <span className="text-[9px] text-[#7E8899] block leading-tight">{subLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="w-5 h-5 rounded border border-white/25 shrink-0 shadow-inner"
            style={{ backgroundColor: value }}
            aria-hidden="true"
          />
          <input
            id={id}
            type="text"
            value={isEditingHex ? hexInput : value.toUpperCase()}
            onFocus={() => setIsEditingHex(true)}
            onChange={(e) => setHexInput(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHex((e.target as HTMLInputElement).value);
              else if (e.key === 'Escape') {
                setHexInput(value.toUpperCase());
                setIsEditingHex(false);
              }
            }}
            maxLength={7}
            className="w-16 px-1.5 py-0.5 rounded border border-white/10 bg-[#161A22] text-[10px] font-mono-tabular font-medium text-[#F3F1EC] text-center uppercase focus:outline-none focus:border-[#E05A2B] transition-colors"
          />
        </div>
      </div>

      {/* Preset Swatches row */}
      <div className="flex items-center gap-1 overflow-x-auto py-0.5 swatch-row">
        {presetPalette.map((p) => {
          const isSelected = value.toLowerCase() === p.hex.toLowerCase();
          return (
            <button
              key={p.hex + p.name}
              type="button"
              title={`${p.name} (${p.hex})`}
              aria-label={`${p.name} color`}
              onClick={() => {
                onChange(p.hex);
                setHexInput(p.hex.toUpperCase());
              }}
              className={`w-4 h-4 rounded-sm border shrink-0 transition-transform cursor-pointer ${
                isSelected
                  ? 'ring-2 ring-[#E05A2B] border-white scale-110 z-10'
                  : 'border-white/20 hover:scale-110 hover:border-white/50'
              }`}
              style={{ backgroundColor: p.hex }}
            />
          );
        })}
      </div>

      {/* Inline Sliders: Hue and Lightness */}
      <div className="space-y-1.5 pt-1 border-t border-white/6">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-[9px] text-[#8F98A6]">
            <label htmlFor={`${id}-hue`}>Hue</label>
            <span className="font-mono-tabular">{hueDeg}°</span>
          </div>
          <input
            id={`${id}-hue`}
            type="range"
            aria-label={`${label} hue`}
            min={0}
            max={360}
            step={1}
            value={hueDeg}
            onChange={(e) => onHueChange(parseFloat(e.target.value))}
            style={{ background: hueTrack }}
            className="studio-slider w-full h-1.5 rounded appearance-none cursor-pointer"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between text-[9px] text-[#8F98A6]">
            <label htmlFor={`${id}-lightness`}>Lightness</label>
            <span className="font-mono-tabular">{lightnessPct}%</span>
          </div>
          <input
            id={`${id}-lightness`}
            type="range"
            aria-label={`${label} lightness`}
            min={0}
            max={100}
            step={1}
            value={lightnessPct}
            onChange={(e) => onLightnessChange(parseFloat(e.target.value))}
            style={{ background: lightnessTrack }}
            className="studio-slider w-full h-1.5 rounded appearance-none cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}

export function ControlSidebar({
  settings,
  stats,
  collapsed,
  onToggleCollapse,
  onUpdateSettings,
  onResetDefaults,
  voxelLights,
  shadowWarning,
  pickingLight,
  selectedLightId,
  onStartPickLight,
  onSelectLight,
  onRemoveLight,
  onClearLights,
  spawnedPlayers,
  placingPlayerPreset,
  selectedPlayerId,
  onStartPlacePlayer,
  onSelectPlayer,
  onDuplicatePlayer,
  onRemovePlayer,
  onClearPlayers,
}: ControlSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('shaders');
  const [lightsOpen, setLightsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);

  const panelSurface = 'bg-[#14171D]/94 text-[#F3F1EC] border-white/10';
  const dividerClass = 'border-white/8';
  const subBarBg = 'bg-white/5';
  const mutedText = 'text-[#8F98A6]';
  const sectionLabel = `block text-[10px] font-semibold uppercase tracking-wider ${mutedText}`;
  const inactiveBtn =
    'text-[#A6AEBC] hover:text-[#F3F1EC] hover:bg-white/7 border-white/10';

  const activeBtn = 'bg-[#E05A2B] text-white border-[#E05A2B]';

  const tabs: { id: SidebarTab; label: string; icon: typeof Sparkles }[] = [
    { id: 'shaders', label: 'Shaders', icon: Sparkles },
    { id: 'effects', label: 'Miscellaneous', icon: Zap },
    { id: 'material', label: 'Material', icon: SlidersHorizontal },
    { id: 'atmosphere', label: 'Sky & Fog', icon: CloudSun },
    { id: 'camera', label: 'Camera', icon: Camera },
    ...(stats?.format === 'kv6'
      ? [{ id: 'turntable' as SidebarTab, label: 'Turntable', icon: RotateCw }]
      : []),
  ];

  return (
    <aside
      aria-label="Render Studio Sidebar"
      aria-hidden={collapsed}
      // `aria-hidden` + pointer-events-none still leaves every control reachable
      // with Tab, so the collapsed panel would swallow keyboard focus.
      inert={collapsed}
      className={`fixed top-3 right-3 bottom-3 z-20 w-[min(304px,calc(100vw-24px))] flex flex-col rounded-lg border shadow-xl transition-transform duration-200 ease-out ${panelSurface} ${
        collapsed ? 'translate-x-[calc(100%+20px)] pointer-events-none' : 'translate-x-0'
      }`}
    >
      {/* Sidebar Header */}
      <div className={`flex items-center justify-between gap-2 px-3.5 py-2.5 border-b ${dividerClass}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold tracking-tight truncate">
              {stats ? stats.name : 'Studio'}
            </span>
            {stats && (
              <span className={`font-mono-tabular text-[10px] uppercase shrink-0 ${mutedText}`}>
                .{stats.format}
              </span>
            )}
          </div>
          {stats && (
            <div className={`font-mono-tabular text-[10px] truncate ${mutedText}`}>
              {stats.triangleCount.toLocaleString()} tris · {stats.width}×{stats.height}×{stats.depth}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onResetDefaults}
            className="text-[11px] font-medium px-2 py-1 rounded transition-colors cursor-pointer text-[#8F98A6] hover:text-white hover:bg-white/7"
            title="Reset all render settings to defaults"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Close Sidebar"
            title="Hide sidebar (H)"
            className="p-1 rounded transition-colors cursor-pointer text-[#8F98A6] hover:text-white hover:bg-white/7"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Tab Switcher */}
      <div
        className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.52fr)_minmax(0,1fr)_minmax(0,1.08fr)_minmax(0,1fr)] gap-1 p-1.5 border-b ${dividerClass}`}
        role="tablist"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-0.5 rounded-md text-[9.5px] font-medium transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-[#E05A2B] text-white'
                  : 'text-[#9CA4B3] hover:text-[#F3F1EC] hover:bg-white/7'
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="text-center leading-tight whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Tab Body */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4">
        {activeTab === 'turntable' && stats?.format === 'kv6' && (
          <div className="space-y-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-medium text-[#C6CDD9]">Turntable Rotation</span>
                  <p className="text-[10px] text-[#7D8696]">Orbit around the KV6 model</p>
                </div>
                <button
                  type="button"
                  aria-pressed={settings.autoRotate}
                  disabled={settings.cameraMode === 'free'}
                  title={
                    settings.cameraMode === 'free'
                      ? 'Turntable rotation works in orbit mode only — press F to leave free cam'
                      : 'Slowly orbit the camera around the model'
                  }
                  onClick={() => onUpdateSettings({ autoRotate: !settings.autoRotate })}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                    settings.cameraMode === 'free'
                      ? 'text-[#6B7280] border-white/10 cursor-not-allowed'
                      : settings.autoRotate
                        ? activeBtn
                        : inactiveBtn
                  }`}
                >
                  {settings.autoRotate ? 'On' : 'Off'}
                </button>
              </div>
              <SliderControl
                id="turntable-speed"
                label="Turntable Speed"
                value={settings.autoRotateSpeed}
                min={0.2}
                max={10.0}
                step={0.1}
                displayValue={`${settings.autoRotateSpeed.toFixed(1)}×`}
                onChange={(v) => onUpdateSettings({ autoRotateSpeed: v })}
              />
            </div>
          </div>
        )}

        {activeTab === 'effects' && (
          <div className="space-y-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-medium text-[#C6CDD9]">Light Rays (God Rays)</span>
                  <p className="text-[10px] text-[#7D8696]">Low quality live, high quality on PNG export</p>
                </div>
                <button
                  type="button"
                  aria-pressed={settings.godRays}
                  onClick={() => onUpdateSettings({ godRays: !settings.godRays })}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                    settings.godRays ? activeBtn : inactiveBtn
                  }`}
                >
                  {settings.godRays ? 'On' : 'Off'}
                </button>
              </div>
              {settings.godRays && (
                <SliderControl
                  id="misc-god-rays-intensity"
                  label="Ray Intensity"
                  value={settings.godRaysIntensity}
                  min={0.1}
                  max={1.5}
                  step={0.05}
                  displayValue={`${Math.round(settings.godRaysIntensity * 100)}%`}
                  onChange={(v) => onUpdateSettings({ godRaysIntensity: v })}
                />
              )}
            </div>
            <button
              type="button"
              aria-expanded={lightsOpen}
              onClick={() => setLightsOpen((open) => !open)}
              className={`w-full px-3 py-2 rounded-md border text-xs font-semibold transition-colors cursor-pointer ${lightsOpen ? activeBtn : inactiveBtn}`}
            >
              Voxel Lights
            </button>
            {lightsOpen && (
              <div className="p-3 rounded-md border border-white/10 bg-white/5 space-y-2.5">
                <div className={`text-[10px] text-right tabular-nums ${mutedText}`}>
                  {voxelLights.length} / {MAX_VOXEL_LIGHTS} lights
                </div>
              <button
                type="button"
                disabled={!stats || pickingLight || voxelLights.length >= MAX_VOXEL_LIGHTS}
                onClick={onStartPickLight}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-xs font-semibold transition-colors ${
                  pickingLight
                    ? 'bg-[#E05A2B] text-white border-[#E05A2B] cursor-wait'
                    : !stats || voxelLights.length >= MAX_VOXEL_LIGHTS
                      ? 'text-[#6B7280] border-white/10 cursor-not-allowed'
                      : 'bg-[#E05A2B] text-white border-[#E05A2B] hover:bg-[#C94D22] cursor-pointer'
                }`}
                title={
                  !stats
                    ? 'Import a .vxl map or .kv6 model first'
                    : voxelLights.length >= MAX_VOXEL_LIGHTS
                      ? `Maximum of ${MAX_VOXEL_LIGHTS} voxel lights`
                    : pickingLight
                      ? 'Click a voxel in the viewport to place the light'
                      : 'Click, then click any voxel in the viewport to make it a light source'
                }
              >
                <span>{pickingLight ? 'Click a voxel…' : 'Pick a Voxel Light'}</span>
              </button>

              {shadowWarning && <p role="alert" className="text-[11px] leading-relaxed text-amber-300">{shadowWarning}</p>}
              {stats && !shadowWarning && voxelLights.length > 0 && (
                <p className={`text-[10px] leading-relaxed ${mutedText}`}>
                  Lights cast voxel shadows. Many lights or large ranges can slow rendering.
                </p>
              )}
              {!stats && (
                <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                  Import a map or model first — then pick any voxel to turn it into a
                  light source.
                </p>
              )}
              {voxelLights.length >= MAX_VOXEL_LIGHTS && (
                <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                  Maximum of {MAX_VOXEL_LIGHTS} lights reached. Remove one to add another.
                </p>
              )}
              {stats && voxelLights.length === 0 && !pickingLight && (
                <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                  No voxel lights yet. Pick a voxel and its intensity controls appear
                  right next to it in the viewport.
                </p>
              )}

              {voxelLights.length > 0 && (
                <div className="space-y-1.5">
                  {voxelLights.map((light) => {
                    const isSelected = selectedLightId === light.id;
                    return (
                      <div
                        key={light.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors ${
                          isSelected
                            ? 'border-[#E05A2B] bg-[#E05A2B]/10'
                            : 'border-white/10 bg-white/5'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectLight(isSelected ? null : light.id)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                          title="Show intensity controls next to this voxel"
                        >
                          <span
                            className="w-3 h-3 rounded-sm border border-white/25 shrink-0"
                            style={{ backgroundColor: light.color }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0">
                            <span className="block text-[11px] font-semibold text-[#D4DAE4] truncate">
                              Voxel {light.x}, {light.y}, {light.z}
                            </span>
                            <span className={`block font-mono-tabular text-[10px] ${mutedText}`}>
                              {light.intensity.toFixed(1)}× · range {Math.round(light.range)}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveLight(light.id)}
                          aria-label={`Remove light at voxel ${light.x}, ${light.y}, ${light.z}`}
                          title="Remove this light"
                          className="p-1 rounded text-[#8F98A6] hover:text-red-300 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={onClearLights}
                    className={`w-full px-2 py-1 rounded border text-[10px] font-medium transition-colors cursor-pointer ${inactiveBtn}`}
                  >
                    Clear all voxel lights
                  </button>
                </div>
              )}
              </div>
            )}

            <button
              type="button"
              aria-expanded={playersOpen}
              onClick={() => setPlayersOpen((open) => !open)}
              className={`w-full px-3 py-2 rounded-md border text-xs font-semibold transition-colors cursor-pointer ${playersOpen ? activeBtn : inactiveBtn}`}
            >
              Players, Zombies & Corpses
            </button>
            {playersOpen && (
              <div className="p-3 rounded-md border border-white/10 bg-white/5 space-y-2.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className={mutedText}>.vxl maps only</span>
                  <span className={`tabular-nums ${mutedText}`}>
                    {spawnedPlayers.length} / {MAX_SPAWNED_PLAYERS} models
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'player', label: 'Spawn Player', tip: 'Spawn a live Ace of Spades player' },
                      { id: 'zombie', label: 'Spawn Zombie', tip: 'Spawn a ZeroSpades zombie (always holds a spade)' },
                      { id: 'player_corpse', label: 'Player Corpse', tip: 'Spawn a fallen player corpse' },
                      { id: 'zombie_corpse', label: 'Zombie Corpse', tip: 'Spawn a fallen zombie corpse' },
                    ] as const
                  ).map((btn) => {
                    const isActivePreset = placingPlayerPreset === btn.id;
                    const disabled =
                      stats?.format !== 'vxl' || spawnedPlayers.length >= MAX_SPAWNED_PLAYERS;
                    return (
                      <button
                        key={btn.id}
                        type="button"
                        disabled={disabled}
                        aria-pressed={isActivePreset}
                        onClick={() => onStartPlacePlayer(btn.id)}
                        className={`flex items-center justify-center px-2.5 py-2 rounded-md border text-[11px] font-semibold transition-colors ${
                          disabled
                            ? 'text-[#6B7280] border-white/10 cursor-not-allowed'
                            : isActivePreset
                              ? 'bg-[#E05A2B] text-white border-[#E05A2B] cursor-wait'
                              : btn.id === 'player' || btn.id === 'zombie'
                                ? 'bg-[#E05A2B]/90 text-white border-[#E05A2B] hover:bg-[#C94D22] cursor-pointer'
                                : `${inactiveBtn} bg-white/5 cursor-pointer`
                        }`}
                        title={
                          !stats
                            ? 'Import a .vxl map first'
                            : stats.format !== 'vxl'
                              ? 'Player & Zombie models require an Ace of Spades .vxl map'
                              : spawnedPlayers.length >= MAX_SPAWNED_PLAYERS
                                ? `Maximum of ${MAX_SPAWNED_PLAYERS} models`
                                : isActivePreset
                                  ? 'Click anywhere on the .vxl map to spawn'
                                  : btn.tip
                        }
                      >
                        <span className="truncate">
                          {isActivePreset ? 'Click map…' : btn.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {!stats && (
                  <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                    Import a <span className="font-mono-tabular">.vxl</span> map first — Players,
                    Zombies, and Corpses are available on <span className="font-mono-tabular">.vxl</span> maps.
                  </p>
                )}
                {stats && stats.format !== 'vxl' && (
                  <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                    Players, Zombies, and Corpses are only available when a{' '}
                    <span className="font-mono-tabular">.vxl</span> map file is loaded.
                  </p>
                )}
                {stats?.format === 'vxl' &&
                  spawnedPlayers.length === 0 &&
                  placingPlayerPreset === null && (
                    <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                      Spawn a player, spade-wielding zombie, or corpse on the map — click any model
                      to edit its pose, color, or duplicate it right beside it.
                    </p>
                  )}
                {spawnedPlayers.length >= MAX_SPAWNED_PLAYERS && (
                  <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                    Maximum of {MAX_SPAWNED_PLAYERS} models reached. Remove one to add
                    another.
                  </p>
                )}

                {spawnedPlayers.length > 0 && (
                  <div className="space-y-1.5">
                    {spawnedPlayers.map((player, index) => {
                      const isSelected = selectedPlayerId === player.id;
                      const isZombie = player.characterType === 'zombie';
                      const effectiveWeapon = isZombie ? 'spade' : player.weapon;
                      const weaponLabel =
                        effectiveWeapon === 'smg'
                          ? 'SMG'
                          : effectiveWeapon.charAt(0).toUpperCase() + effectiveWeapon.slice(1);
                      const stanceLabel =
                        player.stance.charAt(0).toUpperCase() + player.stance.slice(1);
                      const summaryLabel =
                        player.stance === 'corpse'
                          ? `${isZombie ? 'Zombie' : 'Player'} · Corpse`
                          : `${isZombie ? 'Zombie' : 'Player'} · ${weaponLabel} · ${stanceLabel}`;
                      return (
                        <div
                          key={player.id}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border transition-colors ${
                            isSelected
                              ? 'border-[#E05A2B] bg-[#E05A2B]/10'
                              : 'border-white/10 bg-white/5'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectPlayer(isSelected ? null : player.id)}
                            className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                            title="Show pose and model controls next to this model"
                          >
                            <span
                              className="w-3 h-3 rounded-sm border border-white/25 shrink-0"
                              style={{ backgroundColor: player.teamColor }}
                              aria-hidden="true"
                            />
                            <span className="min-w-0">
                              <span className="block text-[11px] font-semibold text-[#D4DAE4] truncate">
                                #{index + 1} · {summaryLabel}
                              </span>
                              <span className={`block font-mono-tabular text-[10px] ${mutedText}`}>
                                {player.x.toFixed(1)}, {player.y.toFixed(1)}, {player.z.toFixed(1)}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={spawnedPlayers.length >= MAX_SPAWNED_PLAYERS}
                            onClick={() => onDuplicatePlayer(player.id)}
                            aria-label={`Duplicate player #${index + 1}`}
                            title="Duplicate in current state"
                            className="p-1 rounded text-[#8F98A6] hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
                          >
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemovePlayer(player.id)}
                            aria-label={`Remove player #${index + 1}`}
                            title="Remove this player model"
                            className="p-1 rounded text-[#8F98A6] hover:text-red-300 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={onClearPlayers}
                      className={`w-full px-2 py-1 rounded border text-[10px] font-medium transition-colors cursor-pointer ${inactiveBtn}`}
                    >
                      Clear all player models
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'shaders' && (
          <div className="space-y-4">
            {SHADER_CATEGORIES.map((category, idx) => {
              const presets = SHADER_PRESETS.filter((p) => p.category === category.id);
              return (
                <div
                  key={category.id}
                  className={idx > 0 ? `pt-3 border-t space-y-2 ${dividerClass}` : 'space-y-2'}
                >
                  <span className={sectionLabel}>{category.label}</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {presets.map((preset) => {
                      const active = settings.shaderMode === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => onUpdateSettings({ shaderMode: preset.id })}
                          className={`flex flex-col items-start px-2.5 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                            active ? activeBtn : inactiveBtn
                          }`}
                        >
                          <span className="text-[11px] font-semibold leading-tight">
                            {preset.label}
                          </span>
                          <span
                            className={`text-[10px] leading-snug mt-0.5 ${
                              active ? 'text-white/85' : mutedText
                            }`}
                          >
                            {preset.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'material' && (
          <div className="space-y-4">
            <div className="space-y-3">
              <span className={sectionLabel}>Surface & Shading</span>
              <SliderControl
                id="ao-strength"
                label="Ambient Occlusion"
                value={settings.aoStrength}
                min={0}
                max={1.5}
                step={0.05}
                displayValue={`${Math.round(settings.aoStrength * 100)}%`}
                onChange={(v) => onUpdateSettings({ aoStrength: v })}
              />
              <SliderControl
                id="roughness-ctrl"
                label="Roughness"
                value={settings.roughness}
                min={0.05}
                max={1}
                step={0.05}
                displayValue={settings.roughness.toFixed(2)}
                onChange={(v) => onUpdateSettings({ roughness: v })}
              />
              <SliderControl
                id="metalness-ctrl"
                label="Metalness"
                value={settings.metalness}
                min={0}
                max={1}
                step={0.05}
                displayValue={settings.metalness.toFixed(2)}
                onChange={(v) => onUpdateSettings({ metalness: v })}
              />
              <SliderControl
                id="outline-ctrl"
                label="Silhouette Outline"
                value={settings.outlineStrength}
                min={0}
                max={1}
                step={0.05}
                displayValue={`${Math.round(settings.outlineStrength * 100)}%`}
                onChange={(v) => onUpdateSettings({ outlineStrength: v })}
              />
            </div>

            <div className={`pt-3 border-t space-y-2.5 ${dividerClass}`}>
              <div className="flex items-center justify-between">
                <span className={sectionLabel}>Cross-Section Slice</span>
                <div className={`flex items-center gap-0.5 p-0.5 rounded-md ${subBarBg}`}>
                  {(['none', 'x', 'y', 'z'] as SliceAxis[]).map((axis) => (
                    <button
                      key={axis}
                      type="button"
                      onClick={() => onUpdateSettings({ sliceAxis: axis })}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors cursor-pointer ${
                        settings.sliceAxis === axis
                          ? 'bg-[#E05A2B] text-white'
                          : 'text-[#9CA4B3] hover:text-white'
                      }`}
                    >
                      {axis === 'none' ? 'Off' : axis}
                    </button>
                  ))}
                </div>
              </div>
              {settings.sliceAxis !== 'none' && (
                <SliderControl
                  id="slice-pos"
                  label="Cut Depth"
                  value={settings.slicePosition}
                  min={0.05}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round(settings.slicePosition * 100)}%`}
                  onChange={(v) => onUpdateSettings({ slicePosition: v })}
                />
              )}
            </div>
          </div>
        )}

        {activeTab === 'atmosphere' && (
          <div className="space-y-4">
            {/* Sky & Atmosphere Presets */}
            <div className="space-y-2">
              <span className={sectionLabel}>Sky & Atmosphere</span>

              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(BACKDROP_THEMES) as BackdropPreset[]).map((key) => {
                  const theme = BACKDROP_THEMES[key];
                  const active = settings.backdrop === key;
                  const isCustom = key === 'custom';

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        // Only adopt the new preset's sun/fog colours when the user
                        // has not hand-picked their own; switching backdrops used to
                        // silently overwrite a custom sun colour and, with Sync Sky
                        // off, a custom fog colour too.
                        const prevTheme = BACKDROP_THEMES[settings.backdrop];
                        const sunIsPresetDefault =
                          settings.sunColor.toLowerCase() ===
                            prevTheme.defaultSunHex.toLowerCase() ||
                          Object.values(BACKDROP_THEMES).some(
                            (t) => t.defaultSunHex.toLowerCase() === settings.sunColor.toLowerCase(),
                          );
                        const patch: Partial<RenderSettings> = { backdrop: key };
                        if (sunIsPresetDefault) patch.sunColor = theme.defaultSunHex;
                        if (settings.fogSyncSky) {
                          patch.fogColor = isCustom ? settings.customHorizonColor : theme.fogHex;
                        } else if (
                          settings.fogColor.toLowerCase() === prevTheme.fogHex.toLowerCase() ||
                          Object.values(BACKDROP_THEMES).some(
                            (t) => t.fogHex.toLowerCase() === settings.fogColor.toLowerCase(),
                          )
                        ) {
                          patch.fogColor = isCustom ? settings.customHorizonColor : theme.fogHex;
                        }
                        onUpdateSettings(patch);
                      }}
                      className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                        active ? activeBtn : inactiveBtn
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-sm border border-white/25 shrink-0 overflow-hidden"
                          style={{
                            background: `linear-gradient(180deg, ${
                              isCustom ? settings.customZenithColor : theme.zenithHex
                            } 0%, ${
                              isCustom ? settings.customHorizonColor : theme.horizonHex
                            } 100%)`,
                          }}
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          {isCustom ? 'Custom Sky' : theme.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Custom Sky Configuration Panel (active when Custom Sky is selected) */}
              {settings.backdrop === 'custom' && (
                <div className="p-3 rounded-md border border-white/10 bg-white/5 space-y-3 mt-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[#D4DAE4]">Custom Sky</span>
                    <span className="text-[10px] text-[#8992A2]">Custom Preset</span>
                  </div>

                  {/* Zenith Color Selector (ABOVE Horizon) */}
                  <InlineColorPicker
                    id="custom-zenith-picker"
                    label="Zenith Color"
                    subLabel="Top of sky dome"
                    value={settings.customZenithColor}
                    onChange={(hex) => onUpdateSettings({ customZenithColor: hex })}
                    presetPalette={ZENITH_PALETTE}
                  />

                  {/* Horizon Color Selector (BELOW Zenith) */}
                  <InlineColorPicker
                    id="custom-horizon-picker"
                    label="Horizon Color"
                    subLabel="Horizon skyline & fog sync"
                    value={settings.customHorizonColor}
                    onChange={(hex) => {
                      onUpdateSettings({
                        customHorizonColor: hex,
                        fogColor: settings.fogSyncSky ? hex : settings.fogColor,
                      });
                    }}
                    presetPalette={HORIZON_PALETTE}
                  />
                </div>
              )}
            </div>

            {/* Sunlight Color & Direction */}
            <div className={`pt-3 border-t space-y-2.5 ${dividerClass}`}>
              <span className={sectionLabel}>Sunlight</span>
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="sun-color-input"
                  className={`text-[11px] font-medium ${mutedText}`}
                >
                  Color
                </label>
                <div className="flex items-center gap-1.5">
                  {SUN_SWATCHES.map((sw) => (
                    <button
                      key={sw.hex}
                      type="button"
                      title={sw.label}
                      aria-label={`Sun color ${sw.label}`}
                      onClick={() => onUpdateSettings({ sunColor: sw.hex })}
                      className={`w-4 h-4 rounded-sm border transition-transform cursor-pointer ${
                        settings.sunColor.toLowerCase() === sw.hex.toLowerCase()
                          ? 'ring-2 ring-[#E05A2B] border-white scale-110'
                          : 'border-white/20 hover:scale-105'
                      }`}
                      style={{ backgroundColor: sw.hex }}
                    />
                  ))}
                  <input
                    id="sun-color-input"
                    type="color"
                    value={settings.sunColor}
                    onChange={(e) => onUpdateSettings({ sunColor: e.target.value })}
                    className="w-5 h-5 p-0 border-0 rounded bg-transparent cursor-pointer"
                    title="Custom sun color"
                  />
                </div>
              </div>

              <SliderControl
                id="light-az"
                label="Azimuth"
                value={settings.lightAzimuth}
                min={0}
                max={360}
                step={5}
                displayValue={`${settings.lightAzimuth}°`}
                onChange={(v) => onUpdateSettings({ lightAzimuth: v })}
              />
              <SliderControl
                id="light-el"
                label="Elevation"
                value={settings.lightElevation}
                min={0}
                max={85}
                step={1}
                displayValue={`${settings.lightElevation}°`}
                onChange={(v) => onUpdateSettings({ lightElevation: v })}
              />
              <SliderControl
                id="light-int"
                label="Intensity"
                value={settings.lightIntensity}
                min={0.3}
                max={2.4}
                step={0.05}
                displayValue={settings.lightIntensity.toFixed(2)}
                onChange={(v) => onUpdateSettings({ lightIntensity: v })}
              />
            </div>

            {/* Distance Fog */}
            <div className={`pt-3 border-t space-y-2.5 ${dividerClass}`}>
              <span className={sectionLabel}>Distance Fog</span>
              <div className="grid grid-cols-2 gap-1.5">
                {FOG_MODES.map((fm) => (
                  <button
                    key={fm.id}
                    type="button"
                    aria-pressed={settings.fogMode === fm.id}
                    onClick={() => onUpdateSettings({ fogMode: fm.id })}
                    className={`px-2 py-1.5 rounded border text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      settings.fogMode === fm.id ? activeBtn : inactiveBtn
                    }`}
                  >
                    {fm.label}
                  </button>
                ))}
              </div>

              {settings.fogMode === 'ingame' && (
                <SliderControl
                  id="fog-range"
                  label="Fog Distance"
                  value={settings.fogRange}
                  min={40}
                  max={900}
                  step={10}
                  displayValue={`${settings.fogRange} vox`}
                  onChange={(v) => onUpdateSettings({ fogRange: v })}
                />
              )}

              <SliderControl
                id="fog-density"
                label="Fog Opacity"
                value={settings.fogDensity}
                min={0}
                max={2.5}
                step={0.05}
                displayValue={`${Math.round(settings.fogDensity * 100)}%`}
                onChange={(v) => onUpdateSettings({ fogDensity: v })}
              />

              <SliderControl
                id="height-fog"
                label="Valley Mist"
                value={settings.heightFog}
                min={0}
                max={1}
                step={0.02}
                displayValue={`${Math.round(settings.heightFog * 100)}%`}
                onChange={(v) => onUpdateSettings({ heightFog: v })}
              />

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <label
                  htmlFor="fog-color-input"
                  className={`text-[11px] font-medium ${mutedText}`}
                >
                  Fog Color
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ fogSyncSky: !settings.fogSyncSky })}
                    className={`px-2 py-0.5 rounded border text-[10px] font-medium transition-colors cursor-pointer ${
                      settings.fogSyncSky ? activeBtn : inactiveBtn
                    }`}
                  >
                    Sync Sky
                  </button>
                  <input
                    id="fog-color-input"
                    type="color"
                    value={
                      settings.fogSyncSky
                        ? (settings.backdrop === 'custom'
                            ? settings.customHorizonColor
                            : BACKDROP_THEMES[settings.backdrop].fogHex)
                        : settings.fogColor
                    }
                    onChange={(e) =>
                      onUpdateSettings({ fogSyncSky: false, fogColor: e.target.value })
                    }
                    className="w-5 h-5 p-0 border-0 rounded bg-transparent cursor-pointer"
                    title="Custom fog color"
                  />
                </div>
              </div>
            </div>

            {/* Additive Volumetric Bottom Clouds */}
            <div className={`pt-3 border-t space-y-2.5 ${dividerClass}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={sectionLabel}>Bottom Clouds</span>
                <button
                  type="button"
                  aria-pressed={settings.volumetricClouds}
                  onClick={() =>
                    onUpdateSettings({ volumetricClouds: !settings.volumetricClouds })
                  }
                  className={`px-2.5 py-0.5 rounded border text-[10px] font-semibold transition-colors cursor-pointer ${
                    settings.volumetricClouds ? activeBtn : inactiveBtn
                  }`}
                >
                  {settings.volumetricClouds ? 'On' : 'Off'}
                </button>
              </div>

              {settings.volumetricClouds && (
                <>
                  <SliderControl
                    id="volumetric-strength"
                    label="Cloud Density"
                    value={settings.volumetricStrength}
                    min={0.05}
                    max={1.5}
                    step={0.05}
                    displayValue={`${Math.round(settings.volumetricStrength * 100)}%`}
                    onChange={(v) => onUpdateSettings({ volumetricStrength: v })}
                  />
                  <SliderControl
                    id="cloud-altitude"
                    label="Cloud Height"
                    value={settings.cloudAltitude}
                    min={0.12}
                    max={0.75}
                    step={0.02}
                    displayValue={`${Math.round(settings.cloudAltitude * 100)}%`}
                    onChange={(v) => onUpdateSettings({ cloudAltitude: v })}
                  />
                </>
              )}
            </div>

            {/* VXL Ocean Water Tint & Waves (only when a .vxl map is loaded) */}
            {stats?.format === 'vxl' && (
              <div className={`pt-3 border-t space-y-2.5 ${dividerClass}`}>
                <span className={`flex items-center gap-1.5 ${sectionLabel}`}>
                  <Waves className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Map Ocean</span>
                </span>
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="water-color-input"
                    className={`text-[11px] ${mutedText}`}
                  >
                    Water Tint{' '}
                    {stats?.waterColorHex && !settings.waterColorOverride && (
                      <span className="font-mono-tabular opacity-75">(from .vxl)</span>
                    )}
                  </label>
                  <div className="flex items-center gap-1.5">
                    {settings.waterColorOverride && (
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ waterColorOverride: '' })}
                        className={`px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${inactiveBtn}`}
                      >
                        Auto
                      </button>
                    )}
                    <input
                      id="water-color-input"
                      type="color"
                      value={
                        settings.waterColorOverride ||
                        stats?.waterColorHex ||
                        '#3B6D96'
                      }
                      onChange={(e) =>
                        onUpdateSettings({ waterColorOverride: e.target.value })
                      }
                      className="w-5 h-5 p-0 border-0 rounded bg-transparent cursor-pointer"
                      title="Override ocean water color"
                    />
                  </div>
                </div>
                <SliderControl
                  id="wave-strength"
                  label="Wave Ripples"
                  value={settings.waveStrength}
                  min={0}
                  max={1}
                  step={0.05}
                  displayValue={`${Math.round(settings.waveStrength * 100)}%`}
                  onChange={(v) => onUpdateSettings({ waveStrength: v })}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'camera' && (
          <div className="space-y-4">
            <div className="space-y-2.5">
              <span className={sectionLabel}>Navigation</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-pressed={settings.cameraMode === 'orbit'}
                  onClick={() => onUpdateSettings({ cameraMode: 'orbit' })}
                  className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                    settings.cameraMode === 'orbit' ? activeBtn : inactiveBtn
                  }`}
                >
                  Orbit Camera
                </button>
                <button
                  type="button"
                  aria-pressed={settings.cameraMode === 'free'}
                  onClick={() => onUpdateSettings({ cameraMode: 'free' })}
                  className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                    settings.cameraMode === 'free' ? activeBtn : inactiveBtn
                  }`}
                >
                  Free Cam (F)
                </button>
              </div>

              {settings.cameraMode === 'free' && (
                <>
                  <SliderControl
                    id="fly-speed"
                    label="Fly Speed"
                    value={settings.flySpeed}
                    min={10}
                    max={240}
                    step={5}
                    displayValue={`${settings.flySpeed} v/s`}
                    onChange={(v) => onUpdateSettings({ flySpeed: v })}
                  />
                  <p className={`text-[10px] leading-relaxed ${mutedText}`}>
                    Drag to look · WASD fly · E/Q up/down · Shift boost · Scroll speed
                  </p>
                </>
              )}

              {!settings.orthographic && (
                <SliderControl
                  id="camera-fov"
                  label="Lens FOV"
                  value={settings.cameraFov}
                  min={24}
                  max={95}
                  step={1}
                  displayValue={`${settings.cameraFov}°`}
                  onChange={(v) => onUpdateSettings({ cameraFov: v })}
                />
              )}
            </div>

            <div className={`pt-3 border-t space-y-3 ${dividerClass}`}>
              <span className={sectionLabel}>Lens & Post FX</span>
              <SliderControl
                id="post-exposure"
                label="Exposure"
                value={settings.exposure}
                min={0.6}
                max={1.6}
                step={0.02}
                displayValue={settings.exposure.toFixed(2)}
                onChange={(v) => onUpdateSettings({ exposure: v })}
              />
              <SliderControl
                id="post-tilt-shift"
                label="Tilt-Shift DOF"
                value={settings.tiltShift}
                min={0}
                max={1.0}
                step={0.05}
                displayValue={`${Math.round(settings.tiltShift * 100)}%`}
                onChange={(v) => onUpdateSettings({ tiltShift: v })}
              />
              <SliderControl
                id="post-bloom"
                label="Bloom Glow"
                value={settings.bloomStrength}
                min={0}
                max={1.0}
                step={0.01}
                displayValue={`${Math.round(settings.bloomStrength * 100)}%`}
                onChange={(v) => onUpdateSettings({ bloomStrength: v })}
              />
              <SliderControl
                id="post-vignette"
                label="Vignette"
                value={settings.vignette}
                min={0}
                max={1}
                step={0.05}
                displayValue={`${Math.round(settings.vignette * 100)}%`}
                onChange={(v) => onUpdateSettings({ vignette: v })}
              />
              <SliderControl
                id="post-chromatic"
                label="Chromatic Aberration"
                value={settings.chromatic}
                min={0}
                max={1}
                step={0.05}
                displayValue={`${Math.round(settings.chromatic * 100)}%`}
                onChange={(v) => onUpdateSettings({ chromatic: v })}
              />
              <SliderControl
                id="post-pixelate"
                label="Retro Pixel"
                value={settings.pixelate}
                min={0}
                max={8}
                step={1}
                displayValue={settings.pixelate < 2 ? 'Off' : `${settings.pixelate}px`}
                onChange={(v) => onUpdateSettings({ pixelate: v })}
              />
            </div>
          </div>
        )}
      </div>

      {/* Subtle Keyboard Shortcut Footer */}
      <div
        className={`px-3.5 py-2 border-t text-[10px] flex items-center justify-between ${dividerClass} ${mutedText}`}
      >
        <span>H · Hide UI</span>
        <span>F · Free Cam</span>
      </div>
    </aside>
  );
}
