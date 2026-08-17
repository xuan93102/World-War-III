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
 * Where a player's troops hold their supply instead of burning it: any region
 * they own, plus GRANARY_SUPPLY_HOPS beyond each of their granaries.
 *
 * Own territory is safe by itself, so supply only bites on an expedition —
 * standing on neutral or enemy ground. A granary near the border is what
 * pushes the zone past your own borders, buying an offensive some room.
 *
 * Walks outward from each granary rather than measuring every region's
 * distance, since this runs every tick and the radius is small.
 */
export function logisticsZone(
  map: GameMap,
  regions: Record<string, RegionState>,
  playerId: string,
): Set<string> {
  const zone = new Set<string>();

  for (const [id, region] of Object.entries(regions)) {
    if (region.owner === playerId) zone.add(id);
  }

  for (const [id, region] of Object.entries(regions)) {
    if (region.owner !== playerId || region.building?.type !== 'granary') continue;

    // Bounded flood fill from the granary. Ground anyone can reach counts —
    // the zone is about how far supply can be carried, not about who holds
    // the intervening land.
    let frontier = [id];
    for (let hop = 0; hop < GRANARY_SUPPLY_HOPS; hop++) {
      const next: string[] = [];
      for (const at of frontier) {
        for (const neighbor of map.region(at).neighbors) {
          if (zone.has(neighbor)) continue;
          zone.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
  }

  return zone;
}

/**
 * Supply after `minutes` spent in or out of the zone, clamped to 0..1.
 */
export function nextSupply(supply: number, minutes: number, inZone: boolean): number {
  const rate = inZone ? SUPPLY_RECOVER_PER_MIN : -SUPPLY_DRAIN_PER_MIN;
  return Math.min(FULL_SUPPLY, Math.max(0, supply + rate * minutes));
}
