import { MAP_BOUNDS, MOUNTAIN_RANGE_PATH } from '../engine/mapData.generated';
import { REGIONS } from '../engine/regions';
import { useSettings } from '../settings/useSettings';
import { THEMES } from '../settings/types';

interface MapPickerProps {
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
const VIEW_BOX = [
  MAP_BOUNDS.minX - PADDING,
  MAP_BOUNDS.minY - PADDING,
  MAP_BOUNDS.maxX - MAP_BOUNDS.minX + PADDING * 2,
  MAP_BOUNDS.maxY - MAP_BOUNDS.minY + PADDING * 2,
].join(' ');

export function MapPicker({
  selectedId,
  disabledIds,
  onSelect,
  opponentId,
  playerColor,
  opponentColor,
}: MapPickerProps) {
  const { settings } = useSettings();
  const colors = THEMES[settings.theme];

  return (
    <svg viewBox={VIEW_BOX} className="map-picker" role="group" aria-label="map">
      {REGIONS.map((region) => {
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
        d={MOUNTAIN_RANGE_PATH}
        fill="none"
        stroke="#8b6b4a"
        strokeWidth={2}
        strokeOpacity={0.7}
        pointerEvents="none"
      />
    </svg>
  );
}
