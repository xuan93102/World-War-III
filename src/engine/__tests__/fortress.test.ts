// A held fortress is terrain (docs/game-design.md 5.3): the region drops out
// of route planning for everyone but its owner.
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
  g.state.players.p1.money = 2000;
  g.state.players.p1.food = 2000;
  return g;
}

function fortify(g: GameEngine, regionId: string, owner: string) {
  g.setRegionOwner(regionId, owner);
  g.state.regions[regionId].building = { type: 'fortress', hp: BUILDINGS.fortress.hp };
}

/** The gate, and somewhere two hops out that a route might have crossed it to reach. */
function gate(g: GameEngine) {
  const middle = g.map.region(CORE).neighbors[0];
  const beyond = g.map.region(middle).neighbors.find((id) => id !== CORE)!;
  return { middle, beyond };
}

describe('an enemy fortress', () => {
  it('cannot be marched into at all — not even as an attack', () => {
    const g = newGame();
    const { middle } = gate(g);
    expect(g.marchRoute(CORE, middle, 'p1'), 'reachable before it is built').not.toBe(null);

    fortify(g, middle, 'p2');
    // Ordinary enemy ground is a legal destination even when you can't pass
    // through it — that's what an attack is. A sealed pass is not.
    expect(g.marchRoute(CORE, middle, 'p1'), 'sealed, like the range itself').toBe(null);
  });

  it('is not a region any route is planned through', () => {
    const g = newGame();
    const { middle, beyond } = gate(g);
    fortify(g, middle, 'p2');

    const route = g.marchRoute(CORE, beyond, 'p1');
    // Either there's a way round or there's no way at all; what there isn't
    // is a way through.
    expect(route === null || !route.includes(middle), 'never routed through the gate').toBe(true);
  });

  it('refuses the march outright rather than starting one', () => {
    const g = newGame();
    const { middle } = gate(g);
    fortify(g, middle, 'p2');
    trainNow(g, CORE, 'p1', 'militia', 20);

    expect(g.startMarch(CORE, middle, 'p1', { militia: 20 })).toBe(null);
    expect(g.state.marches.length, 'nobody set off').toBe(0);
  });

  it('does not seal against its own owner', () => {
    const g = newGame();
    const { middle } = gate(g);
    fortify(g, middle, 'p1');
    expect(g.marchRoute(CORE, middle, 'p1'), 'our own gate stands open to us').not.toBe(null);
  });

  it('halts a column that was already walking when the gate closed', () => {
    const g = newGame();
    const { middle } = gate(g);
    g.setRegionOwner(middle, 'p2');
    trainNow(g, CORE, 'p1', 'militia', 20);
    g.startMarch(CORE, middle, 'p1', { militia: 20 });

    // The wall goes up mid-march.
    g.state.regions[middle].building = { type: 'fortress', hp: BUILDINGS.fortress.hp };
    for (let second = 0; second < 60; second++) g.tick(1);

    expect(g.ownGarrisonAt(middle, 'p1').militia ?? 0, 'never got in').toBe(0);
    expect(g.ownGarrisonAt(CORE, 'p1').militia, 'turned back to where it set off').toBe(20);
    expect(g.state.marches.length, 'and the march is over').toBe(0);
  });

  it('can still be shelled down from outside, which reopens the road', () => {
    const g = newGame();
    const { middle } = gate(g);
    fortify(g, middle, 'p2');
    // Guns on the near side: a mortar reaches two regions without closing.
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
    expect(g.marchRoute(CORE, middle, 'p1'), 'and the road is open again').not.toBe(null);
  });
});
