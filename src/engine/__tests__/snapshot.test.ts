// What one player is allowed to be told (docs/game-design.md 15.3).
//
// These tests attack the snapshot rather than the interface. "The panel
// doesn't show it" is not the property we need — a client can render whatever
// it likes. The property is that the fact is *not in the message*, so the
// tests mostly search the serialised snapshot for things that must not be
// anywhere in it.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { snapshotFor } from '../snapshot';
import { BUILDINGS, CORE_HP } from '../buildings';
import { placeVillagers, trainNow } from './helpers';
import { AiController } from '../../ai/AiController';
import { TICK_SECONDS } from '../clock';
import { totalUnits } from '../units';

const BLUE_CORE = 'taipei-1';
const RED_CORE = 'kaohsiung-1';

/**
 * A match with the enemy doing distinctive things far away, where blue has no
 * eyes: a fortune, a tech, an army, a building, a cart and a battle.
 */
function newMatch() {
  const g = new GameEngine([
    { id: 'blue', name: 'A', color: '#00f', coreRegionId: BLUE_CORE },
    { id: 'red', name: 'B', color: '#f00', coreRegionId: RED_CORE },
  ]);

  const red = g.state.players.red;
  red.money = 424242; // a number that appears nowhere else
  red.food = 131313;
  red.coreLevel = 3;
  red.techs.push('mainBattleTank', 'urbanisation');
  red.research.push({ techId: 'roadNetwork', remainingSeconds: 99, totalSeconds: 100 });
  red.researchers = 7;

  // Their ground, two hops from their core and nowhere near blue.
  const theirs = g.map.region(RED_CORE).neighbors[0];
  g.setRegionOwner(theirs, 'red');
  g.state.regions[theirs].building = { type: 'shop', hp: BUILDINGS.shop.hp, staff: 9 };
  g.state.regions[theirs].unrestSeconds = 42;
  placeVillagers(g, 'red', 55, theirs);
  g.state.legions.push({
    id: 'their-army',
    playerId: 'red',
    units: { marine: 77, scout: 3 },
    supply: 0.5,
    regionId: theirs,
  });

  return { g, theirs };
}

describe('a snapshot of what someone else can see', () => {
  it('carries none of their books', () => {
    const { g } = newMatch();
    const wire = JSON.stringify(snapshotFor(g, 'blue'));

    expect(wire, 'their treasury').not.toContain('424242');
    expect(wire, 'their stores').not.toContain('131313');
    expect(wire, 'what they have researched').not.toContain('mainBattleTank');
    expect(wire, 'what they are researching').not.toContain('roadNetwork');
    expect(wire, 'their researchers').not.toContain('"researchers":7');
    expect(wire, 'their core level').not.toContain('"coreLevel":3');
  });

  it('carries nothing standing on ground we have no eyes on', () => {
    const { g, theirs } = newMatch();
    const snapshot = snapshotFor(g, 'blue');
    const wire = JSON.stringify(snapshot);

    expect(wire, 'their army').not.toContain('their-army');
    expect(wire, 'its size').not.toContain('77');
    expect(snapshot.regions[theirs].building, 'their shop').toBe(undefined);
    expect(snapshot.regions[theirs].owner, 'even whose ground it is').toBe(null);
    expect(snapshot.regions[theirs].unrestSeconds, 'and what state it is in').toBe(undefined);
  });

  it('hides the neutral garrisons nobody has scouted', () => {
    const { g } = newMatch();
    const snapshot = snapshotFor(g, 'blue');
    const unseen = Object.entries(snapshot.regions).find(
      ([id]) => !g.visibleTo('blue').has(id) && !g.state.regions[id].isCore,
    )!;
    expect(g.state.regions[unseen[0]].units.militia, 'there really is a garrison').toBeGreaterThan(
      0,
    );
    expect(unseen[1].units, 'and the snapshot does not say so').toEqual({});
  });

  it('shows all of it once we have eyes there', () => {
    const { g, theirs } = newMatch();
    // Sight comes from holding ground *next to* it — taking the ground
    // itself would raze the shop we are trying to look at (docs 5).
    const doorstep = g.map.region(theirs).neighbors.find((id) => id !== RED_CORE)!;
    g.setRegionOwner(doorstep, 'blue');
    const snapshot = snapshotFor(g, 'blue');
    expect(snapshot.regions[theirs].building?.type).toBe('shop');
    expect(snapshot.regions[theirs].building?.staff).toBe(9);
  });

  it('keeps our own everything', () => {
    const { g } = newMatch();
    g.state.players.blue.techs.push('rifles');
    trainNow(g, BLUE_CORE, 'blue', 'militia', 3);
    g.state.players.blue.money = 999;

    const snapshot = snapshotFor(g, 'blue');
    expect(snapshot.players.blue.money).toBe(999);
    expect(snapshot.players.blue.techs).toContain('rifles');
    expect(snapshot.legions.some((l) => l.playerId === 'blue')).toBe(true);
  });
});

