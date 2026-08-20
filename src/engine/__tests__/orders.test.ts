// Orders as data (docs/game-design.md 15.2).
//
// The property that matters for networking: an order that has been through
// JSON does exactly what the method call would have done. If that ever stops
// being true, a networked match diverges from a local one in a way that is
// very hard to see and very easy to introduce — an order carrying a Set, a
// Map, a class instance or an undefined would all pass a type check and fail
// here.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { applyOrder, type Order } from '../orders';
import { BUILDINGS } from '../buildings';
import { TICK_SECONDS } from '../clock';
import { placeVillagers, trainNow } from './helpers';

const CORE = 'taipei-1';
const RED = 'kaohsiung-1';

/** A match set up so that every order below has something to act on. */
function newMatch() {
  const g = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: RED },
  ]);
  const player = g.state.players.p1;
  player.money = 5000;
  player.food = 5000;
  player.techs.push('fieldworks', 'mortarCorps');

  const near = g.map.region(CORE).neighbors[0];
  const far = g.map.region(CORE).neighbors[1];
  g.setRegionOwner(near, 'p1');
  g.setRegionOwner(far, 'p1');
  g.state.regions[near].building = { type: 'shop', hp: BUILDINGS.shop.hp };
  g.state.regions[far].building = { type: 'granary', hp: BUILDINGS.granary.hp, stock: 0 };
  placeVillagers(g, 'p1', 30, near);
  placeVillagers(g, 'p1', 30, far);
  trainNow(g, CORE, 'p1', 'militia', 40);
  return { g, near, far };
}

/** Every order the game has, aimed at the match above. */
function everyOrder(near: string, far: string): Order[] {
  return [
    { type: 'buyVillagers', count: 5 },
    { type: 'build', regionId: CORE, building: 'shop' },
    { type: 'cancelBuild', regionId: CORE },
    { type: 'demolish', regionId: near },
    { type: 'train', regionId: CORE, unit: 'militia', count: 3 },
    { type: 'upgrade', regionId: near, unit: 'volunteer', count: 1 },
    { type: 'queueVehicles', regionId: near, unit: 'mortar', count: 1 },
    { type: 'cancelProduction', index: 0 },
    { type: 'march', from: CORE, to: near, units: { militia: 5 } },
    { type: 'march', from: CORE, to: near, units: { militia: 5 }, onArrival: 'occupy' },
    { type: 'orderHere', regionId: CORE, order: 'assault' },
    { type: 'standDown', regionId: CORE },
    { type: 'retreat', regionId: near },
    { type: 'bombard', from: CORE, to: near },
    { type: 'ceaseFire', regionId: CORE },
    { type: 'dispatchCart', from: far, to: near, porters: 4 },
    { type: 'staff', regionId: near, count: 6 },
    { type: 'unstaff', regionId: near, count: 2 },
    { type: 'research', techId: 'homesteadAct' },
    { type: 'upgradeCore' },
    { type: 'trainResearcher' },
  ];
}

describe('an order is data', () => {
  it('survives JSON and does the same thing on the other side', () => {
    const direct = newMatch();
    const wired = newMatch();
    const orders = everyOrder(direct.near, direct.far);

    for (const order of orders) {
      applyOrder(direct.g, 'p1', order);
      applyOrder(wired.g, 'p1', JSON.parse(JSON.stringify(order)) as Order);
      // Step between orders so anything the order started has time to move,
      // and any divergence shows up where it was introduced.
      for (let step = 0; step < 30; step++) {
        direct.g.tick(TICK_SECONDS);
        wired.g.tick(TICK_SECONDS);
      }
      expect(
        JSON.stringify(wired.g.state),
        `diverged at ${order.type}`,
      ).toBe(JSON.stringify(direct.g.state));
    }
  });

  it('loses nothing to serialisation — what goes in comes out', () => {
    for (const order of everyOrder('a', 'b')) {
      expect(JSON.parse(JSON.stringify(order))).toEqual(order);
    }
  });

  it('covers every kind of order the union has', () => {
    // A cheap guard against adding an order type and forgetting to exercise
    // it here. The count is the union's size; update both together.
    const kinds = new Set(everyOrder('a', 'b').map((o) => o.type));
    expect(kinds.size).toBe(20);
  });
});

describe('an order that cannot be carried out', () => {
  it('changes nothing at all, rather than half of something', () => {
    const { g, near } = newMatch();
    const before = JSON.stringify(g.state);

    // Every one of these is refused by the engine for its own reason: no
    // money, nothing there, not yours, no such thing standing.
    const refused: Order[] = [
      { type: 'build', regionId: RED, building: 'shop' },
      { type: 'demolish', regionId: RED },
      { type: 'train', regionId: near, unit: 'tank', count: 1 },
      { type: 'march', from: RED, to: near, units: { militia: 5 } },
      { type: 'staff', regionId: RED, count: 5 },
      { type: 'retreat', regionId: RED },
      { type: 'research', techId: 'mainBattleTank' },
    ];
    for (const order of refused) applyOrder(g, 'p1', order);

    expect(JSON.stringify(g.state)).toBe(before);
  });

  it('cannot be given on behalf of someone else', () => {
    // The order says what to do, never who is doing it: the id comes from
    // the caller. Pointing p2's name at p1's ground buys p2 nothing.
    const { g } = newMatch();
    const theirMoney = g.state.players.p2.money;
    const myMoney = g.state.players.p1.money;

    applyOrder(g, 'p2', { type: 'buyVillagers', count: 10 });

    expect(g.state.players.p1.money, 'their order did not spend my gold').toBe(myMoney);
    expect(g.state.players.p2.money, 'it spent theirs').toBeLessThan(theirMoney);
    expect(g.ownGarrisonAt(RED, 'p2').villager, 'and the villagers are at their core').toBe(10);
  });
});
