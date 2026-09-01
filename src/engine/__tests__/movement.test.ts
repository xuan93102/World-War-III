// Marching rules (docs/game-design.md 8): armies cross the map region by
// region over time, never instantly. Until combat resolution exists, a march
// can only land on your own ground or on empty neutral land — which is exactly
// the capture loop.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { MARCH_SECONDS_PER_HOP, MARCH_SECONDS_VIA_PASS, marchSeconds } from '../movement';
import { BUILDINGS } from '../buildings';
import { garrisonAt } from '../regions';
import { totalUnits } from '../units';
import { TAIWAN } from '../maps';
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

// taipei-1 is p1's core; taipei-2 is adjacent to it and, being one hop from a
// core, sits in the ungarrisoned safe zone (docs 3.3).
const CORE = 'taipei-1';
const NEXT_DOOR = 'taipei-2';
// Two hops from the core, so outside the safe zone and garrisoned by default.
const FAR = 'taipei-4';
// The 北宜 pass, from the generated map data.
const PASS_FROM = 'newtaipei-5';
const PASS_TO = 'yilan-2';

function newGame() {
  return new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
}

/** Puts `count` militia in p1's core, ready to march. */
function withTroops(g: GameEngine, count = 5) {
  g.state.players.p1.money = 1000;
  trainNow(g, CORE, 'p1', 'militia', count);
  return g;
}

describe('march timing', () => {
  it('is one flat rate per hop', () => {
    expect(marchSeconds(TAIWAN, CORE, NEXT_DOOR)).toBe(MARCH_SECONDS_PER_HOP);
    expect(MARCH_SECONDS_PER_HOP).toBe(20);
  });

  it('charges far more to cross the range', () => {
    expect(marchSeconds(TAIWAN, PASS_FROM, PASS_TO)).toBe(MARCH_SECONDS_VIA_PASS);
    expect(MARCH_SECONDS_VIA_PASS / MARCH_SECONDS_PER_HOP, '30x a flat hop').toBe(30);
  });
});

