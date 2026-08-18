// Sight and fog (docs/game-design.md 9): territory sees one hop out, scouts
// see where they stand, and you can't shoot at what you can't see.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { MARCH_SECONDS_PER_HOP } from '../movement';
import { UNITS } from '../units';

const CORE = 'taipei-1';

function newGame() {
  const g = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
  g.state.players.p1.money = 100000;
  return g;
}

describe('what territory shows you', () => {
  it('lights your own ground and one hop past it', () => {
    const g = newGame();
    const seen = g.visibleTo('p1');
    expect(seen.has(CORE), 'your own ground').toBe(true);
    for (const n of g.map.region(CORE).neighbors) {
      expect(seen.has(n), 'and its neighbours').toBe(true);
    }
    const twoOut = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 2)!;
    expect(seen.has(twoOut.id), 'but no further').toBe(false);
  });

  it('goes dark the moment the ground is lost', () => {
    const g = newGame();
    const gained = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 2)!.id;
    const border = g.map
      .region(gained)
      .neighbors.find((id) => g.map.region(CORE).neighbors.includes(id))!;
    g.setRegionOwner(border, 'p1');
    expect(g.canSee(gained, 'p1')).toBe(true);

    g.setRegionOwner(border, 'p2');
    expect(g.canSee(gained, 'p1'), 'the light goes out with the deed').toBe(false);
  });

  it('shows an army the ground it is standing on', () => {
    const g = newGame();
    const far = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 3)!.id;
    expect(g.canSee(far, 'p1')).toBe(false);

    g.state.legions.push({
      id: 'column',
      playerId: 'p1',
      units: { militia: 3 },
      supply: 1,
      regionId: far,
    });
    expect(g.canSee(far, 'p1'), 'an army can see its own position').toBe(true);
  });
});

describe('scouts', () => {
  /** An academy on p1's core, and the scouting tech. */
  function withAcademy(g: GameEngine) {
    g.state.players.p1.food = 100000;
    g.startConstruction(CORE, 'academy', 'p1');
    g.tick(46);
    g.state.players.p1.techs.push('scouts');
    return g;
  }

  it('need their tech before the academy will train one', () => {
    const g = newGame();
    g.state.players.p1.food = 100000;
    g.startConstruction(CORE, 'academy', 'p1');
    g.tick(46);
    expect(g.trainRejection(CORE, 'p1', 'scout', 1)).toBe('notTrainable');

    g.state.players.p1.techs.push('scouts');
    expect(g.trainRejection(CORE, 'p1', 'scout', 1)).toBe(null);
  });

  it('travel faster than infantry and cannot fight', () => {
    expect(UNITS.scout.speed).toBe(1.5);
    expect(UNITS.scout.atk, 'no teeth').toBe(0);
    const g = newGame();
    const next = g.map.region(CORE).neighbors[0];
    expect(g.marchSeconds(CORE, next, 'p1', { scout: 1 })).toBeCloseTo(
      MARCH_SECONDS_PER_HOP / 1.5,
      5,
    );
  });

  it('light up wherever they are sent', () => {
    const g = withAcademy(newGame());
    const far = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 3)!.id;
    expect(g.canSee(far, 'p1')).toBe(false);

    g.trainUnits(CORE, 'p1', 'scout', 1);
    g.state.legions.find((l) => l.regionId === CORE)!.regionId = far;
    expect(g.canSee(far, 'p1'), 'the scout is the eye').toBe(true);
  });

  it('see one hop further once drones are up', () => {
    const g = withAcademy(newGame());
    const far = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 3)!.id;
    const beyond = g.map.region(far).neighbors.find((id) => g.map.distance(CORE, id) > 2)!;
    g.state.legions.push({
      id: 'eyes',
      playerId: 'p1',
      units: { scout: 1 },
      supply: 1,
      regionId: far,
    });
    expect(g.canSee(beyond, 'p1')).toBe(false);

    g.state.players.p1.techs.push('drones');
    expect(g.canSee(beyond, 'p1'), 'drones reach past the scout').toBe(true);
  });

  it('hide from the enemy until counter-recon finds them', () => {
    const g = newGame();
    const watched = g.map.region(CORE).neighbors[0];
    g.state.legions.push({
      id: 'their-eyes',
      playerId: 'p2',
      units: { scout: 1, militia: 2 },
      supply: 1,
      regionId: watched,
    });

    expect(g.canSee(watched, 'p1'), 'we can see the region').toBe(true);
    expect(g.garrisonSeenBy(watched, 'p1'), 'but not the scout in it').toEqual({ militia: 2 });

    g.state.players.p1.techs.push('counterRecon');
    expect(g.garrisonSeenBy(watched, 'p1')).toEqual({ militia: 2, scout: 1 });
  });
});

describe('fog', () => {
  it('hides everything in a region you cannot see', () => {
    const g = newGame();
    const far = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 3)!.id;
    g.state.regions[far].units = { militia: 8 };
    g.state.regions[far].building = { type: 'shop', hp: 250 };

    expect(g.garrisonSeenBy(far, 'p1'), 'no idea what is there').toEqual({});
    expect(g.canSee(far, 'p1')).toBe(false);
  });

  it('shows your own scouts to you', () => {
    const g = newGame();
    g.state.legions.push({
      id: 'ours',
      playerId: 'p1',
      units: { scout: 1 },
      supply: 1,
      regionId: CORE,
    });
    expect(g.garrisonSeenBy(CORE, 'p1')).toEqual({ scout: 1 });
  });
});
