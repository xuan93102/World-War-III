// Supply (docs/game-design.md 7): an army in the field runs down, one in its
// own logistics territory holds, and a hungry army fights worse.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { COMBAT_ROUND_SECONDS } from '../combat';
import { MARCH_SECONDS_PER_HOP } from '../movement';
import {
  FULL_SUPPLY,
  SUPPLY_BROKEN,
  SUPPLY_DRAIN_PER_MIN,
  SUPPLY_RECOVER_PER_MIN,
  SUPPLY_STRAINED,
  footingAt,
  logisticsZones,
  nextSupply,
  supplyAttackMultiplier,
  supplyDamageTakenMultiplier,
} from '../supply';
import { TAIWAN } from '../maps';

const CORE = 'taipei-1';
const NEXT_DOOR = 'taipei-2';

function newGame() {
  return new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
}

/** Trains militia at p1's core and returns their legion. */
function withLegion(g: GameEngine, count = 5) {
  g.state.players.p1.money = 1000;
  g.trainUnits(CORE, 'p1', 'militia', count);
  return g.state.legions.find((l) => l.regionId === CORE)!;
}

describe('penalties', () => {
  it('leaves a well-supplied army alone', () => {
    expect(supplyAttackMultiplier(FULL_SUPPLY)).toBe(1);
    expect(supplyDamageTakenMultiplier(FULL_SUPPLY)).toBe(1);
    expect(supplyAttackMultiplier(SUPPLY_STRAINED), 'exactly at the line is fine').toBe(1);
  });

  it('costs 20% damage once strained', () => {
    expect(supplyAttackMultiplier(SUPPLY_STRAINED - 0.01)).toBeCloseTo(0.8, 5);
    expect(supplyDamageTakenMultiplier(SUPPLY_STRAINED - 0.01), 'armour unaffected yet').toBe(1);
  });

  it('stacks a second penalty, and softens the army, once broken', () => {
    // §7 says the second tier stacks on the first: -20% and -20% again.
    expect(supplyAttackMultiplier(SUPPLY_BROKEN - 0.01)).toBeCloseTo(0.6, 5);
    expect(supplyDamageTakenMultiplier(SUPPLY_BROKEN - 0.01)).toBeCloseTo(1.4, 5);
  });
});

describe('the clock', () => {
  it('drains in the field, holds on own land, refills on food, clamped both ways', () => {
    expect(nextSupply(1, 1, 'drain')).toBeCloseTo(1 - SUPPLY_DRAIN_PER_MIN, 5);
    expect(nextSupply(0.5, 10, 'hold'), 'own land keeps it where it is').toBe(0.5);
    expect(nextSupply(0.5, 1, 'recover')).toBeCloseTo(0.5 + SUPPLY_RECOVER_PER_MIN, 5);
    expect(nextSupply(1, 10, 'recover'), 'never above full').toBe(1);
    expect(nextSupply(0.01, 10, 'drain'), 'never below empty').toBe(0);
  });
});

describe('the logistics zones', () => {
  const footing = (g: GameEngine, regionId: string) =>
    footingAt(logisticsZones(TAIWAN, g.state.regions, 'p1'), regionId);

  it('holds on your own ground, drains off it, before any granary', () => {
    const g = newGame();
    expect(footing(g, CORE), 'the core feeds but does not resupply').toBe('hold');
    expect(footing(g, NEXT_DOOR), 'neutral ground is the field').toBe('drain');
  });

  it('recovers only on the granary or farm itself', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    g.state.players.p1.food = 100000;
    g.startConstruction(CORE, 'granary', 'p1');
    g.setRegionOwner(NEXT_DOOR, 'p1');
    g.startConstruction(NEXT_DOOR, 'farm', 'p1');
    g.tick(46);

    expect(footing(g, CORE), 'the granary').toBe('recover');
    expect(footing(g, NEXT_DOOR), 'the farm').toBe('recover');

    // A third region of ours with nothing on it only holds.
    const bare = TAIWAN.region(CORE).neighbors.find((n) => n !== NEXT_DOOR)!;
    g.setRegionOwner(bare, 'p1');
    expect(footing(g, bare)).toBe('hold');
  });

  it("carries a granary's hold two hops past the border", () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    g.state.players.p1.food = 100000;
    g.startConstruction(CORE, 'granary', 'p1');
    g.tick(46);

    // Two hops out and still neutral: own territory wouldn't reach it, so not
    // draining there is purely the granary's doing.
    const twoOut = TAIWAN.regions.find(
      (r) => TAIWAN.distance(CORE, r.id) === 2 && g.state.regions[r.id].owner === null,
    )!;
    expect(footing(g, twoOut.id), 'within reach, but no food of its own').toBe('hold');

    const far = TAIWAN.regions.find((r) => TAIWAN.distance(CORE, r.id) === 3)!;
    expect(footing(g, far.id), 'three hops is too far').toBe('drain');
  });
});

