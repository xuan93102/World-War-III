import type { GameMap } from './maps';
import type { RegionState } from './types';

/**
 * Supply (docs/game-design.md 7).
 *
 * An army in the field runs its supply down and fights worse for it; one
 * sitting in friendly logistics territory holds or recovers. That's what puts
 * a price on pushing deep — the further a legion is from a granary, the more
 * the clock works against it.
 */

/** Legions start full. */
export const FULL_SUPPLY = 1;

/** Drain per minute in the field. v1 draft; wants playtest. */
export const SUPPLY_DRAIN_PER_MIN = 0.02;
/** Recovery per minute inside a logistics safe zone. */
export const SUPPLY_RECOVER_PER_MIN = 0.02;

/** Below this a legion deals less damage. */
export const SUPPLY_STRAINED = 0.8;
/** Below this it deals less still, and takes more. */
export const SUPPLY_BROKEN = 0.4;

const STRAINED_ATTACK_PENALTY = 0.2;
/** Stacks on top of the strained penalty, per §7's 疊加. */
const BROKEN_ATTACK_PENALTY = 0.2;
const BROKEN_DAMAGE_TAKEN = 0.4;

/** How far a granary's logistics zone reaches, in hops. */
export const GRANARY_SUPPLY_HOPS = 2;

/** Damage dealt is scaled by this. Stacks with the tech multipliers. */
export function supplyAttackMultiplier(supply: number): number {
  let penalty = 0;
  if (supply < SUPPLY_STRAINED) penalty += STRAINED_ATTACK_PENALTY;
  if (supply < SUPPLY_BROKEN) penalty += BROKEN_ATTACK_PENALTY;
  return Math.max(0, 1 - penalty);
}

/** Damage received is scaled by this. */
export function supplyDamageTakenMultiplier(supply: number): number {
  return supply < SUPPLY_BROKEN ? 1 + BROKEN_DAMAGE_TAKEN : 1;
}

/**
 * What the ground a legion stands on does to its supply:
 *
 * - `recover` — a granary or a farm. Only food you produce puts supply back.
 * - `hold` — the rest of your own land (the core included), and the
 *   GRANARY_SUPPLY_HOPS a granary reaches past your border. Neither drains
 *   nor refills: home keeps an army fed, it doesn't resupply it.
 * - `drain` — everywhere else. Supply only bites on an expedition.
 */
export type SupplyFooting = 'recover' | 'hold' | 'drain';

export interface LogisticsZones {
  recover: Set<string>;
  hold: Set<string>;
}

/**
 * Walks outward from each granary rather than measuring every region's
 * distance, since this runs every tick and the radius is small.
 */
export function logisticsZones(
  map: GameMap,
  regions: Record<string, RegionState>,
  playerId: string,
): LogisticsZones {
  const recover = new Set<string>();
  const hold = new Set<string>();

  for (const [id, region] of Object.entries(regions)) {
    if (region.owner !== playerId) continue;
    const built = region.building?.type;
    if (built === 'granary' || built === 'farm') recover.add(id);
    else hold.add(id);
  }

  for (const [id, region] of Object.entries(regions)) {
    if (region.owner !== playerId || region.building?.type !== 'granary') continue;

    // Ground anyone can reach counts — the reach is about how far supply can
    // be carried, not about who holds the intervening land. That's what makes
    // a granary near the border worth building.
    let frontier = [id];
    for (let hop = 0; hop < GRANARY_SUPPLY_HOPS; hop++) {
      const next: string[] = [];
      for (const at of frontier) {
        for (const neighbor of map.region(at).neighbors) {
          if (recover.has(neighbor) || hold.has(neighbor)) continue;
          hold.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
  }

  return { recover, hold };
}

export function footingAt(zones: LogisticsZones, regionId: string): SupplyFooting {
  if (zones.recover.has(regionId)) return 'recover';
  if (zones.hold.has(regionId)) return 'hold';
  return 'drain';
}

/**
 * Supply after `minutes` standing on that footing, clamped to 0..1.
 */
export function nextSupply(supply: number, minutes: number, footing: SupplyFooting): number {
  const rate =
    footing === 'recover' ? SUPPLY_RECOVER_PER_MIN : footing === 'hold' ? 0 : -SUPPLY_DRAIN_PER_MIN;
  return Math.min(FULL_SUPPLY, Math.max(0, supply + rate * minutes));
}
