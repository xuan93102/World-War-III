// Occupying is its own order (docs/game-design.md 6.6): moving in and winning
// clears a region, taking it is a second decision. That's what lets an army
// stand on ground it doesn't hold — raiding through, or camping there (6.3).
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { COMBAT_ROUND_SECONDS } from '../combat';
import { MARCH_SECONDS_PER_HOP } from '../movement';
import { garrisonAt } from '../regions';
import { totalUnits } from '../units';

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

/** Sends `militia` from p1's core to `to`, and lets them arrive. */
function send(g: GameEngine, to: string, militia: number) {
  g.trainUnits(CORE, 'p1', 'militia', militia);
  g.startMarch(CORE, to, 'p1', { militia });
  g.tick(g.marchSeconds(CORE, to, 'p1') + 1);
}

describe('standing on ground you do not hold', () => {
  it('walks onto undefended enemy land without a fight', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    send(g, NEXT_DOOR, 4);

    expect(g.battleAt(NEXT_DOOR), 'nobody there to fight').toBeUndefined();
    expect(g.state.regions[NEXT_DOOR].owner, 'still theirs').toBe('p2');
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'but our army is on it').toBe(4);
  });

  it('lets that army pitch a camp there (docs 6.3)', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    send(g, NEXT_DOOR, 4);

    expect(g.startConstruction(NEXT_DOOR, 'camp', 'p1')).toBe(true);
    g.tick(21);
    expect(g.state.regions[NEXT_DOOR].building?.owner).toBe('p1');
    expect(g.supplyDepotAt(NEXT_DOOR, 'p1'), 'a depot on their land').toBe(true);
  });

  it('can march on through, leaving the ground alone', () => {
    const g = newGame();
    const beyond = g.map
      .region(NEXT_DOOR)
      .neighbors.find((id) => id !== CORE && g.map.distance(CORE, id) === 2)!;
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.regions[beyond].units = {};
    // Seal every other way in, so the only clear path to `beyond` is across
    // their region. Docs 6.6 needs neither the deed to the ground on the way
    // nor a continuous front.
    for (const n of g.map.region(beyond).neighbors) {
      if (n !== NEXT_DOOR) g.state.regions[n].units = { militia: 5 };
    }

    g.trainUnits(CORE, 'p1', 'militia', 4);
    const route = g.marchRoute(CORE, beyond, 'p1');
    expect(route, 'a way through their land').toEqual([NEXT_DOOR, beyond]);
    g.startMarch(CORE, beyond, 'p1', { militia: 4 });
    g.tick(MARCH_SECONDS_PER_HOP * 2 + 2);

    expect(g.state.regions[NEXT_DOOR].owner, 'passed over, not taken').toBe('p2');
    expect(totalUnits(garrisonAt(g.state, beyond)), 'arrived beyond').toBe(4);
  });

  it('is attacked in place, with the standing army as the defender', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    send(g, NEXT_DOOR, 4);

    // p2 walks back into their own region, where our army now stands.
    g.state.players.p2.money = 1000;
    g.trainUnits('kaohsiung-1', 'p2', 'militia', 4);
    const legion = g.state.legions.find((l) => l.playerId === 'p2')!;
    legion.regionId = NEXT_DOOR;
    g.state.legions = g.state.legions.filter((l) => l !== legion);
    // Arriving from next door is what starts the fight, so march it in.
    g.state.regions[NEXT_DOOR].units = {};
    g.setRegionOwner('taipei-3', 'p2');
    g.state.legions.push({
      id: 'p2-column',
      playerId: 'p2',
      units: { militia: 4 },
      supply: 1,
      regionId: 'taipei-3',
    });
    g.startMarch('taipei-3', NEXT_DOOR, 'p2', { militia: 4 });
    g.tick(g.marchSeconds('taipei-3', NEXT_DOOR, 'p2') + 1);

    const battle = g.battleAt(NEXT_DOOR);
    expect(battle, 'their own ground, still a fight').toBeDefined();
    expect(battle!.attackerId).toBe('p2');
    expect(battle!.defenderId, 'we are the defender though we own nothing').toBe('p1');
  });
});

describe('the order itself', () => {
  it('refuses without an army, mid-fight, or on your own ground', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    expect(g.occupyRejection(NEXT_DOOR, 'p1'), 'nobody there').toBe('noArmy');
    expect(g.occupyRejection(CORE, 'p1'), 'already ours').toBe('alreadyYours');

    g.state.regions[NEXT_DOOR].owner = null;
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    send(g, NEXT_DOOR, 8);
    expect(g.battleAt(NEXT_DOOR), 'fighting the militia').toBeDefined();
    expect(g.occupyRejection(NEXT_DOOR, 'p1'), 'not while it is contested').toBe('contested');

    g.tick(COMBAT_ROUND_SECONDS * 10);
    expect(g.occupyRejection(NEXT_DOOR, 'p1'), 'ground cleared').toBe(null);
  });

  it('keeps the supply the victors fought on rather than refilling them', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    g.trainUnits(CORE, 'p1', 'militia', 8);
    g.state.legions.find((l) => l.regionId === CORE)!.supply = 0.5;
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 8 });
    g.tick(MARCH_SECONDS_PER_HOP + 1);
    g.tick(COMBAT_ROUND_SECONDS * 10);

    const victors = g.legionsAt(NEXT_DOOR).find((l) => l.playerId === 'p1')!;
    expect(victors.supply, 'winning is not a resupply').toBeLessThan(0.55);
  });
});
