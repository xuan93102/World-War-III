import type { GameMap } from '../engine/maps';
import { useSettings } from '../settings/useSettings';
import { THEMES } from '../settings/types';

interface MapPickerProps {
  /** The map to draw and pick a starting region from. */
  map: GameMap;
  selectedId: string | null;
  /** Regions that can't be picked (no valid opponent placement). */
  disabledIds: Set<string>;
  onSelect: (regionId: string) => void;
  /** Highlighted in the opponent's colour, e.g. the auto-placed AI core. */
  opponentId?: string | null;
  playerColor: string;
  opponentColor: string;
}

const PADDING = 12;

export function MapPicker({
  map,
  selectedId,
  disabledIds,
  onSelect,
  opponentId,
  playerColor,
  opponentColor,
}: MapPickerProps) {
  const { settings } = useSettings();
  const colors = THEMES[settings.theme];
  // Derived per map rather than once per module — each map has its own extent.
  const viewBox = [
    map.bounds.minX - PADDING,
    map.bounds.minY - PADDING,
    map.bounds.maxX - map.bounds.minX + PADDING * 2,
    map.bounds.maxY - map.bounds.minY + PADDING * 2,
  ].join(' ');

  return (
    <svg viewBox={viewBox} className="map-picker" role="group" aria-label="map">
      {map.regions.map((region) => {
        const isSelected = region.id === selectedId;
        const isOpponent = region.id === opponentId;
        const isDisabled = disabledIds.has(region.id);
        const fill = isSelected ? playerColor : isOpponent ? opponentColor : colors.neutralRegion;
        return (
          <path
            key={region.id}
            d={region.path}
            fill={fill}
            fillOpacity={isDisabled && !isSelected && !isOpponent ? 0.35 : 1}
            stroke={isSelected || isOpponent ? '#fff' : colors.regionStroke}
            strokeWidth={isSelected || isOpponent ? 2.5 : 0.5}
            onClick={() => onSelect(region.id)}
            style={{ cursor: 'pointer' }}
          >
            <title>{region.name}</title>
          </path>
        );
      })}
      <path
        d={map.ridgePath}
        fill="none"
        stroke="#8b6b4a"
        strokeWidth={2}
        strokeOpacity={0.7}
        pointerEvents="none"
      />
    </svg>
  );
}
