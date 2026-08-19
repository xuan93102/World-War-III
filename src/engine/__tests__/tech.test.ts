// Core levels, researchers and the tech tree (docs/game-design.md 10 and 11).
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import {
  CORE_UPGRADE,
  MAX_RESEARCHERS,
  RESEARCHER_SECONDS,
  RESEARCH_SLOTS,
  TECHS,
  researchTimeMultiplier,
  researcherCost,
} from '../tech';
import { garrisonAt } from '../regions';
import { trainNow } from './helpers';

/** Puts troops on ground `playerId` already holds, as their legion there. */
function station(
  g: GameEngine,
  regionId: string,
  playerId: string,
  units: Record<string, number>,
) {
  g.state.legions = g.state.legions.filter((l) => l.regionId !== regionId);
  g.state.legions.push({
    id: `test-${regionId}`,
    playerId,
    units,
    supply: 1,
    regionId,
  });
}

const CORE = 'taipei-1';
const LAB = 'taipei-2';

function newGame() {
  return new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
}

/** Gives p1 money, a second region, and a finished building of `type` on it. */
function withBuilding(g: GameEngine, type: 'research' | 'school', regionId = LAB) {
  g.state.players.p1.money = 100000;
  g.state.players.p1.food = 100000;
  g.setRegionOwner(regionId, 'p1');
  g.startConstruction(regionId, type, 'p1');
  g.tick(46);
  return g;
}

describe('research prerequisites', () => {
  it('needs a research institute before anything can be studied', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    expect(g.researchRejection('p1', 'rifles')).toBe('needsLab');
    withBuilding(g, 'research');
    expect(g.researchRejection('p1', 'rifles')).toBeNull();
  });

  it('gates higher tiers behind the core level', () => {
    const g = withBuilding(newGame(), 'research');
    expect(g.state.players.p1.coreLevel).toBe(1);
    expect(g.researchRejection('p1', 'roadNetwork'), 'a level 2 tech').toBe('needsCoreLevel');
    g.state.players.p1.coreLevel = 2;
    expect(g.researchRejection('p1', 'roadNetwork')).toBeNull();
  });

  it('enforces prerequisites', () => {
    const g = withBuilding(newGame(), 'research');
    g.state.players.p1.coreLevel = 2;
    expect(g.researchRejection('p1', 'autoRifles'), 'needs rifles first').toBe('needsPrereq');
    g.state.players.p1.techs.push('rifles');
    expect(g.researchRejection('p1', 'autoRifles')).toBeNull();
  });

  it('has nothing left that its system is missing', () => {
    // Every tech in the tree now points at something that exists. When one
    // gets added ahead of its system, this is where it should be listed.
    const unbuilt = Object.values(TECHS).filter((tech) => !tech.implemented);
    expect(unbuilt.map((t) => t.id)).toEqual([]);
  });

  it('allows only two at a time', () => {
    const g = withBuilding(newGame(), 'research');
    expect(g.startResearch('p1', 'rifles')).toBe(true);
    expect(g.startResearch('p1', 'bodyArmour')).toBe(true);
    expect(g.state.players.p1.research).toHaveLength(RESEARCH_SLOTS);
    expect(g.researchRejection('p1', 'tradeLaw')).toBe('slotsFull');
  });

  it('charges up front and delivers when the clock runs out', () => {
    const g = withBuilding(newGame(), 'research');
    const before = g.state.players.p1.money;
    g.startResearch('p1', 'rifles');
    expect(g.state.players.p1.money, 'paid on starting').toBe(before - TECHS.rifles.costMoney);

    g.tick(TECHS.rifles.seconds - 1);
    expect(g.hasTech('p1', 'rifles'), 'not yet').toBe(false);
    g.tick(1);
    expect(g.hasTech('p1', 'rifles'), 'done').toBe(true);
    expect(g.state.players.p1.research, 'queue cleared').toHaveLength(0);
  });
});

describe('researchers', () => {
  it('need a school', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    expect(g.researcherRejection('p1')).toBe('needsSchool');
    withBuilding(g, 'school');
    expect(g.researcherRejection('p1')).toBeNull();
  });

  it('cost more the more you have', () => {
    expect(researcherCost(0), 'the first').toBe(50);
    expect(researcherCost(1)).toBe(80);
    expect(researcherCost(MAX_RESEARCHERS - 1), 'the tenth').toBe(320);
  });

  it('take time, and take a population slot without costing a villager', () => {
    const g = withBuilding(newGame(), 'school');
    g.buyVillagers('p1', 20);
    const villagers = g.villagerCount('p1');
    const population = g.population('p1');

    g.trainResearcher('p1');
    expect(g.villagerCount('p1'), 'villagers untouched').toBe(villagers);
    expect(g.population('p1'), 'but the slot is taken immediately').toBe(population + 1);
    expect(g.state.players.p1.researchers, 'not trained yet').toBe(0);

    g.tick(RESEARCHER_SECONDS);
    expect(g.state.players.p1.researchers).toBe(1);
    expect(g.population('p1'), 'no double count once trained').toBe(population + 1);
  });

  it('shorten research, halving it at ten', () => {
    expect(researchTimeMultiplier(0)).toBe(1);
    expect(researchTimeMultiplier(MAX_RESEARCHERS), 'ten researchers').toBeCloseTo(1 / 1.5, 5);

    const g = withBuilding(newGame(), 'research');
    g.state.players.p1.researchers = MAX_RESEARCHERS;
    g.startResearch('p1', 'rifles');
    expect(g.state.players.p1.research[0].totalSeconds).toBeCloseTo(TECHS.rifles.seconds / 1.5, 5);
  });
});

