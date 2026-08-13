// Marching rules (docs/game-design.md 8): armies cross the map region by
// region over time, never instantly. Until combat resolution exists, a march
// can only land on your own ground or on empty neutral land — which is exactly
// the capture loop.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { MARCH_SECONDS_PER_HOP, MARCH_SECONDS_VIA_PASS, marchSeconds } from '../movement';
import { totalUnits } from '../units';

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
  g.trainUnits(CORE, 'p1', 'militia', count);
  return g;
}

describe('march timing', () => {
  it('is one flat rate per hop', () => {
    expect(marchSeconds(CORE, NEXT_DOOR)).toBe(MARCH_SECONDS_PER_HOP);
    expect(MARCH_SECONDS_PER_HOP).toBe(20);
  });

  it('charges far more to cross the range', () => {
    expect(marchSeconds(PASS_FROM, PASS_TO)).toBe(MARCH_SECONDS_VIA_PASS);
    expect(MARCH_SECONDS_VIA_PASS / MARCH_SECONDS_PER_HOP, '30x a flat hop').toBe(30);
  });
});

describe('march orders', () => {
  it('refuses to move troops out of land you do not hold', () => {
    const g = newGame();
    expect(g.marchRejection(NEXT_DOOR, CORE, 'p1', { militia: 1 })).toBe('notOwner');
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

  it('finds no way through ground that would have to be fought for', () => {
    const g = withTroops(newGame());
    // The enemy core is walled off by garrisoned neutral land in every
    // direction, so there's simply no legal route to it yet.
    expect(g.marchRejection(CORE, 'kaohsiung-1', 'p1', { militia: 1 })).toBe('contested');
  });

  it('seals mountain passes until the road tech exists', () => {
    const g = newGame();
    g.state.players.p1.money = 1000;
    g.setRegionOwner(PASS_FROM, 'p1');
    g.state.regions[PASS_FROM].units = { militia: 3 };
    expect(g.marchRejection(PASS_FROM, PASS_TO, 'p1', { militia: 1 })).toBe('passLocked');
  });

  it('will not walk into ground that would have to be fought for', () => {
    const g = withTroops(newGame());
    // A garrison on the far side makes it contested — combat isn't built yet.
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    expect(g.marchRejection(CORE, NEXT_DOOR, 'p1', { militia: 2 })).toBe('contested');

    g.state.regions[NEXT_DOOR].units = {};
    g.setRegionOwner(NEXT_DOOR, 'p2');
    expect(g.marchRejection(CORE, NEXT_DOOR, 'p1', { militia: 2 }), 'enemy-held').toBe('contested');
  });

  it('takes the troops off the map the moment they set out', () => {
    const g = withTroops(newGame(), 5);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 2 });
    expect(totalUnits(g.state.regions[CORE].units), 'left behind').toBe(3);
    expect(totalUnits(g.state.regions[NEXT_DOOR].units), 'not arrived yet').toBe(0);
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
    expect(totalUnits(g.state.regions[NEXT_DOOR].units), 'still walking').toBe(0);
    g.tick(1);
    expect(totalUnits(g.state.regions[NEXT_DOOR].units), 'arrived').toBe(3);
  });

  it('claims empty neutral land it walks into', () => {
    const g = withTroops(newGame(), 3);
    expect(g.state.regions[NEXT_DOOR].owner, 'starts neutral').toBeNull();
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 3 });
    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.state.regions[NEXT_DOOR].owner, 'captured on arrival').toBe('p1');
    expect(totalUnits(g.state.regions[NEXT_DOOR].units), 'garrison stays put').toBe(3);
  });

  it('merges into a garrison already standing there', () => {
    const g = withTroops(newGame(), 6);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 3 });
    g.tick(MARCH_SECONDS_PER_HOP);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 3 });
    g.tick(MARCH_SECONDS_PER_HOP);
    expect(totalUnits(g.state.regions[NEXT_DOOR].units), 'both waves').toBe(6);
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
    expect(totalUnits(g.state.regions[FAR].units), 'not there yet').toBe(0);

    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.state.regions[FAR].owner, 'arrived').toBe('p1');
    expect(totalUnits(g.state.regions[FAR].units)).toBe(3);
    expect(g.state.marches).toHaveLength(0);
  });

  it('halts where it stands if the road ahead closes mid-march', () => {
    const g = withTroops(newGame(), 3);
    g.state.regions[FAR].units = {};
    const route = g.marchRoute(CORE, FAR, 'p1')!;
    g.startMarch(CORE, FAR, 'p1', { militia: 3 });
    // Someone garrisons the destination while the column is still walking.
    g.state.regions[FAR].units = { militia: 2 };

    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.state.marches, 'stopped short rather than walking into it').toHaveLength(0);
    expect(totalUnits(g.state.regions[route[0]].units), 'holds where it got to').toBe(3);
  });

  it('lands mixed stacks intact', () => {
    const g = newGame();
    g.state.players.p1.money = 1000;
    g.state.regions[CORE].units = { militia: 4, conscript: 2 };
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 1, conscript: 2 });
    g.tick(MARCH_SECONDS_PER_HOP);
    expect(g.state.regions[NEXT_DOOR].units).toEqual({ militia: 1, conscript: 2 });
    expect(g.state.regions[CORE].units, 'remainder holds the core').toEqual({ militia: 3 });
  });
});
