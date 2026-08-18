// Mechanised units (docs/game-design.md 6.5): built at an arsenal one at a
// time, slower than infantry, and able to shell a target without closing.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { COMBAT_ROUND_SECONDS } from '../combat';
import { MARCH_SECONDS_PER_HOP } from '../movement';
import { UNITS, stackSpeed, totalUnits } from '../units';

const CORE = 'taipei-1';
const NEXT_DOOR = 'taipei-2';

function newGame() {
  const g = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
  g.state.players.p1.money = 100000;
  g.state.players.p1.food = 100000;
  g.state.players.p1.techs.push('mortarCorps', 'mainBattleTank');
  return g;
}

/** Puts a finished arsenal on p1's core. */
function withArsenal(g: GameEngine) {
  g.startConstruction(CORE, 'arsenal', 'p1');
  g.tick(46);
  return g;
}

describe('building them', () => {
  it('needs an arsenal and the unlocking tech', () => {
    const g = newGame();
    expect(g.buildVehicleRejection(CORE, 'p1', 'tank'), 'no arsenal yet').toBe('needsArsenal');

    withArsenal(g);
    expect(g.buildVehicleRejection(CORE, 'p1', 'tank')).toBe(null);

    g.state.players.p1.techs = ['mortarCorps'];
    expect(g.buildVehicleRejection(CORE, 'p1', 'tank'), 'tanks need their tech').toBe('needsTech');
    expect(g.buildVehicleRejection(CORE, 'p1', 'mortar'), 'mortars have theirs').toBe(null);
  });

  it('charges the whole batch up front and rolls them out one at a time', () => {
    const g = withArsenal(newGame());
    const before = g.state.players.p1.money;
    expect(g.queueVehicles(CORE, 'p1', 'tank', 3)).toBe(true);
    expect(g.state.players.p1.money, 'three tanks paid for').toBe(
      before - UNITS.tank.trainCost! * 3,
    );

    g.tick(UNITS.tank.buildSeconds + 1);
    expect(g.ownGarrisonAt(CORE, 'p1').tank, 'first one out').toBe(1);
    expect(g.state.players.p1.production[0].remaining, 'two still on the slipway').toBe(2);

    g.tick(UNITS.tank.buildSeconds * 2 + 2);
    expect(g.ownGarrisonAt(CORE, 'p1').tank).toBe(3);
    expect(g.state.players.p1.production, 'queue empty').toHaveLength(0);
  });

  it('refunds what has not been built when a batch is cancelled', () => {
    const g = withArsenal(newGame());
    g.queueVehicles(CORE, 'p1', 'mortar', 4);
    g.tick(UNITS.mortar.buildSeconds + 1);
    const money = g.state.players.p1.money;

    expect(g.cancelProduction('p1', 0)).toBe(true);
    expect(g.state.players.p1.money, 'three unbuilt mortars refunded').toBe(
      money + UNITS.mortar.trainCost! * 3,
    );
    expect(g.ownGarrisonAt(CORE, 'p1').mortar, 'the finished one stays').toBe(1);
  });

  it('is faster with 軍工擴編', () => {
    const g = withArsenal(newGame());
    g.state.players.p1.techs.push('arsenalExpansion');
    g.queueVehicles(CORE, 'p1', 'tank', 1);
    expect(g.state.players.p1.production[0].totalSeconds).toBeCloseTo(
      UNITS.tank.buildSeconds / 1.3,
      5,
    );
  });

  it('writes off the queue if the arsenal is lost', () => {
    const g = withArsenal(newGame());
    g.queueVehicles(CORE, 'p1', 'tank', 2);
    g.state.regions[CORE].building = undefined;

    g.tick(UNITS.tank.buildSeconds + 1);
    expect(g.ownGarrisonAt(CORE, 'p1').tank, 'nothing delivered').toBe(undefined);
    expect(g.state.players.p1.production, 'and the order is off the books').toHaveLength(0);
  });

  it('takes population like any other troops', () => {
    const g = withArsenal(newGame());
    const before = g.population('p1');
    g.queueVehicles(CORE, 'p1', 'tank', 1);
    g.tick(UNITS.tank.buildSeconds + 1);
    expect(g.population('p1')).toBe(before + 1);
  });
});

