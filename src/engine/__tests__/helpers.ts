import type { GameEngine } from '../GameEngine';
import { UNITS, type UnitType } from '../units';

/**
 * Trains a batch and waits for it to come off the line.
 *
 * Production takes time now (docs 6.1), so a test that wants troops to exist
 * has to let the clock run. Most tests only want the troops, not the wait, so
 * they say so in one call rather than open-coding the arithmetic.
 */
export function trainNow(
  g: GameEngine,
  regionId: string,
  playerId: string,
  type: UnitType,
  count = 1,
): number {
  const ordered = g.trainUnits(regionId, playerId, type, count);
  if (ordered > 0) g.tick(UNITS[type].buildSeconds * ordered + 1);
  return ordered;
}

/** Upgrades a batch and waits for it to come back to the line. */
export function upgradeNow(
  g: GameEngine,
  regionId: string,
  playerId: string,
  type: UnitType,
  count = 1,
): number {
  const ordered = g.upgradeUnits(regionId, playerId, type, count);
  if (ordered > 0) g.tick(UNITS[type].upgradeSeconds * ordered + 1);
  return ordered;
}

/**
 * Puts villagers on the ground without charging for them.
 *
 * Villagers are units standing somewhere now (docs 4.2), so a test that just
 * wants a population says where it wants one — the core by default, which is
 * where buying them puts them.
 */
export function placeVillagers(
  g: GameEngine,
  playerId: string,
  count: number,
  regionId = g.state.players[playerId].coreRegionId,
): void {
  const legion = g.legionFor(regionId, playerId);
  legion.units.villager = (legion.units.villager ?? 0) + count;
}