describe('march orders', () => {
  it('refuses to move troops that are not yours out of a region', () => {
    const g = newGame();
    // Nothing of ours is standing there — the deed is beside the point, since
    // an army can be parked on ground it doesn't hold (docs 6.6).
    expect(g.marchRejection(NEXT_DOOR, CORE, 'p1', { militia: 1 })).toBe('noUnits');

    g.state.regions[NEXT_DOOR].units = { militia: 4 };
    expect(g.marchRejection(NEXT_DOOR, CORE, 'p1', { militia: 1 }), 'nor are the 亂軍').toBe(
      'noUnits',
    );

    // Our own column standing on their ground can leave again.
    g.setRegionOwner(NEXT_DOOR, 'p2');
    station(g, NEXT_DOOR, 'p1', { militia: 3 });
    expect(g.marchRejection(NEXT_DOOR, CORE, 'p1', { militia: 3 })).toBe(null);
  });

  it('refuses to send troops that are not there', () => {
    const g = withTroops(newGame(), 2);
    expect(g.marchRejection(CORE, NEXT_DOOR, 'p1', { militia: 3 })).toBe('noUnits');
    expect(g.marchRejection(CORE, NEXT_DOOR, 'p1', { militia: 2 })).toBeNull();
  });

  it('rejects marching to where you already are', () => {
    const g = withTroops(newGame());
    expect(g.marchRejection(CORE, CORE, 'p1', { militia: 1 })).toBe('notAdjacent');
  });

  it('reaches past the next region, routing hop by hop', () => {
    const g = withTroops(newGame(), 3);
    // Two hops out; clear its garrison so there's a legal way in.
    g.state.regions[FAR].units = {};
    const route = g.marchRoute(CORE, FAR, 'p1');
    expect(route, 'two hops').toHaveLength(2);
    expect(route?.at(-1)).toBe(FAR);
    expect(g.routeSeconds(CORE, route!), 'time is the sum of the hops').toBe(
      2 * MARCH_SECONDS_PER_HOP,
    );
    expect(g.marchRejection(CORE, FAR, 'p1', { militia: 3 })).toBeNull();
  });

  it('walks straight past a neutral garrison', () => {
    const g = withTroops(newGame());
    // The 亂軍 hold their own ground but don't police the roads (docs 8.1), so
    // a column can cross the island through garrisoned neutral land.
    expect(g.marchRejection(CORE, 'kaohsiung-1', 'p1', { militia: 1 })).toBe(null);
    const route = g.marchRoute(CORE, 'kaohsiung-1', 'p1')!;
    expect(
      route.some((id) => totalUnits(g.state.regions[id].units) > 0),
      'and the route really does cross one',
    ).toBe(true);
  });

  it('routes straight through an enemy army, and meets it there', () => {
    const g = withTroops(newGame());
    const next = g.map.region(CORE).neighbors[0];
    const beyond = g.map
      .region(next)
      .neighbors.find((id) => id !== CORE && !g.map.region(CORE).neighbors.includes(id))!;

    // A route is geography (docs 8.1): only a mountain or a held fortress
    // closes a road. Park armies on every approach and the road is still
    // there — walking into them is what starts a fight, and a route that
    // steered around every enemy would make interception impossible to
    // arrange and the map impossible to read.
    for (const n of g.map.region(beyond).neighbors) {
      if (n === CORE) continue;
      g.state.legions.push({
        id: `wall-${n}`,
        playerId: 'p2',
        units: { militia: 5 },
        supply: 1,
        regionId: n,
      });
    }

    const route = g.marchRoute(CORE, beyond, 'p1');
    expect(route, 'the road is still a road').not.toBe(null);
    expect(g.marchRejection(CORE, beyond, 'p1', { militia: 1 })).toBe(null);

    // And the column meets what is standing on it.
    g.startMarch(CORE, beyond, 'p1', { militia: 5 });
    g.tick(MARCH_SECONDS_PER_HOP + 1);
    expect(g.battleAt(route![0]), 'walked into them').not.toBe(null);
  });

  it('seals mountain passes until the road tech exists', () => {
    const g = newGame();
    g.state.players.p1.money = 1000;
    g.setRegionOwner(PASS_FROM, 'p1');
    station(g, PASS_FROM, 'p1', { militia: 3 });
    expect(g.marchRejection(PASS_FROM, PASS_TO, 'p1', { militia: 1 })).toBe('passLocked');
  });

  it('allows marching onto held ground — that order is an attack', () => {
    const g = withTroops(newGame());
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    expect(g.marchRejection(CORE, NEXT_DOOR, 'p1', { militia: 2 }), 'garrisoned neutral').toBeNull();

    g.state.regions[NEXT_DOOR].units = {};
    g.setRegionOwner(NEXT_DOOR, 'p2');
    expect(g.marchRejection(CORE, NEXT_DOOR, 'p1', { militia: 2 }), 'enemy-held').toBeNull();
  });

  it('takes the troops off the map the moment they set out', () => {
    const g = withTroops(newGame(), 5);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 2 });
    expect(totalUnits(garrisonAt(g.state, CORE)), 'left behind').toBe(3);
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'not arrived yet').toBe(0);
    expect(g.state.marches).toHaveLength(1);
  });
});

describe('troops in transit', () => {
  // Without this an army would vanish from the population count while it was
  // on the road, and marching everyone out would free the headroom to recruit
  // a second army for free.
  it('still count against the population cap', () => {
    const g = withTroops(newGame(), 5);
    const before = g.population('p1');
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 5 });
    expect(g.marchingUnits('p1')).toBe(5);
    expect(g.population('p1'), 'unchanged by setting off').toBe(before);
  });

  it('are counted again as garrison once they land', () => {
    const g = withTroops(newGame(), 5);
    const before = g.population('p1');
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 5 });
    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.marchingUnits('p1'), 'road is clear').toBe(0);
    expect(g.population('p1'), 'no double count on arrival').toBe(before);
  });
});

