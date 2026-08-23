import type { TranslationKey } from '../settings/translations';
import type { TechId } from './tech';

export type BuildingType =
  | 'shop'
  | 'housing'
  | 'farm'
  | 'granary'
  | 'academy'
  | 'arsenal'
  | 'school'
  | 'research'
  | 'fortress'
  /** Dug across a road to be walked into, not looked at (docs 5.3). */
  | 'trench'
  | 'wonder'
  /** A forward depot an army pitches in the field (docs 6.3). */
  | 'camp';

/**
 * Which of the design doc's three categories a building falls into
 * (docs/game-design.md 5.1-5.3):
 *  - globalStack: a % bonus applied to every region you own, stacking
 *  - globalUnlock: unlocks an ability nation-wide; also the sole launch point
 *  - local: only does something in the region it stands in
 */
export type BuildingCategory = 'globalStack' | 'globalUnlock' | 'local';

export interface BuildingDef {
  type: BuildingType;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  category: BuildingCategory;
  costMoney: number;
  costFood: number;
  buildSeconds: number;
  hp: number;
  /**
   * False while the systems a building depends on don't exist yet. Such
   * buildings are listed in the UI but can't be built — putting one down
   * would silently do nothing *and* burn the region's single building slot.
   */
  implemented: boolean;
  lockedReasonKey?: TranslationKey;
  /**
   * A tech that must be researched first. Unlike `implemented: false` this is
   * an in-game gate, not a "we haven't built it" gate — the building is real,
   * you just have to earn it.
   */
  requiresTech?: TechId;
}

// Costs / build times / HP come straight from docs/game-design.md 5.4.
export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  shop: {
    type: 'shop',
    nameKey: 'building.shop',
    descKey: 'building.shop.desc',
    category: 'globalStack',
    costMoney: 30,
    costFood: 0,
    buildSeconds: 30,
    hp: 250,
    implemented: true,
  },
  housing: {
    type: 'housing',
    nameKey: 'building.housing',
    descKey: 'building.housing.desc',
    // Raises the population cap rather than a production rate: population is
    // recruited with gold now, not produced over time.
    category: 'globalStack',
    costMoney: 30,
    costFood: 0,
    buildSeconds: 30,
    hp: 250,
    implemented: true,
  },
  farm: {
    type: 'farm',
    nameKey: 'building.farm',
    descKey: 'building.farm.desc',
    category: 'globalStack',
    costMoney: 30,
    costFood: 0,
    buildSeconds: 30,
    hp: 250,
    implemented: true,
  },
  granary: {
    type: 'granary',
    nameKey: 'building.granary',
    descKey: 'building.granary.desc',
    category: 'globalUnlock',
    costMoney: 200,
    costFood: 0,
    buildSeconds: 45,
    hp: 300,
    implemented: true,
  },
  academy: {
    type: 'academy',
    nameKey: 'building.academy',
    descKey: 'building.academy.desc',
    category: 'globalUnlock',
    costMoney: 200,
    costFood: 0,
    buildSeconds: 45,
    hp: 300,
    // Unlocked now that soldiers exist: this is where every tier above
    // militia is trained and upgraded.
    implemented: true,
  },
  arsenal: {
    type: 'arsenal',
    nameKey: 'building.arsenal',
    descKey: 'building.arsenal.desc',
    category: 'globalUnlock',
    costMoney: 200,
    costFood: 0,
    buildSeconds: 45,
    hp: 300,
    // Unlocked now that vehicles exist: this is where they are built.
    implemented: true,
  },
  school: {
    type: 'school',
    nameKey: 'building.school',
    descKey: 'building.school.desc',
    category: 'local',
    costMoney: 160,
    costFood: 0,
    buildSeconds: 45,
    hp: 250,
    // Unlocked now that research exists: this is where researchers come from.
    implemented: true,
  },
  research: {
    type: 'research',
    nameKey: 'building.research',
    descKey: 'building.research.desc',
    category: 'local',
    costMoney: 160,
    costFood: 0,
    buildSeconds: 45,
    hp: 250,
    // Unlocked now that there is a tech tree to research.
    implemented: true,
  },
  fortress: {
    type: 'fortress',
    nameKey: 'building.fortress',
    descKey: 'building.fortress.desc',
    category: 'local',
    costMoney: 320,
    costFood: 0,
    buildSeconds: 60,
    hp: 1000,
    // A real building gated on research rather than on missing systems.
    implemented: true,
    requiresTech: 'fieldworks',
    lockedReasonKey: 'building.locked.fortress',
  },
  trench: {
    type: 'trench',
    nameKey: 'building.trench',
    descKey: 'building.trench.desc',
    category: 'local',
    costMoney: 100,
    costFood: 0,
    buildSeconds: 30,
    // Tougher than a shed, nothing like a fortress: it is meant to cost an
    // attacker time, not to be impossible.
    hp: 500,
    implemented: true,
  },
  camp: {
    type: 'camp',
    nameKey: 'building.camp',
    descKey: 'building.camp.desc',
    category: 'local',
    costMoney: 60,
    costFood: 0,
    buildSeconds: 20,
    hp: 200,
    implemented: true,
  },
  wonder: {
    type: 'wonder',
    nameKey: 'building.wonder',
    descKey: 'building.wonder.desc',
    category: 'local',
    costMoney: 6000,
    costFood: 1000,
    buildSeconds: 300,
    hp: 2000,
    implemented: true,
  },
};

