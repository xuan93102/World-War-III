// Regressions for the bugs the audit turned up.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { BASTION_BONUS, BUILDINGS, REINFORCED_FORTRESS_HP } from '../buildings';
import { UNITS } from '../units';
import { FOOD_PER_SOLDIER_FULL, FOOD_PER_VEHICLE_FULL, fullRefillCost } from '../supply';

const CORE = 'taipei-1';
const NEXT_DOOR = 'taipei-2';

function newGame() {
  const g = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
  g.state.players.p1.money = 100000;
  g.state.players.p1.food = 100000;
  return g;
}

describe('a queued vehicle holds its population slot', () => {
  it('so a full population refuses the order rather than eating villagers', () => {
    const g = newGame();
    g.state.players.p1.techs.push('mainBattleTank');
    g.startConstruction(CORE, 'arsenal', 'p1');
    g.tick(46);

    const cap = g.economy('p1').populationCap;
    g.queueVehicles(CORE, 'p1', 'tank', 5);
    expect(g.populationRoom('p1'), 'five slots are spoken for').toBe(cap - 5);

    // Fill what's left, then let the tanks arrive.
    g.buyVillagers('p1', 10000);
    const villagers = g.villagerCount('p1');
    g.tick(UNITS.tank.buildSeconds * 5 + 10);

    expect(g.ownGarrisonAt(CORE, 'p1').tank, 'all five delivered').toBe(5);
    expect(g.villagerCount('p1'), 'and nobody was quietly deleted').toBe(villagers);
    expect(g.population('p1')).toBeLessThanOrEqual(cap);
  });

  it('refuses a batch there is no room for', () => {
    const g = newGame();
    g.state.players.p1.techs.push('mainBattleTank');
    g.startConstruction(CORE, 'arsenal', 'p1');
    g.tick(46);
    g.buyVillagers('p1', 10000);
    expect(g.buildVehicleRejection(CORE, 'p1', 'tank', 1)).toBe('noPopulationRoom');
  });
});

describe('an assault order has to be one the army can carry out', () => {
  it('is refused for a stack that cannot deal damage', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    g.state.legions.push({
      id: 'eyes',
      playerId: 'p1',
      units: { scout: 2 },
      supply: 1,
      regionId: NEXT_DOOR,
    });
    expect(g.assaultRejection(NEXT_DOOR, 'p1'), 'scouts have no teeth').toBe('unarmed');
    expect(g.assault(NEXT_DOOR, 'p1')).toBe(false);
    expect(g.battleAt(NEXT_DOOR), 'no doomed fight started').toBeUndefined();

    // One soldier with them is enough to make it a real order.
    g.legionsAt(NEXT_DOOR).find((l) => l.playerId === 'p1')!.units.militia = 5;
    expect(g.assaultRejection(NEXT_DOOR, 'p1')).toBe(null);
  });
});

describe('what a refill costs', () => {
  it('charges a machine ten times a soldier, per §7', () => {
    expect(fullRefillCost({ militia: 10 })).toBe(10 * FOOD_PER_SOLDIER_FULL);
    expect(fullRefillCost({ tank: 3 })).toBe(3 * FOOD_PER_VEHICLE_FULL);
    expect(fullRefillCost({ mortar: 1, militia: 5 })).toBe(
      FOOD_PER_VEHICLE_FULL + 5 * FOOD_PER_SOLDIER_FULL,
    );
    // A scout is a person, not a machine.
    expect(fullRefillCost({ scout: 2 })).toBe(2 * FOOD_PER_SOLDIER_FULL);
  });

  it('spends that much out of a fortress store', () => {
    const g = newGame();
    const legion = {
      id: 'armour',
      playerId: 'p1',
      units: { tank: 3 },
      supply: 0,
      regionId: CORE,
    };
    g.state.legions.push(legion);
    g.state.regions[CORE].building = { type: 'fortress', hp: 1000, stock: 1000 };

    g.tick(1);
    expect(legion.supply, 'filled').toBe(1);
    expect(
      g.state.regions[CORE].building!.stock,
      'three tanks cost 300, not 30',
    ).toBe(1000 - 3 * FOOD_PER_VEHICLE_FULL);
  });

  it('leaves a cart able to fill five tanks and no more', () => {
    // A cart carries 500 food, so it tops up five machines from empty.
    expect(fullRefillCost({ tank: 5 })).toBe(500);
  });
});

describe('the fortress techs', () => {
  function withFortress(g: GameEngine) {
    g.state.players.p1.techs.push('fieldworks');
    g.setRegionOwner(NEXT_DOOR, 'p1');
    g.startConstruction(NEXT_DOOR, 'fortress', 'p1');
    g.tick(61);
    return g;
  }

  it('build a tougher fortress once 關隘強化 is in', () => {
    const plain = withFortress(newGame());
    expect(plain.state.regions[NEXT_DOOR].building!.hp).toBe(BUILDINGS.fortress.hp);

    const g = newGame();
    g.state.players.p1.techs.push('reinforcedFortress');
    withFortress(g);
    expect(g.state.regions[NEXT_DOOR].building!.hp).toBe(REINFORCED_FORTRESS_HP);
  });

  it('make troops on their own fortress hit harder and take less', () => {
    const g = withFortress(newGame());
    g.state.players.p1.techs.push('bastionWorks');
    g.state.legions.push({
      id: 'garrison',
      playerId: 'p1',
      units: { militia: 20 },
      supply: 1,
      regionId: NEXT_DOOR,
    });
    // p2 attacks into it, so p1 is the defender standing on their own bastion.
    g.state.players.p2.money = 1000;
    g.setRegionOwner('taipei-3', 'p2');
    g.state.legions.push({
      id: 'attackers',
      playerId: 'p2',
      units: { militia: 20 },
      supply: 1,
      regionId: 'taipei-3',
    });
    g.startMarch('taipei-3', NEXT_DOOR, 'p2', { militia: 20 });
    g.tick(g.marchSeconds('taipei-3', NEXT_DOOR, 'p2') + 1);

    const battle = g.battleAt(NEXT_DOOR)!;
    expect(battle.defenderId).toBe('p1');
    const attackersBefore = 20;
    g.tick(5);

    // The defenders deal 20 × 1.2 = 24, so two attackers die instead of one…
    const attackersLeft = g.battleAt(NEXT_DOOR)?.attackerUnits.militia ?? 0;
    expect(attackersBefore - attackersLeft, 'bastion bonus on the way out').toBe(2);
    // …and take 20 × 0.8 = 16, which kills one of them instead of two.
    expect(g.ownGarrisonAt(NEXT_DOOR, 'p1').militia, 'and on the way in').toBe(19);
    expect(BASTION_BONUS).toBe(0.2);
  });
});
