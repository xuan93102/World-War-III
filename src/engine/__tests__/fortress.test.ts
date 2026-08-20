// A held fortress is a wall across the road (docs/game-design.md 5.3):
// nothing marches through it, but it can be marched *at* and knocked down.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { BUILDINGS } from '../buildings';
import { trainNow } from './helpers';

const CORE = 'taipei-1';

function newGame() {
  const g = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
  g.state.players.p1.money = 3000;
  g.state.players.p1.food = 3000;
  return g;
}

function fortify(g: GameEngine, regionId: string, owner: string) {
  g.setRegionOwner(regionId, owner);
  g.state.regions[regionId].building = { type: 'fortress', hp: BUILDINGS.fortress.hp };
}

/** The gate, and somewhere beyond it a route might otherwise have crossed to. */
function gate(g: GameEngine) {
  // A pair where the road to 'beyond' genuinely runs through 'middle' —
  // otherwise a column just walks around the gate, which is correct
  // behaviour and would make the test prove nothing.
  for (const middle of g.map.region(CORE).neighbors) {
    for (const beyond of g.map.region(middle).neighbors) {
      if (beyond === CORE) continue;
      const route = g.marchRoute(CORE, beyond, 'p1');
      if (route && route[0] === middle) return { middle, beyond };
    }
  }
  throw new Error('no road through a neighbour on this map');
}

describe('an enemy fortress', () => {
  it('is not a region any route is planned through', () => {
    const g = newGame();
    const { middle, beyond } = gate(g);
    fortify(g, middle, 'p2');

    const route = g.marchRoute(CORE, beyond, 'p1');
    // Either there's a way round or there's no way at all; what there isn't
    // is a way through.
    expect(route === null || !route.includes(middle), 'never routed through the gate').toBe(true);
  });

  it('can still be marched at, because that is how you take it down', () => {
    const g = newGame();
    const { middle } = gate(g);
    fortify(g, middle, 'p2');
    trainNow(g, CORE, 'p1', 'militia', 20);

    expect(g.marchRoute(CORE, middle, 'p1'), 'the gate itself is a legal target').not.toBe(null);
    expect(g.startMarch(CORE, middle, 'p1', { militia: 20 }, 'assault')).not.toBe(null);
  });

  it('pins whoever walks up to it until the gate is down', () => {
    const g = newGame();
    const { middle, beyond } = gate(g);
    fortify(g, middle, 'p2');
    trainNow(g, CORE, 'p1', 'militia', 20);
    g.startMarch(CORE, middle, 'p1', { militia: 20 });
    for (let second = 0; second < 40; second++) g.tick(1);

    expect(g.ownGarrisonAt(middle, 'p1').militia, 'standing at the gate').toBe(20);
    // This is the whole point: they got to the gate, and the road past it is
    // still shut. They have to knock it down before they go anywhere.
    expect(g.marchRejection(middle, beyond, 'p1', { militia: 20 })).toBe('fortressHolds');
    expect(g.startMarch(middle, beyond, 'p1', { militia: 20 })).toBe(null);
  });

  it('opens the road once it is knocked down', () => {
    const g = newGame();
    const { middle, beyond } = gate(g);
    fortify(g, middle, 'p2');
    trainNow(g, CORE, 'p1', 'militia', 200);
    g.startMarch(CORE, middle, 'p1', { militia: 200 }, 'assault');
    for (let second = 0; second < 300; second++) g.tick(1);

    expect(g.state.regions[middle].building, 'gate down').toBe(undefined);
    expect(g.state.regions[middle].owner, 'and the ground with it').toBe('p1');
    expect(g.startMarch(middle, beyond, 'p1', { militia: 20 }), 'road open').not.toBe(null);
  });

  it('stops a column that was aiming past it, in front of it', () => {
    const g = newGame();
    const { middle, beyond } = gate(g);
    g.setRegionOwner(middle, 'p2');
    trainNow(g, CORE, 'p1', 'militia', 20);
    // Set out while the road is open; the gate closes behind the orders.
    const march = g.startMarch(CORE, beyond, 'p1', { militia: 20 })!;
    expect(march.destination).toBe(beyond);
    g.state.regions[middle].building = { type: 'fortress', hp: BUILDINGS.fortress.hp };

    for (let second = 0; second < 60; second++) g.tick(1);
    expect(g.ownGarrisonAt(middle, 'p1').militia, 'stopped at the gate').toBe(20);
    expect(g.ownGarrisonAt(beyond, 'p1').militia ?? 0, 'never got past').toBe(0);
  });

  it('does not seal against its own owner', () => {
    const g = newGame();
    const { middle, beyond } = gate(g);
    fortify(g, middle, 'p1');
    const route = g.marchRoute(CORE, beyond, 'p1');
    expect(route, 'our own gate stands open to us').not.toBe(null);
    expect(g.marchRejection(middle, beyond, 'p1', {}), 'and we walk out of it freely').not.toBe(
      'fortressHolds',
    );
  });

  it('can also be shelled down from outside without closing on it', () => {
    const g = newGame();
    const { middle } = gate(g);
    fortify(g, middle, 'p2');
    g.state.legions.push({
      id: 'guns',
      playerId: 'p1',
      units: { mortar: 20 },
      supply: 1,
      regionId: CORE,
    });

    expect(g.bombard(CORE, middle, 'p1'), 'in range and in sight').toBe(true);
    for (let second = 0; second < 300; second++) g.tick(1);
    expect(g.state.regions[middle].building, 'fortress down').toBe(undefined);
  });
});
