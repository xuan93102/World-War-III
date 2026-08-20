import { totalUnits, type UnitCounts } from './units';
import type { GameMap } from './maps';

/**
 * March timing (docs/game-design.md 8). Everything moves region to region over
 * time rather than teleporting — that time is what later makes interception,
 * ambushed supply lines and reinforcements arriving mid-battle possible.
 */

/** Infantry, one flat hop. */
export const MARCH_SECONDS_PER_HOP = 20;
/**
 * Crossing the Central Mountain Range, once 山地公路 is researched. Thirty
 * times the flat cost: the ridge is meant to be a real decision, not a
 * slightly longer road.
 */
export const MARCH_SECONDS_VIA_PASS = 600;

export type MarchRejection =
  | 'notOwner'
  | 'notAdjacent'
  | 'noUnits'
  | 'passLocked'
  | 'contested'
  /** An enemy fortress stands on the ground they're on: nothing leaves it. */
  | 'fortressHolds'
  | 'noRoute';

/** Seconds for one hop between two adjacent regions. */
export function marchSeconds(map: GameMap, from: string, to: string): number {
  return map.isPass(from, to) ? MARCH_SECONDS_VIA_PASS : MARCH_SECONDS_PER_HOP;
}

export function areAdjacent(map: GameMap, from: string, to: string): boolean {
  return map.region(from).neighbors.includes(to);
}

/**
 * Whether a hop is legal on the ground alone — ownership and troop checks live
 * in the engine, which is the thing that knows who holds what.
 */
export function terrainRejection(
  map: GameMap,
  from: string,
  to: string,
  /** Whether this player has researched 山地公路 (docs 3.2 / 11). */
  hasRoad: boolean,
): MarchRejection | null {
  if (!areAdjacent(map, from, to)) return 'notAdjacent';
  if (map.isPass(from, to) && !hasRoad) return 'passLocked';
  return null;
}

/**
 * Shortest route between two regions, as the list of regions to enter in
 * order (excluding `from`, including `to`). Returns null when no legal route
 * exists.
 *
 * A multi-hop march is a *sequence of single hops* — the army genuinely enters
 * each region on the way rather than skipping from end to end. That's what
 * gives interception something to bite on: an enemy parks on your route and
 * your column walks into them. Without real intermediate stops there'd be
 * nowhere to stand to intercept.
 *
 * `canEnter` and `canCross` are supplied by the engine, which is the thing
 * that knows who holds what.
 */
export function findPath(
  map: GameMap,
  from: string,
  to: string,
  canEnter: (regionId: string) => boolean,
  canCross: (a: string, b: string) => boolean,
): string[] | null {
  if (from === to) return null;
  const cameFrom = new Map<string, string>();
  const seen = new Set<string>([from]);
  let frontier = [from];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbor of map.region(current).neighbors) {
        if (seen.has(neighbor)) continue;
        if (!canCross(current, neighbor)) continue;
        // The destination doesn't have to be enterable — marching onto ground
        // someone else holds is an *attack*, which is a legal order. Only the
        // regions passed through on the way have to be clear, so a route never
        // starts a fight the player didn't ask for.
        if (neighbor !== to && !canEnter(neighbor)) continue;
        seen.add(neighbor);
        cameFrom.set(neighbor, current);
        if (neighbor === to) {
          const route = [to];
          let step = to;
          while (cameFrom.get(step) !== from) {
            step = cameFrom.get(step)!;
            route.unshift(step);
          }
          return route;
        }
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return null;
}

/** Subtracts one stack from another, floored at zero per unit type. */
export function subtractUnits(from: UnitCounts, take: UnitCounts): UnitCounts {
  const out: UnitCounts = { ...from };
  for (const [type, n] of Object.entries(take) as [keyof UnitCounts, number][]) {
    const left = (out[type] ?? 0) - n;
    if (left > 0) out[type] = left;
    else delete out[type];
  }
  return out;
}

/** Merges one stack into another. */
export function addUnits(into: UnitCounts, extra: UnitCounts): UnitCounts {
  const out: UnitCounts = { ...into };
  for (const [type, n] of Object.entries(extra) as [keyof UnitCounts, number][]) {
    if (n > 0) out[type] = (out[type] ?? 0) + n;
  }
  return out;
}

/** True when `stack` holds at least every unit named in `want`. */
export function stackContains(stack: UnitCounts, want: UnitCounts): boolean {
  if (totalUnits(want) <= 0) return false;
  return (Object.entries(want) as [keyof UnitCounts, number][]).every(
    ([type, n]) => n <= 0 || (stack[type] ?? 0) >= n,
  );
}