describe('what stays public on purpose', () => {
  it('says where their core is, and never how it is doing', () => {
    const { g } = newMatch();
    g.state.players.red.coreHp = 1234;
    const snapshot = snapshotFor(g, 'blue');

    expect(snapshot.regions[RED_CORE].isCore, 'the core is on the map').toBe(true);
    expect(snapshot.regions[RED_CORE].owner, 'and everyone knows whose').toBe('red');
    expect(snapshot.players.red.coreHp, 'but not its condition').toBe(CORE_HP);
    expect(JSON.stringify(snapshot)).not.toContain('1234');
  });

  it('admits a core that has fallen — the match is over', () => {
    const { g } = newMatch();
    g.state.players.red.coreHp = 0;
    expect(snapshotFor(g, 'blue').players.red.coreHp, 'losing is not a secret').toBe(0);
  });

  it('shows a wonder and its clock wherever it stands', () => {
    const { g, theirs } = newMatch();
    g.state.regions[theirs].building = { type: 'wonder', hp: BUILDINGS.wonder.hp };
    g.state.regions[theirs].wonderHeldSeconds = 100;

    const snapshot = snapshotFor(g, 'blue');
    // It exists to end stalemates, so a clock nobody can see would end the
    // match by surprise (docs 5.2).
    expect(snapshot.regions[theirs].building?.type).toBe('wonder');
    expect(snapshot.regions[theirs].wonderHeldSeconds).toBe(100);
  });

  it('shows a wonder going up, not just a finished one', () => {
    const { g, theirs } = newMatch();
    g.state.regions[theirs].construction = {
      type: 'wonder',
      remainingSeconds: 200,
      totalSeconds: BUILDINGS.wonder.buildSeconds,
    };

    // Five minutes to build and then a hold to survive: that whole span is
    // the window an opponent has to do something about it, and a warning
    // that only arrives once the thing is finished is not a warning.
    expect(snapshotFor(g, 'blue').regions[theirs].construction?.type).toBe('wonder');
  });

  it('does not let anything else be seen alongside it', () => {
    const { g, theirs } = newMatch();
    g.state.regions[theirs].construction = {
      type: 'wonder',
      remainingSeconds: 200,
      totalSeconds: BUILDINGS.wonder.buildSeconds,
    };
    g.state.regions[theirs].unrestSeconds = 42;
    placeVillagers(g, 'red', 7, theirs);

    const hidden = snapshotFor(g, 'blue').regions[theirs];
    expect(hidden.owner, 'whose it is stays hidden').toBe(null);
    expect(totalUnits(hidden.units), 'and who is standing on it').toBe(0);
    expect(hidden.unrestSeconds).toBe(undefined);
  });

  it('still hides a scout standing in the open, until counter-recon', () => {
    const { g } = newMatch();
    const border = g.map.region(BLUE_CORE).neighbors[0];
    g.state.legions.push({
      id: 'watcher',
      playerId: 'red',
      units: { scout: 2, militia: 4 },
      supply: 1,
      regionId: border,
    });

    const blind = snapshotFor(g, 'blue').legions.find((l) => l.id === 'watcher');
    expect(blind?.units.militia, 'we can see the men').toBe(4);
    expect(blind?.units.scout, 'but not the pair of eyes').toBe(undefined);

    g.state.players.blue.techs.push('counterRecon');
    const sharp = snapshotFor(g, 'blue').legions.find((l) => l.id === 'watcher');
    expect(sharp?.units.scout, 'until we go looking for them').toBe(2);
  });
});

