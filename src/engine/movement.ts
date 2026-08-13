import { getRegion, hasMountainRoad, isMountainPass } from './regions';
import { totalUnits, type UnitCounts } from './units';

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
  | 'contested';

/** Seconds for one hop between two adjacent regions. */
export function marchSeconds(from: string, to: string): number {
  return isMountainPass(from, to) ? MARCH_SECONDS_VIA_PASS : MARCH_SECONDS_PER_HOP;
}

export function areAdjacent(from: string, to: string): boolean {
  return getRegion(from).neighbors.includes(to);
}

/**
 * Whether a hop is legal on the ground alone — ownership and troop checks live
 * in the engine, which is the thing that knows who holds what.
 */
export function terrainRejection(from: string, to: string): MarchRejection | null {
  if (!areAdjacent(from, to)) return 'notAdjacent';
  // Sealed until the tech exists (docs 3.2). hasMountainRoad() is the single
  // place that question is asked.
  if (isMountainPass(from, to) && !hasMountainRoad()) return 'passLocked';
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