export const BUILDING_ORDER: BuildingType[] = [
  'shop',
  'housing',
  'farm',
  'granary',
  'academy',
  'arsenal',
  'school',
  'research',
  'fortress',
  'trench',
  'camp',
  'wonder',
];

/** Per-building output bonus for the stacking economy trio (5.1). */
/**
 * How many people a house holds.
 *
 * Flat rather than a percentage. As a multiplier it compounded with the
 * population techs, so the same three houses were worth 40 people early and
 * 200 late — the building's value depended on research it had nothing to do
 * with, and the ceiling ran away from the food supply.
 */
export const HOUSING_POPULATION = 50;

/**
 * What one villager working inside a building is worth (docs 4.2). Ten of
 * them — a full crew — come to STACK_BONUS, so a properly staffed building is
 * worth exactly what a building used to be worth for free.
 */
export const STAFF_BONUS = 0.02;

/** Villagers one building can put to work. */
export const MAX_STAFF = 10;

/**
 * Hit points a villager patches back per second while its building is being
 * knocked down (docs 4.2). Assaults deal atk/COMBAT_ROUND_SECONDS per second,
 * so a full crew shrugs off about 25 points of attack — a raiding party, not
 * an army.
 */
export const STAFF_REPAIR_PER_SECOND = 0.5;

/**
 * Buildings villagers can work in: everything that produces something.
 * Housing is a roof, not a job, and the military buildings are not the
 * economy — the fortress and camp are field works.
 */
export const STAFFABLE: BuildingType[] = ['shop', 'farm', 'granary', 'research', 'school'];

/**
 * Per-building limits, for buildings whose stacking would otherwise run away.
 * Housing raises the population cap, and population *is* the money engine
 * now, so uncapped housing would compound into an unbounded economy.
 */
export const BUILDING_LIMITS: Partial<Record<BuildingType, number>> = {
  housing: 3,
};

/**
 * v1 numbers not specified in the design doc — flagged in section 14 as
 * needing playtest like every other starting value.
 */
export const BASE_FOOD_CAP = 1000;
export const GRANARY_FOOD_CAP = 1000;
/** Gold produced per villager per minute (before shop bonuses). */
export const GOLD_PER_VILLAGER_PER_MIN = 1;
/** Gold cost to recruit one villager. */
export const VILLAGER_COST = 1;
/** How long a finished wonder must be held to win (docs 5.3 / 12). */
export const WONDER_HOLD_SECONDS = 180;
/**
 * The core's own hit points (docs 6.7). It is a building in every sense except
 * that it can't be demolished, replaced or captured — it has to be knocked
 * down, and doing so ends the match.
 */
export const CORE_HP = 5000;

/**
 * A fortress with 關隘強化 researched, per 5.4. Reinforcement is baked in at
 * build time — an already-standing fortress isn't retrofitted.
 */
export const REINFORCED_FORTRESS_HP = 1500;

/**
 * 稜堡工事 (docs 11): troops fighting on their own fortress deal more and take
 * less. A flat area bonus on top of the tech ladders, which are exclusive
 * among themselves. v1 draft — the doc gives no figure.
 */
export const BASTION_BONUS = 0.2;

/** A building's hit points as built, with the owner's research applied. */
export function buildingHp(type: BuildingType, owned: ReadonlySet<TechId>): number {
  if (type === 'fortress' && owned.has('reinforcedFortress')) return REINFORCED_FORTRESS_HP;
  return BUILDINGS[type].hp;
}
