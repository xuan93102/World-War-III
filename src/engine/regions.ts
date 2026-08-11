import { MOUNTAIN_PASSES, REGION_GEOMETRY } from './mapData.generated';
import type { RegionDef } from './types';

export { MOUNTAIN_PASSES };

// Real Ministry-of-Interior boundary data merged into sub-regions and
// adjacency-curated by scripts/build-map-data.mjs — see that script's
// header comment for how the west/east divide is pruned to the 5 named
// mountain passes (docs/game-design.md 3.2) while everything else keeps
// real geographic adjacency.
export const REGIONS: RegionDef[] = REGION_GEOMETRY;

export function isMountainPass(a: string, b: string): boolean {
  return MOUNTAIN_PASSES.some(
    (p) => (p.from === a && p.to === b) || (p.from === b && p.to === a),
  );
}

export function getRegion(id: string): RegionDef {
  const region = REGIONS.find((r) => r.id === id);
  if (!region) throw new Error(`Unknown region id: ${id}`);
  return region;
}
