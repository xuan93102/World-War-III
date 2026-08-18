import type { GameMap } from './maps';
import type { GameState, PlayerId } from './types';
import { UNITS, totalUnits } from './units';

/**
 * Sight (docs/game-design.md 9).
 *
 * Territory is what you see with: every region you hold shows itself and one
 * hop out, for free. Scouts buy sight of ground you don't hold — they're the
 * only way to watch a neutral region you have no border with.
 *
 * The rule that gives this teeth is in 9.1: you can't shoot at what you can't
 * see, so a mortar's second hop of range is worth nothing without someone
 * forward to spot for it.
 */

/** How far an owned region sees past its own border. */
export const TERRITORY_SIGHT = 1;

export function visibleRegions(
  map: GameMap,
  state: GameState,
  playerId: PlayerId,
  hasDrones = false,
): Set<string> {
  const seen = new Set<string>();
  const add = (regionId: string, hops: number) => {
    seen.add(regionId);
    if (hops <= 0) return;
    for (const neighbor of map.region(regionId).neighbors) seen.add(neighbor);
  };

  for (const [id, region] of Object.entries(state.regions)) {
    if (region.owner === playerId) add(id, TERRITORY_SIGHT);
  }

  // Troops see where they stand — since docs 6.6 an army can be parked on
  // ground it doesn't hold, and an army that couldn't see its own position
  // couldn't attack from it. Scouts are the ones that see *further*, once
  // drones are up.
  const marching = new Set(state.marches.map((m) => m.legionId));
  for (const legion of state.legions) {
    if (legion.playerId !== playerId || marching.has(legion.id)) continue;
    if (totalUnits(legion.units) === 0) continue;
    const scouting = hasDrones && (legion.units.scout ?? 0) > 0;
    add(legion.regionId, scouting ? 1 : 0);
  }

  return seen;
}

/**
 * What `viewer` is allowed to see of another player's stack. Scouts hide in
 * plain sight until 反偵察技術 is researched (docs 9.2) — the counter to a
 * watcher is knowing they're there.
 */
export function unitsVisibleTo(
  units: Record<string, number>,
  ownedByViewer: boolean,
  hasCounterRecon: boolean,
): Record<string, number> {
  if (ownedByViewer || hasCounterRecon) return units;
  const out = { ...units };
  for (const [type, n] of Object.entries(out)) {
    if (UNITS[type as keyof typeof UNITS]?.hidden && n > 0) delete out[type];
  }
  return out;
}
