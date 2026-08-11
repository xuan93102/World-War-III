import { regionsAtLeastApart } from './pathfinding';

/**
 * Minimum hops required between the two starting cores.
 *
 * Calibrated against the actual 63-region graph: mean distance between any
 * two regions is ~4.4 and the map's diameter is only 10. At 6 almost every
 * region still has plenty of legal opponents (~18 on average) while sitting
 * comfortably above the average separation; pushing it to 8 would leave 23
 * regions with no legal opponent at all, and 10 would make the setting
 * essentially unusable.
 */
export const MIN_CORE_DISTANCE = 6;

const cache = new Map<string, string[]>();

/** Regions far enough from `playerCore` to host the opposing core. */
export function validOpponentCores(playerCore: string): string[] {
  let cached = cache.get(playerCore);
  if (!cached) {
    cached = regionsAtLeastApart(playerCore, MIN_CORE_DISTANCE);
    cache.set(playerCore, cached);
  }
  return cached;
}
