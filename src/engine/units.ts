import { VILLAGER_COST } from './buildings';
import type { TranslationKey } from '../settings/translations';

export type UnitType =
  /**
   * The economy, on legs (docs 4.1). A villager is a person before it is a
   * number: it is trained at the core, it walks, and an enemy column will
   * cut it down. Being in UnitCounts is what gives it all of that for free.
   */
  | 'villager'
  | 'militia'
  | 'conscript'
  | 'volunteer'
  | 'marine'
  // Mechanised units (docs/game-design.md 6.5). They live in the same stacks
  // as infantry, so marching, legions, supply and combat take them without
  // special cases — what differs is where they're made, how fast they move,
  // and that they can shoot without closing.
  | 'tank'
  | 'mortar'
  /** Eyes, not troops (docs 9.2): fast, unarmed, and unseen until looked for. */
  | 'scout';

export interface UnitDef {
  type: UnitType;
  nameKey: TranslationKey;
  atk: number;
  hp: number;
  /** Gold to train a fresh one, or null if this tier is upgrade-only. */
  trainCost: number | null;
  /** Where a fresh one can be trained. */
  trainAt: 'core' | 'academy' | 'arsenal' | null;
  /** The tier this one is upgraded from, if any. */
  upgradeFrom: UnitType | null;
  /** Gold to upgrade one unit from `upgradeFrom`. */
  upgradeCost: number | null;
  /**
   * Movement speed as a fraction of an infantryman's (docs 6.5). A column
   * moves at its slowest unit's pace, so a tank slows everything it travels
   * with. Infantry are 1.
   */
  speed: number;
  /**
   * How many regions away this unit can shell a target without moving in and
   * without being shot back at (docs 6.5). 0 for anything that has to close.
   */
  range: number;
  /**
   * Seconds to produce one, whether it's a militiaman at the core or a tank
   * at the arsenal (docs 6.1, 6.5). Nothing appears the instant it's paid for.
   */
  buildSeconds: number;
  /** Seconds to upgrade one from `upgradeFrom`, if it can be upgraded. */
  upgradeSeconds: number;
  /** Tech that has to be researched before it can be built at all. */
  requiresTech: 'mainBattleTank' | 'mortarCorps' | 'scouts' | null;
  /**
   * Invisible to other players until they research 反偵察技術 (docs 9.2).
   * Only scouts are.
   */
  hidden?: boolean;
  /**
   * How much of this unit's attack counts against something built (docs
   * 6.6). Defaults to all of it; militia bring half, because a mob with
   * small arms is not a way to take down a building, and letting it be one
   * made militia the only unit anybody needed.
   */
  siegeMultiplier?: number;
}

/**
 * Units cost gold and occupy population, but do NOT consume villagers — a
 * soldier is extra headcount, not a villager who changed jobs. The squeeze is
 * that villagers and troops share one population cap, so a bigger army
 * permanently lowers the ceiling on income (docs/game-design.md 6.1).
 *
 * Militia are the exception to the academy rule: they come straight out of
 * the core, which is what lets a side defend itself before it has built any
 * military infrastructure. They're also what garrisons neutral land.
 */
export const UNITS: Record<UnitType, UnitDef> = {
  villager: {
    type: 'villager',
    nameKey: 'unit.villager',
    // No teeth and no hide: a villager caught in the open is a casualty, not
    // a combatant. What it does is earn, and staff what's built.
    atk: 0,
    hp: 1,
    trainCost: VILLAGER_COST,
    trainAt: 'core',
    upgradeFrom: null,
    upgradeCost: null,
    speed: 1,
    range: 0,
    buildSeconds: 0,
    upgradeSeconds: 0,
    requiresTech: null,
  },
  militia: {
    type: 'militia',
    nameKey: 'unit.militia',
    atk: 1,
    hp: 10,
    trainCost: 1,
    trainAt: 'core',
    upgradeFrom: null,
    upgradeCost: null,
    speed: 1,
    range: 0,
    buildSeconds: 5,
    upgradeSeconds: 0,
    requiresTech: null,
    siegeMultiplier: 0.5,
  },
  conscript: {
    type: 'conscript',
    nameKey: 'unit.conscript',
    atk: 10,
    hp: 50,
    trainCost: 2,
    trainAt: 'academy',
    upgradeFrom: null,
    upgradeCost: null,
    speed: 1,
    range: 0,
    buildSeconds: 15,
    upgradeSeconds: 0,
    requiresTech: null,
  },
  volunteer: {
    type: 'volunteer',
    nameKey: 'unit.volunteer',
    atk: 20,
    hp: 100,
    trainCost: null,
    trainAt: null,
    upgradeFrom: 'conscript',
    upgradeCost: 3,
    speed: 1,
    range: 0,
    buildSeconds: 0,
    upgradeSeconds: 20,
    requiresTech: null,
  },
  marine: {
    type: 'marine',
    nameKey: 'unit.marine',
    atk: 50,
    hp: 500,
    trainCost: null,
    trainAt: null,
    upgradeFrom: 'volunteer',
    upgradeCost: 4,
    speed: 1,
    range: 0,
    buildSeconds: 0,
    upgradeSeconds: 30,
    requiresTech: null,
  },
  tank: {
    type: 'tank',
    nameKey: 'unit.tank',
    atk: 15,
    hp: 150,
    trainCost: 12,
    trainAt: 'arsenal',
    upgradeFrom: null,
    upgradeCost: null,
    speed: 0.6,
    range: 1,
    buildSeconds: 180,
    upgradeSeconds: 0,
    requiresTech: 'mainBattleTank',
  },
  scout: {
    type: 'scout',
    nameKey: 'unit.scout',
    // No teeth at all: a scout is a pair of eyes that dies if looked at.
    atk: 0,
    hp: 5,
    trainCost: 30,
    trainAt: 'academy',
    upgradeFrom: null,
    upgradeCost: null,
    speed: 1.5,
    range: 0,
    buildSeconds: 20,
    upgradeSeconds: 0,
    requiresTech: 'scouts',
    hidden: true,
  },
  mortar: {
    type: 'mortar',
    nameKey: 'unit.mortar',
    atk: 30,
    hp: 50,
    trainCost: 8,
    trainAt: 'arsenal',
    upgradeFrom: null,
    upgradeCost: null,
    speed: 0.3,
    range: 2,
    buildSeconds: 120,
    upgradeSeconds: 0,
    requiresTech: 'mortarCorps',
  },
};

