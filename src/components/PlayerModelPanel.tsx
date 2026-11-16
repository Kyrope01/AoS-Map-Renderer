import { Copy, Crosshair, Move, Skull, Trash2, User, X } from 'lucide-react';
import { RefObject } from 'react';
import {
  DEFAULT_ZOMBIE_CLOTH_COLOR,
  PLAYER_BLOCK_SWATCHES,
  PLAYER_CHARACTER_OPTIONS,
  PLAYER_STANCE_OPTIONS,
  PLAYER_STYLE_OPTIONS,
  PLAYER_TEAM_SWATCHES,
  PLAYER_WEAPON_OPTIONS,
} from '../voxel/playerModel';
import { PlayerWeapon, SpawnedPlayer } from '../voxel/types';
import {
  computeFloatingPanelCoords,
  PLAYER_PANEL_GAP,
  PLAYER_PANEL_W,
  VoxelScreenPos,
} from './floatingAnchor';

export { PLAYER_PANEL_GAP, PLAYER_PANEL_W };

const TACTICAL_CORPSE_CLASS_OPTIONS: readonly { id: PlayerWeapon; label: string }[] = [
  { id: 'rifle', label: 'Rifle' },
  { id: 'shotgun', label: 'Shotgun' },
  { id: 'smg', label: 'SMG' },
];

