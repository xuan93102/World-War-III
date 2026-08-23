import { getMap, DEFAULT_MAP_ID } from '../engine/maps';

/**
 * The island, very faintly, behind the menus.
 *
 * A menu on a black field could belong to any game. This one is played on a
 * real place, and the shape of that place is already in the project — so the
 * cheapest way to say what the game is, is to show it. It is drawn dim enough
 * to read as texture rather than content, and marked aria-hidden because it
 * says nothing a screen reader needs.
 */
export function MapSilhouette({ mapId = DEFAULT_MAP_ID }: { mapId?: string }) {
  const map = getMap(mapId);
  const viewBox = [
    map.bounds.minX,
    map.bounds.minY,
    map.bounds.maxX - map.bounds.minX,
    map.bounds.maxY - map.bounds.minY,
  ].join(' ');

  return (
    <svg className="map-silhouette" viewBox={viewBox} aria-hidden="true" focusable="false">
      <g className="map-silhouette-regions">
        {map.regions.map((region) => (
          <path key={region.id} d={region.path} />
        ))}
      </g>
    </svg>
  );
}