/**
 * Casualty order: cheapest first (docs 6.2), machines last.
 *
 * §6.5 sketches proportional losses for mixed stacks, but §6.2 rules that out
 * deliberately — spreading damage evenly evaporates the elites along with the
 * chaff and hollows out the upgrade tree. Putting vehicles at the end says in
 * numbers what the vehicle rules say in prose: escorted machines are screened,
 * and a mortar caught on its own dies first because it's the only thing there.
 */
export const UNIT_ORDER: UnitType[] = [
  // First to fall: a stack loses its civilians before it loses a soldier.
  'villager',
  'militia',
  'conscript',
  'volunteer',
  'marine',
  'tank',
  'mortar',
  // Last of all: the scout is worthless in a fight, so it's the last thing a
  // stack loses — and the first when it's travelling alone.
  'scout',
];

/** Nobody who fights: civilians travel in the same stacks but aren't troops. */
export function isCivilian(type: UnitType): boolean {
  return type === 'villager';
}

/** The fighting part of a stack — what an army is, minus the people it carries. */
export function troopsOnly(counts: UnitCounts | undefined): UnitCounts {
  if (!counts) return {};
  const out: UnitCounts = {};
  for (const type of UNIT_ORDER) {
    if (!isCivilian(type) && (counts[type] ?? 0) > 0) out[type] = counts[type];
  }
  return out;
}

/** Built at the arsenal rather than trained (docs 6.5). */
export const VEHICLE_TYPES: UnitType[] = ['tank', 'mortar'];

export function isVehicle(type: UnitType): boolean {
  return UNITS[type].trainAt === 'arsenal';
}

/** Every unit takes one population slot, whatever its tier. */
export const POPULATION_PER_UNIT = 1;

export type UnitCounts = Partial<Record<UnitType, number>>;

export function totalUnits(counts: UnitCounts | undefined): number {
  if (!counts) return 0;
  return UNIT_ORDER.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
}

/** A column moves at its slowest unit's pace (docs 6.5). */
export function stackSpeed(counts: UnitCounts | undefined): number {
  if (!counts) return 1;
  // The slowest thing present sets the pace — which cuts both ways: a lone
  // scout outruns infantry, and one walking with them doesn't.
  let slowest = Infinity;
  for (const type of UNIT_ORDER) {
    if ((counts[type] ?? 0) > 0) slowest = Math.min(slowest, UNITS[type].speed);
  }
  return Number.isFinite(slowest) ? slowest : 1;
}

/** Attack of the units in a stack that can shell something `hops` away. */
export function rangedAtk(counts: UnitCounts | undefined, hops: number): number {
  if (!counts) return 0;
  return UNIT_ORDER.reduce(
    (sum, type) => (UNITS[type].range >= hops ? sum + (counts[type] ?? 0) * UNITS[type].atk : sum),
    0,
  );
}

/** Combined attack of a stack. */
export function stackAtk(counts: UnitCounts | undefined): number {
  if (!counts) return 0;
  return UNIT_ORDER.reduce((sum, type) => sum + (counts[type] ?? 0) * UNITS[type].atk, 0);
}

/**
 * What a stack is worth against a building or a core (docs 6.6), as opposed
 * to against people. Not everything that can kill a man can bring down a wall.
 */
export function siegeAtk(counts: UnitCounts | undefined): number {
  if (!counts) return 0;
  return UNIT_ORDER.reduce(
    (sum, type) =>
      sum + (counts[type] ?? 0) * UNITS[type].atk * (UNITS[type].siegeMultiplier ?? 1),
    0,
  );
}

/** Combined hit points of a stack. */
export function stackHp(counts: UnitCounts | undefined): number {
  if (!counts) return 0;
  return UNIT_ORDER.reduce((sum, type) => sum + (counts[type] ?? 0) * UNITS[type].hp, 0);
}
