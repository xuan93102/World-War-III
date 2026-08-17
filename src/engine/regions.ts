import type { GameState } from './types';
import type { UnitCounts } from './units';

/**
 * The troops standing in a region — a neutral garrison on unclaimed land, or
 * the owner's stationed units on held land.
 *
 * The single place anything outside the engine asks "who's standing here?", so
 * that where those troops are actually stored stays the engine's business.
 */
export function garrisonAt(state: GameState, regionId: string): UnitCounts {
  return state.regions[regionId].units;
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
