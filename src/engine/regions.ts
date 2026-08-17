import type { GameState } from './types';
import type { UnitCounts } from './units';

/**
 * The troops standing in a region, whoever they belong to: a neutral garrison
 * on unclaimed land, and every player legion parked here.
 *
 * Ownership is deliberately not consulted. Since capture became a separate
 * action (docs 6.6), an army can stand on ground it doesn't hold — asking the
 * deed who is standing here would make that army invisible.
 *
 * The single place anything outside the engine asks "who's standing here?", so
 * that where those troops are actually stored stays the engine's business.
 */
export function garrisonAt(state: GameState, regionId: string): UnitCounts {
  const region = state.regions[regionId];
  if (!region) return {};

  const marching = new Set(state.marches.map((m) => m.legionId));
  // Unclaimed ground keeps its own militia on the region itself; a player's
  // troops live in legions, which is where their supply bar hangs.
  const combined: UnitCounts = { ...region.units };
  for (const legion of state.legions) {
    if (legion.regionId !== regionId || marching.has(legion.id)) continue;
    for (const [type, n] of Object.entries(legion.units) as [keyof UnitCounts, number][]) {
      if (n > 0) combined[type] = (combined[type] ?? 0) + n;
    }
  }
  return combined;
}

/**
 * Whether the 山地公路 tech (core level 2 — docs/game-design.md 3.2 and 11) has
 * been researched. Until it is, mountain passes are sealed, and the map draws
 * each crossing greyed out to say so.
 *
 * Hard-coded false because the tech system doesn't exist yet (docs 14). This is
 * deliberately the single place anything asks the question: when techs land it
 * becomes a per-player lookup and only this function changes.
 *
 * Map geometry itself lives in maps.ts — a map is a value now, not a global.
 */
export function hasMountainRoad(): boolean {
  return false;
}
