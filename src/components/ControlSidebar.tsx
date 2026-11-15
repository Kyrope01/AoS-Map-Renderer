import {
  Camera,
  CloudSun,
  SlidersHorizontal,
  Sparkles,
  Waves,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { BACKDROP_THEMES, SHADER_CATEGORIES, SHADER_PRESETS } from '../renderer/shaders';
import {
  BackdropPreset,
  FogMode,
  MeshStats,
  RenderSettings,
  SliceAxis,
} from '../voxel/types';

type SidebarTab = 'shaders' | 'material' | 'atmosphere' | 'camera';

interface ControlSidebarProps {
  settings: RenderSettings;
  stats: MeshStats | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onUpdateSettings: (patch: Partial<RenderSettings>) => void;
  onResetDefaults: () => void;
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
  const pct = ((value - min) / (max - min)) * 100;
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

export function ControlSidebar({
  settings,
  stats,
  collapsed,
  onToggleCollapse,
  onUpdateSettings,
  onResetDefaults,
}: ControlSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('shaders');

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
    { id: 'material', label: 'Material', icon: SlidersHorizontal },
    { id: 'atmosphere', label: 'Sky & Fog', icon: CloudSun },
    { id: 'camera', label: 'Camera', icon: Camera },
  ];

  return (
    <aside
      aria-label="Render Studio Sidebar"
      aria-hidden={collapsed}
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
      <div className={`grid grid-cols-4 gap-1 p-1.5 border-b ${dividerClass}`} role="tablist">
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
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-[#E05A2B] text-white'
                  : 'text-[#9CA4B3] hover:text-[#F3F1EC] hover:bg-white/7'
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Tab Body */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4">
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
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          backdrop: key,
                          sunColor: theme.defaultSunHex,
                          fogColor: theme.fogHex,
                        })
                      }
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                        active ? activeBtn : inactiveBtn
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-sm border border-white/25 shrink-0"
                        style={{
                          background: `linear-gradient(180deg, ${theme.zenithHex} 0%, ${theme.horizonHex} 100%)`,
                        }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{theme.label}</span>
                    </button>
                  );
                })}
              </div>
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
                min={5}
                max={85}
                step={2}
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
                        ? BACKDROP_THEMES[settings.backdrop].fogHex
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

            <div className={`pt-3 border-t space-y-2 ${dividerClass}`}>
              <span className={sectionLabel}>View Options</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-pressed={settings.orthographic}
                  onClick={() => onUpdateSettings({ orthographic: !settings.orthographic })}
                  className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                    settings.orthographic ? activeBtn : inactiveBtn
                  }`}
                >
                  Orthographic
                </button>
                <button
                  type="button"
                  aria-pressed={settings.autoRotate}
                  onClick={() => onUpdateSettings({ autoRotate: !settings.autoRotate })}
                  className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                    settings.autoRotate ? activeBtn : inactiveBtn
                  }`}
                >
                  Turntable Spin
                </button>
                {(!stats || stats.format === 'kv6') && (
                  <button
                    type="button"
                    aria-pressed={settings.showPedestal}
                    onClick={() => onUpdateSettings({ showPedestal: !settings.showPedestal })}
                    className={`col-span-2 px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                      settings.showPedestal ? activeBtn : inactiveBtn
                    }`}
                  >
                    KV6 Display Plate
                  </button>
                )}
              </div>
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