describe('a guest driving the state it was sent', () => {
  it('can build an engine on it and read the game normally', () => {
    const { g } = newMatch();
    g.state.players.blue.money = 500;
    trainNow(g, BLUE_CORE, 'blue', 'militia', 10);

    const guest = GameEngine.fromState(snapshotFor(g, 'blue'));

    // Everything the panels ask for still answers, on filtered state.
    expect(guest.ownedRegionCount('blue')).toBe(g.ownedRegionCount('blue'));
    expect(guest.economy('blue').moneyPerMin).toBe(g.economy('blue').moneyPerMin);
    expect(guest.troopCount('blue')).toBe(10);
    expect(guest.visibleTo('blue')).toEqual(g.visibleTo('blue'));
    expect(guest.map.regions.length, 'and it has the whole map to draw').toBe(
      g.map.regions.length,
    );
  });

  it('sees the enemy the way the scoreboard already describes them', () => {
    const { g } = newMatch();
    const guest = GameEngine.fromState(snapshotFor(g, 'blue'));
    // "n+ regions, core unknown" — the same answer the host would give.
    expect(guest.intelOn('blue', 'red')).toEqual(g.intelOn('blue', 'red'));
  });
});

describe('a real match, swept for leaks', () => {
  it('never mentions anything on ground the viewer has no eyes on', () => {
    const g = new GameEngine([
      { id: 'blue', name: 'A', color: '#00f', coreRegionId: BLUE_CORE, aiDifficulty: 'hard' },
      { id: 'red', name: 'B', color: '#f00', coreRegionId: RED_CORE, aiDifficulty: 'hard' },
    ]);
    const seats = [new AiController('blue', 'hard'), new AiController('red', 'hard')];

    // Sweep repeatedly: early, while expanding, and once the war is on.
    for (let minute = 0; minute < 20; minute++) {
      for (let step = 0; step < 600; step++) {
        g.tick(TICK_SECONDS);
        for (const seat of seats) seat.update(g, TICK_SECONDS);
      }

      const snapshot = snapshotFor(g, 'blue');
      const seen = g.visibleTo('blue');

      for (const [id, region] of Object.entries(snapshot.regions)) {
        if (seen.has(id)) continue;
        expect(totalUnits(region.units), `garrison leaked at ${id}`).toBe(0);
        expect(region.unrestSeconds, `unrest leaked at ${id}`).toBe(undefined);
        // A wonder is the one thing that shows through the fog, standing or
        // going up. Everything else about that ground stays dark.
        if (region.construction) {
          expect(region.construction.type, `building work leaked at ${id}`).toBe('wonder');
        }
        if (region.building) {
          expect(region.building.type, `building leaked at ${id}`).toBe('wonder');
        }
        if (!region.isCore) {
          expect(region.owner, `ownership leaked at ${id}`).toBe(null);
        }
      }

      // Nothing of theirs is described as standing somewhere we can't look.
      for (const legion of snapshot.legions) {
        if (legion.playerId === 'blue') continue;
        const onTheRoad = snapshot.marches.some((m) => m.legionId === legion.id);
        expect(
          seen.has(legion.regionId) || onTheRoad,
          `their army leaked at ${legion.regionId}`,
        ).toBe(true);
      }
      for (const battle of snapshot.battles) {
        if (battle.attackerId === 'blue' || battle.defenderId === 'blue') continue;
        expect(seen.has(battle.regionId), `a fight leaked at ${battle.regionId}`).toBe(true);
      }
      for (const cart of snapshot.carts) {
        if (cart.playerId === 'blue') continue;
        expect(seen.has(cart.from) || seen.has(cart.to), 'a cart leaked').toBe(true);
      }
    }
  }, 200000);
});

describe('what a snapshot spends its bytes on', () => {
  it('sends no more precision than anyone could see', () => {
    const g = new GameEngine([
      { id: 'blue', name: 'A', color: '#00f', coreRegionId: BLUE_CORE, aiDifficulty: 'hard' },
      { id: 'red', name: 'B', color: '#f00', coreRegionId: RED_CORE, aiDifficulty: 'hard' },
    ]);
    const seats = [new AiController('blue', 'hard'), new AiController('red', 'hard')];
    for (let step = 0; step < 10 * 60 * 10; step++) {
      g.tick(TICK_SECONDS);
      for (const seat of seats) seat.update(g, TICK_SECONDS);
    }

    const wire = JSON.stringify(snapshotFor(g, 'blue'));
    // Supply, hit points and countdowns all grow a tail of floating-point
    // noise. Seventeen digits of it, five times a second, is a lot of nothing.
    expect(wire.match(/\d+\.\d{4,}/g) ?? [], 'runaway fractions on the wire').toEqual([]);
  }, 120000);
});
