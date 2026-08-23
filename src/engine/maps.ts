import {
  MAP_BOUNDS,
  MOUNTAIN_PASSES,
  MOUNTAIN_RANGE_PATH,
  REGION_GEOMETRY,
} from './mapData.generated';
import { BUILDINGS, type BuildingType } from './buildings';
import type { TranslationKey } from '../settings/translations';
import type { MountainPass, RegionDef } from './types';

/**
 * A playable map: the regions, how they connect, and the terrain that divides
 * them. Taiwan is the first one; the plan is for other parts of the world to
 * follow, so nothing may assume there is only ever one.
 *
 * The lookups and graph searches live on the map itself rather than as free
 * functions over a global. That's what lets a second map exist at all — and it
 * keeps call sites reading as `map.region(id)` instead of threading a map
 * argument through every helper in the engine.
 */
/**
 * The landmark a map's wonder is (docs 5.3).
 *
 * A wonder is the one building that ends a stalemate, and it should look like
 * somewhere rather than like a generic monument — so each map names its own.
 * Taiwan's is Taipei 101; other maps get whatever their own skyline is known
 * for.
 */
export type WonderId = 'taipei101';

export interface MapWonder {
  id: WonderId;
  nameKey: TranslationKey;
}

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GameMap {
  id: string;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  regions: RegionDef[];
  passes: MountainPass[];
  bounds: MapBounds;
  /** The dividing ridge, as an SVG path. Empty when a map has no such divide. */
  ridgePath: string;
  /** What this map's wonder is a picture of, and what to call it. */
  wonder: MapWonder;

  region(id: string): RegionDef;
  isPass(a: string, b: string): boolean;
  /** Fewest hops between two regions, or Infinity if unreachable. */
  distance(fromId: string, toId: string): number;
  regionsAtLeastApart(fromId: string, minDistance: number): string[];
}

interface MapSource {
  id: string;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  regions: RegionDef[];
  passes: MountainPass[];
  bounds: MapBounds;
  ridgePath: string;
  wonder: MapWonder;
}

function createMap(source: MapSource): GameMap {
  const byId = new Map(source.regions.map((r) => [r.id, r]));
  const neighborsById = new Map(source.regions.map((r) => [r.id, r.neighbors]));

  const distance = (fromId: string, toId: string): number => {
    if (fromId === toId) return 0;
    const visited = new Set<string>([fromId]);
    let frontier = [fromId];
    let depth = 0;
    while (frontier.length > 0) {
      depth++;
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of neighborsById.get(id) ?? []) {
          if (visited.has(n)) continue;
          if (n === toId) return depth;
          visited.add(n);
          next.push(n);
        }
      }
      frontier = next;
    }
    return Infinity;
  };

  return {
    ...source,
    region(id) {
      const region = byId.get(id);
      if (!region) throw new Error(`Unknown region id: ${id}`);
      return region;
    },
    isPass(a, b) {
      return source.passes.some(
        (p) => (p.from === a && p.to === b) || (p.from === b && p.to === a),
      );
    },
    distance,
    regionsAtLeastApart(fromId, minDistance) {
      return source.regions
        .filter((r) => r.id !== fromId && distance(fromId, r.id) >= minDistance)
        .map((r) => r.id);
    },
  };
}

// Real Ministry-of-Interior boundary data merged into sub-regions and
// adjacency-curated by scripts/build-map-data.mjs — see that script's header
// comment for how the west/east divide is pruned to the 5 named mountain
// passes (docs/game-design.md 3.2) while everything else keeps real
// geographic adjacency.
export const TAIWAN: GameMap = createMap({
  id: 'taiwan',
  nameKey: 'pve.map.taiwan',
  descKey: 'pve.map.taiwanDesc',
  regions: REGION_GEOMETRY,
  passes: MOUNTAIN_PASSES,
  bounds: MAP_BOUNDS,
  ridgePath: MOUNTAIN_RANGE_PATH,
  wonder: { id: 'taipei101', nameKey: 'wonder.taipei101' },
});

export const MAPS: GameMap[] = [TAIWAN];
export const DEFAULT_MAP_ID = TAIWAN.id;

/**
 * What to call a building on this map. Everything is the same everywhere
 * except the wonder, which is a particular building in a particular city.
 */
export function buildingNameKey(map: GameMap, type: BuildingType): TranslationKey {
  return type === 'wonder' ? map.wonder.nameKey : BUILDINGS[type].nameKey;
}

export function getMap(id: string): GameMap {
  const map = MAPS.find((m) => m.id === id);
  if (!map) throw new Error(`Unknown map id: ${id}`);
  return map;
}