interface PlayerModelPanelProps {
  player: SpawnedPlayer;
  initialScreenPos: VoxelScreenPos;
  panelRef: RefObject<HTMLDivElement | null>;
  isMovingOnMap: boolean;
  canDuplicate: boolean;
  onUpdate: (id: string, patch: Partial<SpawnedPlayer>) => void;
  onDuplicate: (id: string) => void;
  onToggleMoveOnMap: (id: string) => void;
  onSnapToGround: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

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

function PanelSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: PanelSliderProps) {
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
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
 * Floating player/zombie/corpse editor anchored cleanly beside the selected model
 * in the 3D viewport. Updated via GPU-composited `translate3d` on every WebGL frame
 * so camera orbits and Free Cam movement stay silky smooth.
 */
export function PlayerModelPanel({
  player,
  initialScreenPos,
  panelRef,
  isMovingOnMap,
  canDuplicate,
  onUpdate,
  onDuplicate,
  onToggleMoveOnMap,
  onSnapToGround,
  onRemove,
  onClose,
}: PlayerModelPanelProps) {
  const isZombie = player.characterType === 'zombie';
  const isCorpse = player.stance === 'corpse';
  const estHeight = !isZombie && !isCorpse && player.weapon === 'block' ? 500 : 454;
  const { left, top } = computeFloatingPanelCoords(
    initialScreenPos.x,
    initialScreenPos.y,
    PLAYER_PANEL_W,
    estHeight,
    PLAYER_PANEL_GAP,
    window.innerWidth,
    window.innerHeight,
  );

  const inactiveBtn =
    'text-[#A6AEBC] hover:text-[#F3F1EC] hover:bg-white/7 border-white/10';
  const activeBtn = 'bg-[#E05A2B] text-white border-[#E05A2B]';

  const headerTitle = isCorpse
    ? isZombie
      ? 'Zombie Corpse'
      : 'Player Corpse'
    : isZombie
      ? 'Zombie Model'
      : 'Player Model';

  const tacticalCorpseClass: PlayerWeapon =
    player.weapon === 'shotgun' || player.weapon === 'smg' ? player.weapon : 'rifle';

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Player model controls"
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed left-0 top-0 z-30 rounded-lg border border-white/12 bg-[#14171D]/96 text-[#F3F1EC] shadow-2xl p-3 space-y-2.5 max-h-[calc(100vh-24px)] overflow-y-auto will-change-transform"
      style={{
        width: PLAYER_PANEL_W,
        transform: `translate3d(${left}px, ${top}px, 0)`,
        visibility: initialScreenPos.visible ? 'visible' : 'hidden',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {isZombie || isCorpse ? (
              <Skull className="w-3.5 h-3.5 text-[#E05A2B] shrink-0" aria-hidden="true" />
            ) : (
              <User className="w-3.5 h-3.5 text-[#E05A2B] shrink-0" aria-hidden="true" />
            )}
            <span className="text-xs font-semibold tracking-tight">{headerTitle}</span>
          </div>
          <span className="font-mono-tabular text-[10px] text-[#8F98A6] block mt-0.5">
            {player.x.toFixed(1)}, {player.y.toFixed(1)}, {player.z.toFixed(1)} · drag model to move
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close player model controls"
          className="p-1 rounded text-[#8F98A6] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Character Type (Player vs Zombie) */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[#B8C0CC]">Character</span>
        <div className="grid grid-cols-2 gap-1">
          {PLAYER_CHARACTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={player.characterType === opt.id}
              onClick={() => {
                if (opt.id === player.characterType) return;
                if (opt.id === 'zombie') {
                  onUpdate(player.id, {
                    characterType: 'zombie',
                    weapon: 'spade',
                    teamColor:
                      player.teamColor.toUpperCase() === '#2B6CB0'
                        ? DEFAULT_ZOMBIE_CLOTH_COLOR
                        : player.teamColor,
                  });
                } else {
                  onUpdate(player.id, { characterType: 'player' });
                }
              }}
              className={`px-2.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                player.characterType === opt.id ? activeBtn : inactiveBtn
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stance / Position (including Corpse) */}
      <div className="space-y-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#8F98A6]">
          State / Position
        </span>
        <div className="grid grid-cols-2 gap-1">
          {PLAYER_STANCE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={player.stance === opt.id}
              onClick={() => onUpdate(player.id, { stance: opt.id })}
              className={`px-2 py-1 rounded border text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                player.stance === opt.id ? activeBtn : inactiveBtn
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Weapon / Tool (live models) */}
      {!isCorpse && (
        <div className="space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#8F98A6]">
            Held Weapon / Tool
          </span>
          {isZombie ? (
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded border border-[#E05A2B]/40 bg-[#E05A2B]/12 text-[11px]">
              <span className="font-semibold text-[#F3F1EC]">Spade</span>
              <span className="text-[10px] text-[#B8C0CC]">Zombies always hold spades</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {PLAYER_WEAPON_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={player.weapon === opt.id}
                  onClick={() => onUpdate(player.id, { weapon: opt.id })}
                  className={`px-2 py-1 rounded border text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    player.weapon === opt.id ? activeBtn : inactiveBtn
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Uniform Style (Human players & human corpses) */}
      {!isZombie && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[#B8C0CC]">Gear Style</span>
          <div className="grid grid-cols-2 gap-1">
            {PLAYER_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={player.style === opt.id}
                onClick={() => onUpdate(player.id, { style: opt.id })}
                className={`px-2 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  player.style === opt.id ? activeBtn : inactiveBtn
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tactical Corpse Class (Rifle / Shotgun / SMG Dead.kv6) */}
      {!isZombie && isCorpse && player.style === 'tactical' && (
        <div className="space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#8F98A6]">
            Corpse Class
          </span>
          <div className="grid grid-cols-3 gap-1">
            {TACTICAL_CORPSE_CLASS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={tacticalCorpseClass === opt.id}
                onClick={() => onUpdate(player.id, { weapon: opt.id })}
                className={`px-2 py-1 rounded border text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  tacticalCorpseClass === opt.id ? activeBtn : inactiveBtn
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Team / Clothing Color */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[#B8C0CC]">
          {isZombie ? 'Cloth Color' : 'Team Color'}
        </span>
        <div className="flex items-center gap-1.5">
          {PLAYER_TEAM_SWATCHES.map((sw) => (
            <button
              key={sw.hex}
              type="button"
              title={sw.label}
              aria-label={`Team color ${sw.label}`}
              onClick={() => onUpdate(player.id, { teamColor: sw.hex })}
              className={`w-4 h-4 rounded-sm border transition-transform cursor-pointer ${
                player.teamColor.toLowerCase() === sw.hex.toLowerCase()
                  ? 'ring-2 ring-[#E05A2B] border-white scale-110'
                  : 'border-white/20 hover:scale-105'
              }`}
              style={{ backgroundColor: sw.hex }}
            />
          ))}
          <input
            type="color"
            value={player.teamColor}
            onChange={(e) => onUpdate(player.id, { teamColor: e.target.value })}
            className="w-5 h-5 p-0 border-0 rounded bg-transparent cursor-pointer"
            title="Custom team color"
            aria-label="Custom team color"
          />
        </div>
      </div>

      {/* Block Color (shown whenever a live human player holds the Block tool) */}
      {!isZombie && !isCorpse && player.weapon === 'block' && (
        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-white/8">
          <span className="text-[11px] font-medium text-[#B8C0CC]">Block Color</span>
          <div className="flex items-center gap-1.5">
            {PLAYER_BLOCK_SWATCHES.map((sw) => (
              <button
                key={sw.hex}
                type="button"
                title={sw.label}
                aria-label={`Block color ${sw.label}`}
                onClick={() => onUpdate(player.id, { blockColor: sw.hex })}
                className={`w-4 h-4 rounded-sm border transition-transform cursor-pointer ${
                  player.blockColor.toLowerCase() === sw.hex.toLowerCase()
                    ? 'ring-2 ring-[#E05A2B] border-white scale-110'
                    : 'border-white/20 hover:scale-105'
                }`}
                style={{ backgroundColor: sw.hex }}
              />
            ))}
            <input
              type="color"
              value={player.blockColor}
              onChange={(e) => onUpdate(player.id, { blockColor: e.target.value })}
              className="w-5 h-5 p-0 border-0 rounded bg-transparent cursor-pointer"
              title="Custom block color"
              aria-label="Custom block color"
            />
          </div>
        </div>
      )}

      {/* Rotation & Pitch */}
      <div className="space-y-2 pt-1 border-t border-white/8">
        <PanelSlider
          id="player-yaw-slider"
          label="Facing"
          value={player.yaw}
          min={0}
          max={360}
          step={1}
          displayValue={`${Math.round(player.yaw)}°`}
          onChange={(v) => onUpdate(player.id, { yaw: v })}
        />
        {!isCorpse && (
          <PanelSlider
            id="player-pitch-slider"
            label="Aim Pitch"
            value={player.pitch}
            min={-45}
            max={45}
            step={1}
            displayValue={`${player.pitch > 0 ? '+' : ''}${Math.round(player.pitch)}°`}
            onChange={(v) => onUpdate(player.id, { pitch: v })}
          />
        )}
      </div>

      {/* Placement helpers: Move on Map + Snap to Ground */}
      <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-white/8">
        <button
          type="button"
          onClick={() => onToggleMoveOnMap(player.id)}
          aria-pressed={isMovingOnMap}
          className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
            isMovingOnMap ? activeBtn : inactiveBtn
          }`}
          title="Click anywhere on the map to move this model there"
        >
          <Move className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>{isMovingOnMap ? 'Click Map…' : 'Move on Map'}</span>
        </button>
        <button
          type="button"
          onClick={() => onSnapToGround(player.id)}
          className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${inactiveBtn}`}
          title="Drop model directly onto top solid block below"
        >
          <Crosshair className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>Snap Ground</span>
        </button>
      </div>

      {/* Duplicate + Remove */}
      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
        <button
          type="button"
          disabled={!canDuplicate}
          onClick={() => onDuplicate(player.id)}
          className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-[11px] font-semibold whitespace-nowrap transition-colors ${
            canDuplicate
              ? 'border-[#E05A2B]/50 bg-[#E05A2B]/15 text-[#F3F1EC] hover:bg-[#E05A2B]/25 cursor-pointer'
              : 'border-white/10 text-[#6B7280] cursor-not-allowed'
          }`}
          title="Duplicate this model with all current pose, weapon, and color settings"
        >
          <Copy className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>Duplicate</span>
        </button>
        <button
          type="button"
          onClick={() => onRemove(player.id)}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-red-400/25 text-[11px] font-medium text-red-200 hover:bg-red-400/10 whitespace-nowrap transition-colors cursor-pointer"
        >
          <Trash2 className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>Remove</span>
        </button>
      </div>
    </div>
  );
}
