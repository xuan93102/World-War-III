/**
 * How many models stand for how many troops (docs/game-design.md 6.1).
 *
 * Three sizes, because a model per soldier would be unreadable long before it
 * was accurate, and one model for any number says nothing at all. Where the
 * steps fall is the part a player actually reads a board by, so it lives
 * apart from the artwork that draws it.
 */
export type Tier = 1 | 2 | 3;

/**
 * Infantry arrives in tens — ten is a squad worth looking at, thirty is a
 * force that decides a region — while armour is expensive enough that two is
 * already something and eight is an armoured push.
 */
export const INFANTRY_STEPS: [number, number] = [10, 30];
export const VEHICLE_STEPS: [number, number] = [3, 8];

/**
 * Villagers step later than soldiers because there are simply more of them:
 * they are bought in tens and a healthy economy runs on a hundred. Twenty is
 * a working crowd, sixty is a labour force.
 */
export const VILLAGER_STEPS: [number, number] = [20, 60];

export function tierFor(count: number, [middle, large]: [number, number]): Tier {
  if (count >= large) return 3;
  if (count >= middle) return 2;
  return 1;
}
