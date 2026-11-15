import { Lightbulb, Trash2, X } from 'lucide-react';
import { RefObject } from 'react';
import { VoxelLight } from '../voxel/types';
import {
  computeFloatingPanelCoords,
  VOXEL_LIGHT_PANEL_GAP,
  VOXEL_LIGHT_PANEL_H,
  VOXEL_LIGHT_PANEL_W,
  VoxelScreenPos,
} from './floatingAnchor';

export {
  computeFloatingPanelCoords,
  VOXEL_LIGHT_PANEL_GAP,
  VOXEL_LIGHT_PANEL_H,
  VOXEL_LIGHT_PANEL_W,
};
export type { VoxelScreenPos };

interface VoxelLightPanelProps {
  light: VoxelLight;
  initialScreenPos: VoxelScreenPos;
  panelRef: RefObject<HTMLDivElement | null>;
  dotRef: RefObject<HTMLDivElement | null>;
  onUpdate: (id: string, patch: Partial<VoxelLight>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

const LIGHT_SWATCHES = [
  { label: 'Warm Torch', hex: '#FFB35C' },
  { label: 'Daylight', hex: '#FFF3D6' },
  { label: 'Cool Moon', hex: '#9FC4FF' },
  { label: 'Ember', hex: '#FF6B3D' },
  { label: 'Mint', hex: '#7DFFC4' },
  { label: 'Violet', hex: '#C99BFF' },
];

interface PanelSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (val: number) => void;
}

function PanelSlider({ id, label, value, min, max, step, displayValue, onChange }: PanelSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const trackBg = `linear-gradient(to right, #E05A2B ${pct}%, rgba(255,255,255,0.15) ${pct}%)`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <label htmlFor={id} className="font-medium whitespace-nowrap text-[#B8C0CC]">
          {label}
        </label>
        <span className="font-mono-tabular text-[#8992A2]">{displayValue}</span>
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

/**
 * Floating voxel-light editor anchored to the selected voxel's screen position.
 * Positioned via GPU-composited `translate3d` synchronized with WebGL frames so
 * camera orbits and Free Cam flight move it smoothly at full display refresh rate.
 */
export function VoxelLightPanel({
  light,
  initialScreenPos,
  panelRef,
  dotRef,
  onUpdate,
  onRemove,
  onClose,
}: VoxelLightPanelProps) {
  const { left, top } = computeFloatingPanelCoords(
    initialScreenPos.x,
    initialScreenPos.y,
    VOXEL_LIGHT_PANEL_W,
    VOXEL_LIGHT_PANEL_H,
    VOXEL_LIGHT_PANEL_GAP,
    window.innerWidth,
    window.innerHeight,
  );

  return (
    <>
      {/* Anchor dot on the voxel itself */}
      <div
        ref={dotRef}
        className="pointer-events-none fixed left-0 top-0 z-30 will-change-transform"
        style={{
          transform: `translate3d(${initialScreenPos.x}px, ${initialScreenPos.y}px, 0) translate(-50%, -50%)`,
          visibility: initialScreenPos.visible ? 'visible' : 'hidden',
        }}
        aria-hidden="true"
      >
        <span
          className="block w-3 h-3 rounded-full border-2 border-white shadow-lg"
          style={{ backgroundColor: light.color }}
        />
      </div>

      <div
        ref={panelRef}
        role="dialog"
        aria-label={`Voxel light controls at ${light.x}, ${light.y}, ${light.z}`}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed left-0 top-0 z-30 rounded-lg border border-white/12 bg-[#14171D]/96 text-[#F3F1EC] shadow-2xl p-3 space-y-3 will-change-transform"
        style={{
          width: VOXEL_LIGHT_PANEL_W,
          transform: `translate3d(${left}px, ${top}px, 0)`,
          visibility: initialScreenPos.visible ? 'visible' : 'hidden',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-[#E05A2B] shrink-0" aria-hidden="true" />
              <span className="text-xs font-semibold tracking-tight">Voxel Light</span>
            </div>
            <span className="font-mono-tabular text-[10px] text-[#8F98A6] block mt-0.5">
              {light.x}, {light.y}, {light.z}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close light controls"
            className="p-1 rounded text-[#8F98A6] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Color */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[#B8C0CC]">Color</span>
          <div className="flex items-center gap-1.5">
            {LIGHT_SWATCHES.map((sw) => (
              <button
                key={sw.hex}
                type="button"
                title={sw.label}
                aria-label={`Light color ${sw.label}`}
                onClick={() => onUpdate(light.id, { color: sw.hex })}
                className={`w-4 h-4 rounded-sm border transition-transform cursor-pointer ${
                  light.color.toLowerCase() === sw.hex.toLowerCase()
                    ? 'ring-2 ring-[#E05A2B] border-white scale-110'
                    : 'border-white/20 hover:scale-105'
                }`}
                style={{ backgroundColor: sw.hex }}
              />
            ))}
            <input
              type="color"
              value={light.color}
              onChange={(e) => onUpdate(light.id, { color: e.target.value })}
              className="w-5 h-5 p-0 border-0 rounded bg-transparent cursor-pointer"
              title="Custom light color"
              aria-label="Custom light color"
            />
          </div>
        </div>

        {/* Intensity + Range */}
        <PanelSlider
          id="voxel-light-intensity"
          label="Intensity"
          value={light.intensity}
          min={0}
          max={100}
          step={0.1}
          displayValue={`${light.intensity.toFixed(1)}×`}
          onChange={(v) => onUpdate(light.id, { intensity: v })}
        />
        <PanelSlider
          id="voxel-light-range"
          label="Range"
          value={light.range}
          min={4}
          max={120}
          step={1}
          displayValue={`${Math.round(light.range)} vox`}
          onChange={(v) => onUpdate(light.id, { range: v })}
        />

        {/* Remove */}
        <button
          type="button"
          onClick={() => onRemove(light.id)}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-red-400/25 text-[11px] font-medium text-red-200 hover:bg-red-400/10 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
          <span>Remove light</span>
        </button>
      </div>
    </>
  );
}