describe('arrival', () => {
  it('takes a whole hop to get there', () => {
    const g = withTroops(newGame(), 3);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 3 });
    g.tick(MARCH_SECONDS_PER_HOP - 1);
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'still walking').toBe(0);
    g.tick(1);
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'arrived').toBe(3);
  });

  it('claims empty neutral land it walks into', () => {
    const g = withTroops(newGame(), 3);
    expect(g.state.regions[NEXT_DOOR].owner, 'starts neutral').toBeNull();
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 3 });
    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.state.regions[NEXT_DOOR].owner, 'captured on arrival').toBe('p1');
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'garrison stays put').toBe(3);
  });

  it('merges into a garrison already standing there', () => {
    const g = withTroops(newGame(), 6);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 3 });
    g.tick(MARCH_SECONDS_PER_HOP);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 3 });
    g.tick(MARCH_SECONDS_PER_HOP);
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'both waves').toBe(6);
    expect(g.state.marches, 'road is clear').toHaveLength(0);
  });

  // The whole point of walking the route rather than skipping to the end: the
  // army is really in each region on the way, which is where an enemy will be
  // able to intercept it once combat exists.
  it('enters every region along the way, not just the ends', () => {
    const g = withTroops(newGame(), 3);
    g.state.regions[FAR].units = {};
    const route = g.marchRoute(CORE, FAR, 'p1')!;
    g.startMarch(CORE, FAR, 'p1', { militia: 3 });

    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.state.regions[route[0]].owner, 'took the region it passed through').toBe('p1');
    expect(g.state.marches, 'still on the road').toHaveLength(1);
    expect(totalUnits(garrisonAt(g.state, FAR)), 'not there yet').toBe(0);

    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.state.regions[FAR].owner, 'arrived').toBe('p1');
    expect(totalUnits(garrisonAt(g.state, FAR))).toBe(3);
    expect(g.state.marches).toHaveLength(0);
  });

  // This is interception: the route was planned around hostile ground, so if
  // an enemy moves into the column's path after it sets off, the column walks
  // straight into them.
  it('walks into a fight if someone occupies the path mid-march', () => {
    const g = withTroops(newGame(), 3);
    g.state.regions[FAR].units = {};
    const route = g.marchRoute(CORE, FAR, 'p1')!;
    g.startMarch(CORE, FAR, 'p1', { militia: 3 });
    // An enemy army moves into the very next stop while the column is still
    // walking. Only troops do this — ground alone is walked over (docs 6.6).
    g.state.regions[route[0]].owner = 'p2';
    g.state.legions.push({
      id: 'ambush',
      playerId: 'p2',
      units: { militia: 2 },
      supply: 1,
      regionId: route[0],
    });

    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.state.marches, 'the march ends where it was stopped').toHaveLength(0);
    expect(g.battleAt(route[0]), 'a battle started there').toBeDefined();
  });

  it('lands mixed stacks intact', () => {
    const g = newGame();
    g.state.players.p1.money = 1000;
    station(g, CORE, 'p1', { militia: 4, conscript: 2 });
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 1, conscript: 2 });
    g.tick(MARCH_SECONDS_PER_HOP);
    expect(garrisonAt(g.state, NEXT_DOOR)).toEqual({ militia: 1, conscript: 2 });
    expect(garrisonAt(g.state, CORE), 'remainder holds the core').toEqual({ militia: 3 });
  });
});

