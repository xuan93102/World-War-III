import { REGIONS } from './regions';
import { regionDistance } from './pathfinding';

/**
 * Land is graded into four sizes rather than scaled linearly by area: the
 * real regions run from 46 to 7769 projected units (a 167x spread), so a
 * linear mapping would have 埔里魚池仁愛信義 out-producing 中山大同 by 167
 * times. Tiers keep the "bigger land is worth more" intent readable and
 * bounded.
 */
export type LandSize = 'small' | 'medium' | 'large' | 'huge';

const TIER_BOUNDS: [LandSize, number][] = [
  ['small', 250],
  ['medium', 1500],
  ['large', 4000],
];

export function landSizeOf(landArea: number): LandSize {
  for (const [size, upper] of TIER_BOUNDS) {
    if (landArea < upper) return size;
  }
  return 'huge';
}

/**
 * Food per minute by size. Weighted across the actual 63 regions this
 * averages ~4.4/region, close to the flat 4 it replaces, so switching to
 * size-based output doesn't quietly inflate the food economy.
 */
export const FOOD_PER_MIN_BY_SIZE: Record<LandSize, number> = {
  small: 2,
  medium: 4,
  large: 6,
  huge: 9,
};

/**
 * Neutral garrison strength by size, counted in militia. Militia are the only
 * unit that ever garrisons neutral land, and each is ATK 1 / HP 10 — the same
 * profile as a soldier, so taking ground costs meaningfully more troops than
 * the garrison holds.
 */
export const MILITIA_BY_SIZE: Record<LandSize, number> = {
  small: 3,
  medium: 8,
  large: 16,
  huge: 28,
};

/** Militia are ATK 1 / HP 10, identical to a soldier. */
export const MILITIA_ATK = 1;
export const MILITIA_HP = 10;

/**
 * Neutral regions this close to a core start undefended, so each side has
 * room to expand before it can field an army.
 */
export const SAFE_ZONE_HOPS = 1;

/** Region ids within SAFE_ZONE_HOPS of any of `coreIds`. */
export function safeZoneAround(coreIds: string[]): Set<string> {
  const safe = new Set<string>();
  for (const region of REGIONS) {
    for (const core of coreIds) {
      if (regionDistance(core, region.id) <= SAFE_ZONE_HOPS) {
        safe.add(region.id);
        break;
      }
    }
  }
  return safe;
}
