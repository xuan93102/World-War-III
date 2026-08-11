import type { TranslationKey } from '../settings/translations';

export type UnitType = 'militia' | 'conscript' | 'volunteer' | 'marine';

export interface UnitDef {
  type: UnitType;
  nameKey: TranslationKey;
  atk: number;
  hp: number;
  /** Gold to train a fresh one, or null if this tier is upgrade-only. */
  trainCost: number | null;
  /** Where a fresh one can be trained. */
  trainAt: 'core' | 'academy' | null;
  /** The tier this one is upgraded from, if any. */
  upgradeFrom: UnitType | null;
  /** Gold to upgrade one unit from `upgradeFrom`. */
  upgradeCost: number | null;
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
  },
};

export const UNIT_ORDER: UnitType[] = ['militia', 'conscript', 'volunteer', 'marine'];

/** Every unit takes one population slot, whatever its tier. */
export const POPULATION_PER_UNIT = 1;

export type UnitCounts = Partial<Record<UnitType, number>>;

export function totalUnits(counts: UnitCounts | undefined): number {
  if (!counts) return 0;
  return UNIT_ORDER.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
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
