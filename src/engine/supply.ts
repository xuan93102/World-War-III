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

// ---- supply carts (docs 7) ----------------------------------------------

/** Food a cart carries out of the granary. v1 draft. */
export const CART_FOOD_LOAD = 500;
/** Food to take one soldier from empty to full. §7's 每名士兵10糧食. */
export const FOOD_PER_SOLDIER_FULL = 10;

/** A cart with nobody pulling it. */
export const CART_BASE_HOP_SECONDS = 70;
/** However many porters you pile on, a cart never beats this. */
export const CART_MIN_HOP_SECONDS = 30;
/** Each porter cuts the remaining time by this much — §7's 遞減. */
const CART_PORTER_SPEEDUP = 0.03;

/**
 * Seconds a cart takes per hop with this many porters. Multiplicative, so the
 * tenth porter helps less than the first, and the floor is reached rather than
 * crossed (28 porters gets you there; more is waste).
 */
export function cartHopSeconds(porters: number): number {
  const time = CART_BASE_HOP_SECONDS * (1 - CART_PORTER_SPEEDUP) ** Math.max(0, porters);
  return Math.max(CART_MIN_HOP_SECONDS, Math.round(time));
}

/** Food needed to take this many soldiers from `supply` up to full. */
export function refillCost(soldiers: number, supply: number): number {
  return FOOD_PER_SOLDIER_FULL * soldiers * Math.max(0, FULL_SUPPLY - supply);
}

/**
 * Spends what food there is on refilling an army, and says how far it got.
 * A part-load buys a proportional part of the bar — a cart that can't fill
 * a 300-strong legion still helps it.
 */
export function refillFrom(
  food: number,
  soldiers: number,
  supply: number,
): { supply: number; spent: number } {
  const needed = refillCost(soldiers, supply);
  if (needed <= 0 || soldiers <= 0) return { supply, spent: 0 };
  const spent = Math.min(food, needed);
  return { supply: supply + (FULL_SUPPLY - supply) * (spent / needed), spent };
}

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
