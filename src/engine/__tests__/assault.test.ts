// Assaulting (docs/game-design.md 6.6): marching is movement, attacking is an
// order. A neutral garrison doesn't stop a column, and buildings can be
// knocked down without taking the ground they stand on.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { BUILDINGS } from '../buildings';
import { COMBAT_ROUND_SECONDS } from '../combat';
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

/** Marches `militia` from p1's core to `to` and lets them arrive. */
function send(g: GameEngine, to: string, militia: number) {
  g.trainUnits(CORE, 'p1', 'militia', militia);
  g.startMarch(CORE, to, 'p1', { militia });
  g.tick(g.marchSeconds(CORE, to, 'p1') + 1);
}

describe('marching past a neutral garrison', () => {
  it('lands without a fight and leaves the ground unclaimed', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 8 };
    send(g, NEXT_DOOR, 5);

    expect(g.battleAt(NEXT_DOOR), 'the 亂軍 do not start anything').toBeUndefined();
    expect(g.state.regions[NEXT_DOOR].owner, 'not claimed either').toBe(null);
    expect(g.state.regions[NEXT_DOOR].units.militia, 'they are still sitting there').toBe(8);
    expect(g.occupyRejection(NEXT_DOOR, 'p1'), 'and they still hold the deed').toBe('contested');
  });

  it('fights them only when ordered to', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    send(g, NEXT_DOOR, 12);

    expect(g.assaultTargetAt(NEXT_DOOR, 'p1')).toBe('militia');
    expect(g.assault(NEXT_DOOR, 'p1')).toBe(true);
    expect(g.battleAt(NEXT_DOOR), 'a normal battle, docs 6.2').toBeDefined();

    g.tick(COMBAT_ROUND_SECONDS * 10);
    expect(g.battleAt(NEXT_DOOR), 'over').toBeUndefined();
    expect(g.occupyRejection(NEXT_DOOR, 'p1'), 'ground clear, ready to take').toBe(null);
  });

  it('lets the survivors break off in place', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 30 };
    send(g, NEXT_DOOR, 6);
    g.assault(NEXT_DOOR, 'p1');
    g.tick(COMBAT_ROUND_SECONDS);

    expect(g.retreat(NEXT_DOOR, 'p1')).toBe(true);
    expect(g.battleAt(NEXT_DOOR), 'called off').toBeUndefined();
    // Home is the region they marched from, so they fall back there; either
    // way what matters is that they still exist.
    expect(g.state.legions.filter((l) => l.playerId === 'p1').length).toBeGreaterThan(0);
  });
});

describe('knocking a building down', () => {
  it('needs an enemy building to be there at all', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    send(g, NEXT_DOOR, 5);
    expect(g.assaultRejection(NEXT_DOOR, 'p1'), 'bare ground, nothing to hit').toBe('noTarget');

    g.state.regions[NEXT_DOOR].building = { type: 'shop', hp: BUILDINGS.shop.hp };
    expect(g.assaultTargetAt(NEXT_DOOR, 'p1')).toBe('building');
    expect(g.assaultRejection(NEXT_DOOR, 'p1')).toBe(null);
  });

  it('grinds it down and destroys it, leaving the ground theirs', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.regions[NEXT_DOOR].building = { type: 'shop', hp: BUILDINGS.shop.hp };
    send(g, NEXT_DOOR, 10);
    g.assault(NEXT_DOOR, 'p1');

    g.tick(COMBAT_ROUND_SECONDS);
    expect(g.state.regions[NEXT_DOOR].building!.hp, '10 militia, one round').toBeCloseTo(
      BUILDINGS.shop.hp - 10,
      5,
    );

    g.tick(COMBAT_ROUND_SECONDS * 25);
    expect(g.state.regions[NEXT_DOOR].building, 'down').toBe(undefined);
    expect(g.state.regions[NEXT_DOOR].owner, 'ground still theirs — this was a raid').toBe('p2');
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'our raiders are still there').toBe(10);
  });

  it('stops when the army leaves or the fight changes', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.regions[NEXT_DOOR].building = { type: 'shop', hp: BUILDINGS.shop.hp };
    send(g, NEXT_DOOR, 10);
    g.assault(NEXT_DOOR, 'p1');
    g.tick(COMBAT_ROUND_SECONDS);

    // An enemy column arrives: that fight comes first.
    g.state.legions.push({
      id: 'relief',
      playerId: 'p2',
      units: { militia: 4 },
      supply: 1,
      regionId: NEXT_DOOR,
    });
    const hp = g.state.regions[NEXT_DOOR].building!.hp;
    g.tick(COMBAT_ROUND_SECONDS);
    expect(g.state.regions[NEXT_DOOR].building!.hp, 'the order lapsed').toBe(hp);
    expect(
      g.state.legions.find((l) => l.playerId === 'p1' && l.regionId === NEXT_DOOR)!.assaulting,
      'and it is not still queued',
    ).toBe(false);
  });

  it('will not swing at your own buildings', () => {
    const g = newGame();
    send(g, NEXT_DOOR, 5);
    g.startConstruction(NEXT_DOOR, 'shop', 'p1');
    g.tick(31);
    expect(g.assaultTargetAt(NEXT_DOOR, 'p1')).toBe(null);
    expect(g.assaultRejection(NEXT_DOOR, 'p1')).toBe('noTarget');
  });

  it('takes a camp down with its stores', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.regions[NEXT_DOOR].building = {
      type: 'camp',
      hp: BUILDINGS.camp.hp,
      owner: 'p2',
      stock: 400,
    };
    send(g, NEXT_DOOR, 20);
    g.assault(NEXT_DOOR, 'p1');
    g.tick(COMBAT_ROUND_SECONDS * 11);

    expect(g.state.regions[NEXT_DOOR].building, 'tent and stores both gone').toBe(undefined);
  });
});

describe('the order itself', () => {
  it('needs an army of yours standing there', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.regions[NEXT_DOOR].building = { type: 'shop', hp: 250 };
    expect(g.assaultRejection(NEXT_DOOR, 'p1')).toBe('noArmy');
    expect(g.assault(NEXT_DOOR, 'p1')).toBe(false);
  });

  it('can be called off', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.regions[NEXT_DOOR].building = { type: 'shop', hp: 250 };
    send(g, NEXT_DOOR, 10);
    g.assault(NEXT_DOOR, 'p1');
    g.tick(COMBAT_ROUND_SECONDS);
    expect(g.standDown(NEXT_DOOR, 'p1')).toBe(true);

    const hp = g.state.regions[NEXT_DOOR].building!.hp;
    g.tick(COMBAT_ROUND_SECONDS * 3);
    expect(g.state.regions[NEXT_DOOR].building!.hp, 'left standing').toBe(hp);
  });

  it('lapses when the marching order takes the army away', () => {
    const g = newGame();
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.regions[NEXT_DOOR].building = { type: 'shop', hp: 250 };
    send(g, NEXT_DOOR, 10);
    g.assault(NEXT_DOOR, 'p1');
    g.startMarch(NEXT_DOOR, CORE, 'p1', { militia: 10 });

    const hp = g.state.regions[NEXT_DOOR].building!.hp;
    g.tick(MARCH_SECONDS_PER_HOP + 1);
    expect(g.state.regions[NEXT_DOOR].building!.hp, 'nobody left to swing').toBe(hp);
  });
});
