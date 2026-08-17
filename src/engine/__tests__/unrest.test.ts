// Unrest (docs/game-design.md 6.4): ground taken off another player is yours
// but useless for five minutes — no building, no garrisoning.
import { describe, expect, it } from 'vitest';
import { GameEngine, UNREST_SECONDS } from '../GameEngine';
import { MARCH_SECONDS_PER_HOP } from '../movement';
import { totalUnits } from '../units';
import { garrisonAt } from '../regions';

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

/** Walks an army onto NEXT_DOOR and takes it off `from`. */
function takeNextDoorFrom(g: GameEngine, from: 'p2' | null) {
  if (from) g.setRegionOwner(NEXT_DOOR, from);
  else g.state.regions[NEXT_DOOR].units = {};
  g.trainUnits(CORE, 'p1', 'militia', 5);
  g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 5 });
  g.tick(MARCH_SECONDS_PER_HOP + 1);
  if (from) g.occupy(NEXT_DOOR, 'p1');
  return g.state.regions[NEXT_DOOR];
}

describe('what starts it', () => {
  it('follows taking ground off a player, not off neutrals', () => {
    const conquered = takeNextDoorFrom(newGame(), 'p2');
    expect(conquered.unrestSeconds).toBe(UNREST_SECONDS);

    // Empty neutral land is claimed by walking in — no fight, no unrest.
    const claimed = takeNextDoorFrom(newGame(), null);
    expect(claimed.owner).toBe('p1');
    expect(claimed.unrestSeconds).toBe(undefined);
  });

  it('runs out on its own', () => {
    const g = newGame();
    takeNextDoorFrom(g, 'p2');
    g.tick(UNREST_SECONDS - 10);
    expect(g.unrestAt(NEXT_DOOR)).toBeCloseTo(10, 5);
    g.tick(11);
    expect(g.unrestAt(NEXT_DOOR), 'settled').toBe(0);
  });

  it('starts over for whoever takes it next', () => {
    const g = newGame();
    takeNextDoorFrom(g, 'p2');
    g.tick(100);
    // p2 walks back in and takes it again.
    g.state.legions = g.state.legions.filter((l) => l.regionId !== NEXT_DOOR);
    g.state.legions.push({
      id: 'p2-army',
      playerId: 'p2',
      units: { militia: 5 },
      supply: 1,
      regionId: NEXT_DOOR,
    });
    expect(g.occupy(NEXT_DOOR, 'p2')).toBe(true);
    expect(g.state.regions[NEXT_DOOR].unrestSeconds, 'their five minutes now').toBe(
      UNREST_SECONDS,
    );
  });
});

describe('what it blocks', () => {
  it('builds nothing, camps included', () => {
    const g = newGame();
    takeNextDoorFrom(g, 'p2');
    expect(g.buildRejection(NEXT_DOOR, 'shop', 'p1')).toBe('unrest');
    expect(g.buildRejection(NEXT_DOOR, 'camp', 'p1')).toBe('unrest');
    expect(g.startConstruction(NEXT_DOOR, 'shop', 'p1')).toBe(false);

    g.tick(UNREST_SECONDS + 1);
    expect(g.buildRejection(NEXT_DOOR, 'shop', 'p1'), 'settled, so build away').toBe(null);
  });

  it('raises and upgrades no troops there', () => {
    const g = newGame();
    const region = takeNextDoorFrom(g, 'p2');
    // Give it an academy and a core-style training site by hand: the point is
    // the unrest check, not how the site got there.
    region.building = { type: 'academy', hp: 300 };
    expect(g.trainRejection(NEXT_DOOR, 'p1', 'conscript', 1)).toBe('unrest');
    expect(g.upgradeRejection(NEXT_DOOR, 'p1', 'volunteer', 1)).toBe('unrest');

    g.tick(UNREST_SECONDS + 1);
    expect(g.trainRejection(NEXT_DOOR, 'p1', 'conscript', 1), 'settled').toBe(null);
  });

  it('takes no reinforcements, but troops may cross it', () => {
    const g = newGame();
    takeNextDoorFrom(g, 'p2');
    g.trainUnits(CORE, 'p1', 'militia', 4);

    expect(g.marchRejection(CORE, NEXT_DOOR, 'p1', { militia: 4 }), 'no garrisoning').toBe(
      'unrest',
    );
    expect(g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 4 })).toBe(null);

    // Somewhere on the far side, reachable only through the unrest region.
    const beyond = g.map
      .region(NEXT_DOOR)
      .neighbors.find((id) => id !== CORE && g.map.distance(CORE, id) === 2)!;
    for (const n of g.map.region(beyond).neighbors) {
      if (n !== NEXT_DOOR) g.state.regions[n].units = { militia: 5 };
    }
    g.state.regions[beyond].units = {};
    expect(g.marchRoute(CORE, beyond, 'p1'), 'crossing it is fine').toEqual([NEXT_DOOR, beyond]);
    expect(g.startMarch(CORE, beyond, 'p1', { militia: 4 })).not.toBe(null);
  });

  it('leaves the region yours, army and food included', () => {
    const g = newGame();
    const region = takeNextDoorFrom(g, 'p2');
    expect(region.owner).toBe('p1');
    expect(g.ownedRegionIds('p1')).toContain(NEXT_DOOR);
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'the army that took it stays').toBe(5);

    // Start from empty, or the test's stockpile sits at the storage cap and
    // the region's output has nowhere to land.
    g.state.players.p1.food = 0;
    const before = g.state.players.p1.food;
    g.tick(60);
    expect(g.state.players.p1.food, 'still paying food').toBeGreaterThan(before);
  });
});