describe('what a route is made of', () => {
  it('is the shortest way there, whoever is standing about', () => {
    const g = withTroops(newGame());
    const far = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 3)!.id;
    const clear = g.marchRoute(CORE, far, 'p1')!;

    // Put an army of theirs on every step of it. The road does not move.
    for (const step of clear) {
      g.state.legions.push({
        id: `sit-${step}`,
        playerId: 'p2',
        units: { militia: 3 },
        supply: 1,
        regionId: step,
      });
    }
    expect(g.marchRoute(CORE, far, 'p1'), 'the same road as before').toEqual(clear);
  });

  it('bends only for a mountain or a gate', () => {
    const g = withTroops(newGame());
    const far = g.map.regions.find((r) => g.map.distance(CORE, r.id) === 3)!.id;
    const clear = g.marchRoute(CORE, far, 'p1')!;

    // A fortress on the first step, on the other hand, is a wall.
    g.setRegionOwner(clear[0], 'p2');
    g.state.regions[clear[0]].building = { type: 'fortress', hp: BUILDINGS.fortress.hp };

    const detour = g.marchRoute(CORE, far, 'p1');
    expect(detour === null || !detour.includes(clear[0]), 'went round it or not at all').toBe(true);
  });
});

describe('two armies on the same ground', () => {
  // The meeting place, and two regions either side of it that are not each
  // other — a column walking in, and a column walking out somewhere else, so
  // this is a meeting rather than a swap.
  const MEET = 'taipei-2';
  const COMES_FROM = 'taipei-4';
  const HEADS_TO = 'taipei-5';

  /**
   * Two columns timed to be on the same ground at once.
   *
   * The one being caught has to leave *after* the other sets out: hops take
   * the same time, so whoever departs first arrives first, and a defender
   * that departed early would be long gone by the time anyone got there.
   */
  function twoColumns() {
    const g = newGame();
    g.setRegionOwner(COMES_FROM, 'p1');
    g.setRegionOwner(MEET, 'p2');
    g.setRegionOwner(HEADS_TO, 'p2');
    station(g, COMES_FROM, 'p1', { militia: 20 });
    station(g, MEET, 'p2', { militia: 20 });

    expect(g.startMarch(COMES_FROM, MEET, 'p1', { militia: 20 }), 'p1 sets off').not.toBe(null);
    g.tick(2);
    expect(g.startMarch(MEET, HEADS_TO, 'p2', { militia: 20 }), 'p2 sets off later').not.toBe(null);
    return g;
  }

  it('fight, rather than walking through each other', () => {
    const g = twoColumns();
    for (let second = 0; second < 200 && !g.battleAt(MEET); second++) g.tick(1);

    // A march used to be a way of not being anywhere: neither column counted
    // as standing on any ground, so each was invisible to the other and they
    // walked straight through.
    const fight = g.battleAt(MEET);
    expect(fight, 'they met').toBeTruthy();
    expect(fight?.attackerId, 'the one that walked in attacks').toBe('p1');
    expect(fight?.defenderId, 'the one caught crossing defends').toBe('p2');
  });

  it('stop the column that was caught crossing', () => {
    const g = twoColumns();
    for (let second = 0; second < 200 && !g.battleAt(MEET); second++) g.tick(1);

    // Walking on would let an army stroll out of a battle it is standing in.
    expect(g.state.marches, 'nobody is still marching').toHaveLength(0);
    expect(
      g.state.legions.some((l) => l.playerId === 'p2' && l.regionId === MEET),
      'the defender is still on the ground it was crossing',
    ).toBe(true);
  });

  it('leaves a lone column free to march', () => {
    // The test is "an enemy is here", not "a march is here" — one army on the
    // road with nobody to meet must still get where it was going.
    const g = newGame();
    g.setRegionOwner(COMES_FROM, 'p1');
    g.setRegionOwner(MEET, 'p1');
    station(g, COMES_FROM, 'p1', { militia: 20 });
    g.startMarch(COMES_FROM, MEET, 'p1', { militia: 20 });
    for (let second = 0; second < 200 && g.state.marches.length > 0; second++) g.tick(1);

    expect(g.battleAt(MEET), 'no fight with nobody there').toBeUndefined();
    expect(totalUnits(garrisonAt(g.state, MEET)), 'it arrived').toBe(20);
  });
});
