// The trench (docs/game-design.md 5.3): a building that costs an attacker
// time rather than stopping them outright.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { BUILDINGS } from '../buildings';
import { totalUnits } from '../units';
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

/** A region two hops out, with the middle one dug in by the other player. */
function road(g: GameEngine) {
  const fromCore = g.map.region(CORE).neighbors;
  // The far end must be reachable *only* through the middle, or the column
  // simply walks around the trench — which is correct behaviour, and would
  // make the test prove nothing.
  for (const middle of fromCore) {
    const far = g.map
      .region(middle)
      .neighbors.find((id) => id !== CORE && !fromCore.includes(id));
    if (far) return { middle, far };
  }
  throw new Error('no two-hop road on this map');
}

describe('a column that walks onto a trench', () => {
  it('is stopped there and set to fighting its way out', () => {
    const g = newGame();
    const { middle, far } = road(g);
    g.setRegionOwner(middle, 'p2');
    g.state.regions[middle].building = { type: 'trench', hp: BUILDINGS.trench.hp };

    trainNow(g, CORE, 'p1', 'militia', 30);
    const march = g.startMarch(CORE, far, 'p1', { militia: 30 })!;
    expect(march.destination, 'set out for the far side').toBe(far);

    for (let second = 0; second < 40; second++) g.tick(1);

    expect(totalUnits(g.ownGarrisonAt(middle, 'p1')), 'stopped on the trench').toBe(30);
    expect(totalUnits(g.ownGarrisonAt(far, 'p1')), 'never got past').toBe(0);
    const stuck = g.legionsAt(middle).find((l) => l.playerId === 'p1')!;
    expect(stuck.assaulting, 'and is digging them out').toBe(true);
  });

  it('takes the ground once the trench is gone, and marches on after', () => {
    const g = newGame();
    const { middle } = road(g);
    g.setRegionOwner(middle, 'p2');
    g.state.regions[middle].building = { type: 'trench', hp: BUILDINGS.trench.hp };

    trainNow(g, CORE, 'p1', 'militia', 60);
    g.startMarch(CORE, middle, 'p1', { militia: 60 });
    for (let second = 0; second < 300; second++) g.tick(1);

    expect(g.state.regions[middle].building, 'trench gone').toBe(undefined);
    expect(g.state.regions[middle].owner, 'and the ground with it').toBe('p1');
  });

  it('does not stop its owner walking through', () => {
    const g = newGame();
    const { middle, far } = road(g);
    g.setRegionOwner(middle, 'p1');
    g.state.regions[middle].building = { type: 'trench', hp: BUILDINGS.trench.hp };

    trainNow(g, CORE, 'p1', 'militia', 20);
    g.startMarch(CORE, far, 'p1', { militia: 20 });
    for (let second = 0; second < 120; second++) g.tick(1);

    expect(totalUnits(g.ownGarrisonAt(far, 'p1')), 'walked straight over its own works').toBe(20);
  });
});

describe('militia at a wall', () => {
  it('bring half their attack against anything built', () => {
    const g = newGame();
    const { middle } = road(g);
    g.setRegionOwner(middle, 'p2');
    g.state.regions[middle].building = { type: 'shop', hp: BUILDINGS.shop.hp };

    trainNow(g, CORE, 'p1', 'militia', 20);
    g.startMarch(CORE, middle, 'p1', { militia: 20 }, 'assault');
    for (let second = 0; second < 25; second++) g.tick(1);
    const before = g.state.regions[middle].building!.hp;
    g.tick(5); // one combat round

    // 20 militia are worth 20 attack against people and 10 against a wall.
    expect(before - g.state.regions[middle].building!.hp).toBeCloseTo(10, 5);
  });
});