describe('how they move', () => {
  it('drags a column down to its slowest unit', () => {
    expect(stackSpeed({ militia: 5 })).toBe(1);
    expect(stackSpeed({ militia: 5, tank: 1 })).toBe(0.6);
    expect(stackSpeed({ militia: 5, tank: 1, mortar: 1 }), 'the mortar sets the pace').toBe(0.3);
  });

  it('spends that on the clock', () => {
    const g = newGame();
    expect(g.marchSeconds(CORE, NEXT_DOOR, 'p1', { militia: 3 })).toBe(MARCH_SECONDS_PER_HOP);
    expect(g.marchSeconds(CORE, NEXT_DOOR, 'p1', { tank: 1 })).toBeCloseTo(
      MARCH_SECONDS_PER_HOP / 0.6,
      5,
    );
    expect(g.marchSeconds(CORE, NEXT_DOOR, 'p1', { mortar: 1 })).toBeCloseTo(
      MARCH_SECONDS_PER_HOP / 0.3,
      5,
    );
  });

  it('cannot cross a pass until 橫貫工程', () => {
    const g = newGame();
    const PASS_FROM = 'newtaipei-5';
    const PASS_TO = 'yilan-2';
    g.setRegionOwner(PASS_FROM, 'p1');
    g.state.players.p1.techs.push('mountainRoad');
    g.state.legions.push({
      id: 'column',
      playerId: 'p1',
      units: { militia: 2, tank: 1 },
      supply: 1,
      regionId: PASS_FROM,
    });

    expect(
      g.marchRoute(PASS_FROM, PASS_TO, 'p1', { militia: 2 }),
      'infantry get through on 山地公路',
    ).not.toBe(null);
    expect(
      g.marchRoute(PASS_FROM, PASS_TO, 'p1', { militia: 2, tank: 1 }),
      'the tank does not',
    ).toBe(null);

    g.state.players.p1.techs.push('traverseWorks');
    expect(g.marchRoute(PASS_FROM, PASS_TO, 'p1', { militia: 2, tank: 1 })).not.toBe(null);
  });
});

describe('shelling from a distance', () => {
  /** A mortar battery of p1's standing on their core. */
  function withGuns(g: GameEngine, mortar = 2) {
    g.state.legions.push({
      id: 'battery',
      playerId: 'p1',
      units: { mortar },
      supply: 1,
      regionId: CORE,
    });
    return g;
  }

  it('reaches as far as the guns do, and no further', () => {
    const g = withGuns(newGame());
    const twoOut = g.map.regions.find(
      (r) => g.map.distance(CORE, r.id) === 2 && totalUnits(g.state.regions[r.id].units) > 0,
    )!;
    const threeOut = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 3)!;

    expect(g.bombardRejection(CORE, twoOut.id, 'p1'), 'mortars reach two').toBe(null);
    expect(g.bombardRejection(CORE, threeOut.id, 'p1')).toBe('outOfRange');
  });

  it('needs something of theirs to shoot at', () => {
    const g = withGuns(newGame());
    const empty = g.map
      .region(CORE)
      .neighbors.find((id) => totalUnits(g.state.regions[id].units) === 0)!;
    expect(g.bombardRejection(CORE, empty, 'p1')).toBe('noTarget');
  });

  it('kills troops without joining a battle or being shot back at', () => {
    const g = withGuns(newGame(), 2);
    // Regions beside a core start ungarrisoned (docs 3.3), so post one.
    const target = g.map.region(CORE).neighbors[0];
    g.state.regions[target].units = { militia: 10 };
    const before = g.state.regions[target].units.militia!;

    expect(g.bombard(CORE, target, 'p1')).toBe(true);
    g.tick(COMBAT_ROUND_SECONDS);

    // 2 mortars = 60 damage a round, so six 10hp militia go down.
    expect(before - g.state.regions[target].units.militia!, 'six dead').toBe(6);
    expect(g.battleAt(target), 'no battle joined').toBeUndefined();
    expect(g.ownGarrisonAt(CORE, 'p1').mortar, 'and nothing shot back').toBe(2);
  });

  it('turns on the building once nobody is left standing', () => {
    const g = withGuns(newGame(), 1);
    const target = g.map.region(CORE).neighbors[0];
    g.setRegionOwner(target, 'p2');
    g.state.regions[target].units = {};
    g.state.regions[target].building = { type: 'shop', hp: 250 };

    g.bombard(CORE, target, 'p1');
    g.tick(COMBAT_ROUND_SECONDS);
    expect(g.state.regions[target].building!.hp, 'one mortar, one round').toBeCloseTo(220, 5);
  });

  it('stops when the target is empty', () => {
    const g = withGuns(newGame(), 4);
    const target = g.map.region(CORE).neighbors[0];
    g.state.regions[target].units = { militia: 6 };
    g.bombard(CORE, target, 'p1');
    g.tick(COMBAT_ROUND_SECONDS * 10);

    expect(totalUnits(g.state.regions[target].units), 'garrison wiped out').toBe(0);
    expect(
      g.state.legions.find((l) => l.id === 'battery')!.bombarding,
      'the order lapsed with the target',
    ).toBe(undefined);
  });

  it('is refused while the guns are in a fight of their own', () => {
    const g = withGuns(newGame());
    const target = g.map.region(CORE).neighbors[0];
    g.state.regions[target].units = { militia: 4 };
    g.state.legions.push({
      id: 'raiders',
      playerId: 'p2',
      units: { militia: 3 },
      supply: 1,
      regionId: CORE,
    });
    expect(g.bombardRejection(CORE, target, 'p1')).toBe('contested');
  });
});
