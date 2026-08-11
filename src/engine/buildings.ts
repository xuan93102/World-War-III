import type { TranslationKey } from '../settings/translations';

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
  | 'wonder';

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
    costMoney: 50,
    costFood: 150,
    buildSeconds: 45,
    hp: 300,
    implemented: true,
  },
  academy: {
    type: 'academy',
    nameKey: 'building.academy',
    descKey: 'building.academy.desc',
    category: 'globalUnlock',
    costMoney: 50,
    costFood: 150,
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
    costMoney: 50,
    costFood: 150,
    buildSeconds: 45,
    hp: 300,
    implemented: false,
    lockedReasonKey: 'building.locked.vehicles',
  },
  school: {
    type: 'school',
    nameKey: 'building.school',
    descKey: 'building.school.desc',
    category: 'local',
    costMoney: 40,
    costFood: 0,
    buildSeconds: 45,
    hp: 250,
    implemented: false,
    lockedReasonKey: 'building.locked.tech',
  },
  research: {
    type: 'research',
    nameKey: 'building.research',
    descKey: 'building.research.desc',
    category: 'local',
    costMoney: 40,
    costFood: 0,
    buildSeconds: 45,
    hp: 250,
    implemented: false,
    lockedReasonKey: 'building.locked.tech',
  },
  fortress: {
    type: 'fortress',
    nameKey: 'building.fortress',
    descKey: 'building.fortress.desc',
    category: 'local',
    costMoney: 80,
    costFood: 300,
    buildSeconds: 60,
    hp: 1000,
    implemented: false,
    lockedReasonKey: 'building.locked.fortress',
  },
  wonder: {
    type: 'wonder',
    nameKey: 'building.wonder',
    descKey: 'building.wonder.desc',
    category: 'local',
    costMoney: 300,
    costFood: 2000,
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
  'wonder',
];

/** Per-building output bonus for the stacking economy trio (5.1). */
export const STACK_BONUS = 0.2;

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
