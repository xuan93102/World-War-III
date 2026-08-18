import type { TranslationKey } from '../settings/translations';

export type UnitType =
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
  /** Seconds to build one at the arsenal; 0 for anything trained on the spot. */
  buildSeconds: number;
  /** Tech that has to be researched before it can be built at all. */
  requiresTech: 'mainBattleTank' | 'mortarCorps' | 'scouts' | null;
  /**
   * Invisible to other players until they research 反偵察技術 (docs 9.2).
   * Only scouts are.
   */
  hidden?: boolean;
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
    buildSeconds: 0,
    requiresTech: null,
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
    buildSeconds: 0,
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
    upgradeCost: 2,
    speed: 1,
    range: 0,
    buildSeconds: 0,
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
    upgradeCost: 3,
    speed: 1,
    range: 0,
    buildSeconds: 0,
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
    buildSeconds: 0,
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

/** Combined hit points of a stack. */
export function stackHp(counts: UnitCounts | undefined): number {
  if (!counts) return 0;
  return UNIT_ORDER.reduce((sum, type) => sum + (counts[type] ?? 0) * UNITS[type].hp, 0);
}
