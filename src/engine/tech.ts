import type { TranslationKey } from '../settings/translations';

/**
 * Core levels and the tech tree (docs/game-design.md 10 and 11).
 *
 * Core level gates which techs can be researched at all; techs then pay out in
 * flat multipliers, unlocks, or raised ceilings. A good many of them point at
 * systems that don't exist yet, so those carry `implemented: false` and can't be started — the same treatment the
 * build menu gives a building whose system isn't built. The tree is complete
 * and browsable either way; nobody spends 400 gold on nothing.
 */

export type TechId =
  // core level 1
  | 'rifles'
  | 'bodyArmour'
  | 'intensiveFarming'
  | 'tradeLaw'
  | 'fieldworks'
  | 'homesteadAct'
  | 'transportCorps1'
  // core level 2
  | 'mortarCorps'
  | 'autoRifles'
  | 'compositeArmour'
  | 'consumerIndustry'
  | 'financialCentre'
  | 'conscriptionDrive'
  | 'reinforcedFortress'
  | 'mountainRoad'
  | 'roadNetwork'
  | 'rapidReaction'
  | 'siegeMunitions'
  | 'scouts'
  | 'counterRecon'
  | 'townExpansion'
  | 'transportCorps2'
  // core level 3
  | 'mainBattleTank'
  | 'traverseWorks'
  | 'apMunitions'
  | 'reactiveArmour'
  | 'bastionWorks'
  | 'drones'
  | 'arsenalExpansion'
  | 'urbanisation';

export interface TechDef {
  id: TechId;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  /** Core level required to research it. */
  coreLevel: 1 | 2 | 3;
  costMoney: number;
  seconds: number;
  requires: TechId[];
  /**
   * False while the system the effect targets doesn't exist. Listed in the
   * tree but not researchable, with the reason shown.
   */
  implemented: boolean;
  lockedReasonKey?: TranslationKey;
}