describe('legions in play', () => {
  it('start full and run down once off friendly ground', () => {
    const g = newGame();
    const legion = withLegion(g);
    expect(legion.supply).toBe(FULL_SUPPLY);

    // Park them on neutral ground. Walking there would capture it, and a
    // captured region is friendly again — the drain only exists in the gap
    // between setting out and taking the place.
    legion.regionId = NEXT_DOOR;
    g.tick(60);
    expect(legion.supply, 'a minute in the field').toBeCloseTo(1 - SUPPLY_DRAIN_PER_MIN, 5);
  });

  it('sit still at home, and refill on a granary', () => {
    const g = newGame();
    const legion = withLegion(g);
    legion.supply = 0.5;
    g.tick(60);
    expect(legion.supply, 'the bare core holds, it does not resupply').toBe(0.5);

    g.state.players.p1.money = 100000;
    g.state.players.p1.food = 100000;
    g.startConstruction(CORE, 'granary', 'p1');
    g.tick(46);
    const after = legion.supply;
    g.tick(60);
    expect(legion.supply, 'now it climbs').toBeCloseTo(after + SUPPLY_RECOVER_PER_MIN, 5);
  });

  it('hand their bar to the column that marches out', () => {
    const g = newGame();
    const garrison = withLegion(g, 5);
    garrison.supply = 0.5;

    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 2 });
    const column = g.state.legions.find((l) => l.id !== garrison.id)!;
    expect(column.supply, 'the column sets out as empty as home was').toBe(0.5);
  });

  it('average by headcount when a column lands on a garrison', () => {
    const g = newGame();
    const home = withLegion(g, 4);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 2 });
    g.tick(MARCH_SECONDS_PER_HOP);

    // Two full-supply militia land on two more; a second wave at half supply
    // should pull the average down proportionally.
    const landed = g.state.legions.find((l) => l.regionId === NEXT_DOOR)!;
    landed.supply = 1;
    home.supply = 0.5;
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 2 });
    g.tick(MARCH_SECONDS_PER_HOP);

    const merged = g.state.legions.find((l) => l.regionId === NEXT_DOOR)!;
    // Supply drifts slightly with the drain over those seconds, so check the
    // relationship rather than an exact figure.
    expect(merged.supply).toBeGreaterThan(0.5);
    expect(merged.supply).toBeLessThan(1);
  });
});

describe('a hungry army fights worse', () => {
  it('deals less damage than a fed one', () => {
    const run = (supply: number) => {
      const g = newGame();
      g.state.regions[NEXT_DOOR].units = { militia: 30 };
      g.state.players.p1.money = 1000;
      g.trainUnits(CORE, 'p1', 'militia', 10);
      g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 10 });
      g.tick(MARCH_SECONDS_PER_HOP);
      g.battleAt(NEXT_DOOR)!.attackerSupply = supply;
      const before = g.garrisonAt(NEXT_DOOR).militia ?? 0;
      g.tick(COMBAT_ROUND_SECONDS);
      return before - (g.garrisonAt(NEXT_DOOR).militia ?? 0);
    };

    // 10 militia deal 10 a round at full supply, which kills one 10hp militia.
    // Broken supply cuts that to 6, which kills none.
    expect(run(FULL_SUPPLY), 'fed').toBe(1);
    expect(run(SUPPLY_BROKEN - 0.01), 'starving').toBe(0);
  });

  it('carries its bar into the fight, and back out on a retreat', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 30 };
    g.state.players.p1.money = 1000;
    g.trainUnits(CORE, 'p1', 'militia', 5);
    g.state.legions.find((l) => l.regionId === CORE)!.supply = 0.6;

    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 5 });
    g.tick(MARCH_SECONDS_PER_HOP);
    const battle = g.battleAt(NEXT_DOOR)!;
    expect(battle.attackerSupply, 'the column arrives as hungry as it left').toBeLessThan(0.61);

    g.tick(COMBAT_ROUND_SECONDS);
    const duringFight = g.battleAt(NEXT_DOOR)!.attackerSupply;
    expect(g.retreat(NEXT_DOOR, 'p1')).toBe(true);
    const withdrawing = g.state.legions.find((l) => l.playerId === 'p1' && l.regionId === NEXT_DOOR)!;
    expect(withdrawing.supply, 'survivors keep what they had').toBeCloseTo(duringFight, 5);
  });
});