describe('core upgrades', () => {
  it('cost gold, food and time, then raise the level', () => {
    const g = newGame();
    g.state.players.p1.money = CORE_UPGRADE[2].costMoney;
    g.state.players.p1.food = CORE_UPGRADE[2].costFood;
    expect(g.startCoreUpgrade('p1')).toBe(true);
    expect(g.state.players.p1.money, 'paid').toBe(0);

    g.tick(CORE_UPGRADE[2].seconds - 1);
    expect(g.state.players.p1.coreLevel, 'still level 1').toBe(1);
    g.tick(1);
    expect(g.state.players.p1.coreLevel).toBe(2);
  });

  it('refuses when there is nothing left to upgrade', () => {
    const g = newGame();
    g.state.players.p1.coreLevel = 3;
    expect(g.coreUpgradeRejection('p1')).toBe('maxed');
  });
});

describe('tech effects', () => {
  it('raises the population ceiling', () => {
    const g = newGame();
    const before = g.economy('p1').populationCap;
    g.state.players.p1.techs.push('homesteadAct');
    expect(g.economy('p1').populationCap, '200 -> 400').toBe(400);
    expect(before).toBe(200);

    g.state.players.p1.techs.push('urbanisation');
    expect(g.economy('p1').populationCap, 'the highest wins').toBe(1000);
  });

  it('multiplies gold and food output', () => {
    const g = newGame();
    g.buyVillagers('p1', 10);
    const money = g.economy('p1').moneyPerMin;
    g.state.players.p1.techs.push('tradeLaw');
    expect(g.economy('p1').moneyPerMin).toBeCloseTo(money * 1.15, 5);
    // These two stack with each other, unlike the attack and armour ladders.
    g.state.players.p1.techs.push('financialCentre');
    expect(g.economy('p1').moneyPerMin).toBeCloseTo(money * 1.4, 5);
  });

  it('opens the mountain passes', () => {
    const g = newGame();
    g.state.players.p1.money = 1000;
    g.setRegionOwner('newtaipei-5', 'p1');
    station(g, 'newtaipei-5', 'p1', { militia: 3 });
    expect(g.marchRejection('newtaipei-5', 'yilan-2', 'p1', { militia: 1 })).toBe('passLocked');

    g.state.players.p1.techs.push('mountainRoad');
    expect(g.marchRejection('newtaipei-5', 'yilan-2', 'p1', { militia: 1 })).toBeNull();
  });

  it('speeds up marching, and more so on your own ground', () => {
    const g = newGame();
    g.setRegionOwner(LAB, 'p1');
    const base = g.marchSeconds(CORE, LAB, 'p1');

    g.state.players.p1.techs.push('roadNetwork');
    expect(g.marchSeconds(CORE, LAB, 'p1'), '+20% speed').toBeCloseTo(base / 1.2, 5);

    g.state.players.p1.techs.push('rapidReaction');
    expect(g.marchSeconds(CORE, LAB, 'p1'), 'both apply at home').toBeCloseTo(base / 1.5, 5);
  });

  it('unlocks the fortress once fieldworks is researched', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    g.state.players.p1.food = 100000;
    g.setRegionOwner(LAB, 'p1');
    expect(g.buildRejection(LAB, 'fortress', 'p1')).toBe('notImplemented');

    g.state.players.p1.techs.push('fieldworks');
    expect(g.buildRejection(LAB, 'fortress', 'p1')).toBeNull();
  });

  it('makes troops hit harder without stacking the ladder', () => {
    const g = newGame();
    // A garrisoned neutral region to attack, next door to the core.
    g.state.regions[LAB].units = { militia: 20 };
    g.state.players.p1.money = 1000;
    trainNow(g, CORE, 'p1', 'militia', 10);
    g.state.players.p1.techs.push('rifles', 'autoRifles');
    g.startMarch(CORE, LAB, 'p1', { militia: 10 });
    g.tick(20);
    g.assault(LAB, 'p1');

    const before = garrisonAt(g.state, LAB).militia ?? 0;
    g.tick(5);
    const dealt = before - (garrisonAt(g.state, LAB).militia ?? 0);
    // 10 militia at ATK 1 with +20% (autoRifles replaces rifles, not adds to
    // it) is 12 damage, which kills one 10hp militia and carries 2.
    expect(dealt, 'one casualty from 12 damage').toBe(1);
  });
});