export const TECHS: Record<TechId, TechDef> = {
  // ---- core level 1 ----
  rifles: {
    id: 'rifles', nameKey: 'tech.rifles', descKey: 'tech.rifles.desc',
    coreLevel: 1, costMoney: 150, seconds: 90, requires: [], implemented: true,
  },
  bodyArmour: {
    id: 'bodyArmour', nameKey: 'tech.bodyArmour', descKey: 'tech.bodyArmour.desc',
    coreLevel: 1, costMoney: 150, seconds: 90, requires: [], implemented: true,
  },
  intensiveFarming: {
    id: 'intensiveFarming', nameKey: 'tech.intensiveFarming', descKey: 'tech.intensiveFarming.desc',
    coreLevel: 1, costMoney: 120, seconds: 70, requires: [], implemented: true,
  },
  tradeLaw: {
    id: 'tradeLaw', nameKey: 'tech.tradeLaw', descKey: 'tech.tradeLaw.desc',
    coreLevel: 1, costMoney: 120, seconds: 70, requires: [], implemented: true,
  },
  fieldworks: {
    id: 'fieldworks', nameKey: 'tech.fieldworks', descKey: 'tech.fieldworks.desc',
    coreLevel: 1, costMoney: 100, seconds: 60, requires: [], implemented: true,
  },
  homesteadAct: {
    id: 'homesteadAct', nameKey: 'tech.homesteadAct', descKey: 'tech.homesteadAct.desc',
    coreLevel: 1, costMoney: 150, seconds: 90, requires: [], implemented: true,
  },
  transportCorps1: {
    id: 'transportCorps1', nameKey: 'tech.transportCorps1', descKey: 'tech.transportCorps1.desc',
    coreLevel: 1, costMoney: 120, seconds: 70, requires: [], implemented: true,
  },

  // ---- core level 2 ----
  mortarCorps: {
    id: 'mortarCorps', nameKey: 'tech.mortarCorps', descKey: 'tech.mortarCorps.desc',
    coreLevel: 2, costMoney: 350, seconds: 150, requires: [], implemented: true,
  },
  autoRifles: {
    id: 'autoRifles', nameKey: 'tech.autoRifles', descKey: 'tech.autoRifles.desc',
    coreLevel: 2, costMoney: 400, seconds: 180, requires: ['rifles'], implemented: true,
  },
  compositeArmour: {
    id: 'compositeArmour', nameKey: 'tech.compositeArmour', descKey: 'tech.compositeArmour.desc',
    coreLevel: 2, costMoney: 400, seconds: 180, requires: ['bodyArmour'], implemented: true,
  },
  consumerIndustry: {
    id: 'consumerIndustry', nameKey: 'tech.consumerIndustry', descKey: 'tech.consumerIndustry.desc',
    coreLevel: 2, costMoney: 350, seconds: 160, requires: [], implemented: true,
  },
  financialCentre: {
    id: 'financialCentre', nameKey: 'tech.financialCentre', descKey: 'tech.financialCentre.desc',
    coreLevel: 2, costMoney: 350, seconds: 160, requires: [], implemented: true,
  },
  conscriptionDrive: {
    id: 'conscriptionDrive', nameKey: 'tech.conscriptionDrive', descKey: 'tech.conscriptionDrive.desc',
    coreLevel: 2, costMoney: 350, seconds: 150, requires: [], implemented: true,
  },
  reinforcedFortress: {
    id: 'reinforcedFortress', nameKey: 'tech.reinforcedFortress', descKey: 'tech.reinforcedFortress.desc',
    coreLevel: 2, costMoney: 350, seconds: 150, requires: ['fieldworks'], implemented: true,
  },
  mountainRoad: {
    id: 'mountainRoad', nameKey: 'tech.mountainRoad', descKey: 'tech.mountainRoad.desc',
    coreLevel: 2, costMoney: 450, seconds: 200, requires: ['fieldworks'], implemented: true,
  },
  roadNetwork: {
    id: 'roadNetwork', nameKey: 'tech.roadNetwork', descKey: 'tech.roadNetwork.desc',
    coreLevel: 2, costMoney: 400, seconds: 180, requires: [], implemented: true,
  },
  rapidReaction: {
    id: 'rapidReaction', nameKey: 'tech.rapidReaction', descKey: 'tech.rapidReaction.desc',
    coreLevel: 2, costMoney: 350, seconds: 150, requires: [], implemented: true,
  },
  siegeMunitions: {
    id: 'siegeMunitions', nameKey: 'tech.siegeMunitions', descKey: 'tech.siegeMunitions.desc',
    coreLevel: 2, costMoney: 400, seconds: 180, requires: ['mortarCorps'], implemented: true,
  },
  scouts: {
    id: 'scouts', nameKey: 'tech.scouts', descKey: 'tech.scouts.desc',
    coreLevel: 2, costMoney: 400, seconds: 180, requires: [], implemented: true,
  },
  counterRecon: {
    id: 'counterRecon', nameKey: 'tech.counterRecon', descKey: 'tech.counterRecon.desc',
    coreLevel: 2, costMoney: 350, seconds: 150, requires: ['scouts'], implemented: true,
  },
  townExpansion: {
    id: 'townExpansion', nameKey: 'tech.townExpansion', descKey: 'tech.townExpansion.desc',
    coreLevel: 2, costMoney: 400, seconds: 180, requires: ['homesteadAct'], implemented: true,
  },
  transportCorps2: {
    id: 'transportCorps2', nameKey: 'tech.transportCorps2', descKey: 'tech.transportCorps2.desc',
    coreLevel: 2, costMoney: 350, seconds: 150, requires: ['transportCorps1'], implemented: true,
  },

  // ---- core level 3 ----
  mainBattleTank: {
    id: 'mainBattleTank', nameKey: 'tech.mainBattleTank', descKey: 'tech.mainBattleTank.desc',
    coreLevel: 3, costMoney: 900, seconds: 300, requires: ['mortarCorps'], implemented: true,
  },
  traverseWorks: {
    id: 'traverseWorks', nameKey: 'tech.traverseWorks', descKey: 'tech.traverseWorks.desc',
    coreLevel: 3, costMoney: 1000, seconds: 320, requires: ['mountainRoad'], implemented: true,
  },
  apMunitions: {
    id: 'apMunitions', nameKey: 'tech.apMunitions', descKey: 'tech.apMunitions.desc',
    coreLevel: 3, costMoney: 900, seconds: 300, requires: ['autoRifles'], implemented: true,
  },
  reactiveArmour: {
    id: 'reactiveArmour', nameKey: 'tech.reactiveArmour', descKey: 'tech.reactiveArmour.desc',
    coreLevel: 3, costMoney: 900, seconds: 300, requires: ['compositeArmour'], implemented: true,
  },
  bastionWorks: {
    id: 'bastionWorks', nameKey: 'tech.bastionWorks', descKey: 'tech.bastionWorks.desc',
    coreLevel: 3, costMoney: 900, seconds: 300, requires: ['reinforcedFortress'], implemented: true,
  },
  drones: {
    id: 'drones', nameKey: 'tech.drones', descKey: 'tech.drones.desc',
    coreLevel: 3, costMoney: 850, seconds: 280, requires: ['scouts'], implemented: true,
  },
  arsenalExpansion: {
    id: 'arsenalExpansion', nameKey: 'tech.arsenalExpansion', descKey: 'tech.arsenalExpansion.desc',
    coreLevel: 3, costMoney: 850, seconds: 280, requires: [], implemented: true,
  },
  urbanisation: {
    id: 'urbanisation', nameKey: 'tech.urbanisation', descKey: 'tech.urbanisation.desc',
    coreLevel: 3, costMoney: 900, seconds: 300, requires: ['townExpansion'], implemented: true,
  },
};

export const TECH_ORDER: TechId[] = Object.keys(TECHS) as TechId[];

// ---- core upgrades (docs 11) ----

export const MAX_CORE_LEVEL = 3;

export const CORE_UPGRADE: Record<2 | 3, { costMoney: number; costFood: number; seconds: number }> = {
  2: { costMoney: 800, costFood: 0, seconds: 60 },
  3: { costMoney: 2000, costFood: 0, seconds: 150 },
};

// ---- researchers (docs 10) ----

export const MAX_RESEARCHERS = 10;
/** Seconds to train one, whatever the number already trained. */
export const RESEARCHER_SECONDS = 30;
/** Each one shortens research by this much, so 10 halves it. */
export const RESEARCH_SPEED_PER_RESEARCHER = 0.05;
/** At most this many techs can be in progress at once, across all labs. */
export const RESEARCH_SLOTS = 2;

/** Cost of the next researcher: 50, 80, 110 … 320 for the tenth. */
export function researcherCost(alreadyTrained: number): number {
  return 50 + alreadyTrained * 30;
}

/** Multiplier on research *time* — more researchers means less of it. */
export function researchTimeMultiplier(researchers: number): number {
  return 1 / (1 + researchers * RESEARCH_SPEED_PER_RESEARCHER);
}

// ---- effect lookups ----

/**
 * The attack and armour lines deliberately don't stack: each tier replaces the
 * one below it, so the tree is a ladder to climb rather than a set to collect.
 */
const ATTACK_LADDER: [TechId, number][] = [
  ['apMunitions', 0.35],
  ['autoRifles', 0.2],
  ['rifles', 0.1],
];

const ARMOUR_LADDER: [TechId, number][] = [
  ['reactiveArmour', 0.35],
  ['compositeArmour', 0.2],
  ['bodyArmour', 0.15],
];

function topOfLadder(ladder: [TechId, number][], owned: ReadonlySet<TechId>): number {
  for (const [id, value] of ladder) if (owned.has(id)) return value;
  return 0;
}

/** Damage dealt is scaled by this. */
export function attackMultiplier(owned: ReadonlySet<TechId>): number {
  return 1 + topOfLadder(ATTACK_LADDER, owned);
}

/** Damage received is scaled by this. */
export function damageTakenMultiplier(owned: ReadonlySet<TechId>): number {
  return 1 - topOfLadder(ARMOUR_LADDER, owned);
}

/** Food output multiplier — these two *do* stack with the farm buildings. */
export function foodTechMultiplier(owned: ReadonlySet<TechId>): number {
  return 1 + (owned.has('consumerIndustry') ? 0.25 : 0) + (owned.has('intensiveFarming') ? 0.15 : 0);
}

export function moneyTechMultiplier(owned: ReadonlySet<TechId>): number {
  return 1 + (owned.has('financialCentre') ? 0.25 : 0) + (owned.has('tradeLaw') ? 0.15 : 0);
}

/** Each step of the homestead line is worth this many people. */
export const POPULATION_PER_TECH = 100;

/** The three steps of that line, cheapest first. */
const POPULATION_TECHS: TechId[] = ['homesteadAct', 'townExpansion', 'urbanisation'];

/**
 * Population ceiling from the homestead line.
 *
 * Each step adds, rather than each step replacing the last with a bigger
 * absolute number. The old ladder jumped the ceiling from 200 to 400 to 700 to
 * 1000, which outran what the land could feed and turned the last step into a
 * different game; three even steps of a hundred keep the ceiling somewhere the
 * food supply can follow.
 */
export function populationCapFromTech(owned: ReadonlySet<TechId>, base: number): number {
  const steps = POPULATION_TECHS.filter((id) => owned.has(id)).length;
  return base + steps * POPULATION_PER_TECH;
}

/** Academy training and upgrade time — lower is faster (docs 11, 徵兵效率). */
export function trainTimeMultiplier(owned: ReadonlySet<TechId>): number {
  return owned.has('conscriptionDrive') ? 1 / 1.3 : 1;
}

/** Arsenal build time multiplier — lower is faster (docs 6.5, 軍工擴編). */
export function arsenalTimeMultiplier(owned: ReadonlySet<TechId>): number {
  return owned.has('arsenalExpansion') ? 1 / 1.3 : 1;
}

/** What vehicles do to buildings, scaled by 破城彈藥 (docs 11). */
export function siegeDamageMultiplier(owned: ReadonlySet<TechId>): number {
  return owned.has('siegeMunitions') ? 1.5 : 1;
}

/** Whether vehicles may cross a mountain pass yet (docs 3.2, 橫貫工程). */
export function vehiclesCrossPasses(owned: ReadonlySet<TechId>): boolean {
  return owned.has('traverseWorks');
}

/** Supply carts a player may have on the road at once (docs 7). */
export function supplyCartCap(owned: ReadonlySet<TechId>): number {
  return 1 + (owned.has('transportCorps1') ? 1 : 0) + (owned.has('transportCorps2') ? 1 : 0);
}

/** March time multiplier. Lower is faster. */
export function marchTimeMultiplier(owned: ReadonlySet<TechId>, onOwnGround: boolean): number {
  let speed = 1;
  if (owned.has('roadNetwork')) speed += 0.2;
  if (onOwnGround && owned.has('rapidReaction')) speed += 0.3;
  return 1 / speed;
}
