// Temporary camps (docs/game-design.md 6.3): the one building an army can put
// up on ground nobody has given it, and a forward depot once it stands.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { CART_FOOD_LOAD } from '../supply';

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

/** Walks `militia` from p1's core into an empty neutral region next door. */
function armyNextDoor(g: GameEngine, militia = 5) {
  g.trainUnits(CORE, 'p1', 'militia', militia);
  g.startMarch(CORE, NEXT_DOOR, 'p1', { militia });
  g.tick(g.marchSeconds(CORE, NEXT_DOOR, 'p1') + 1);
  return g.legionsAt(NEXT_DOOR).find((l) => l.playerId === 'p1')!;
}

describe('pitching one', () => {
  it('needs an army here, not the ground', () => {
    const g = newGame();
    const away = g.map.region(CORE).neighbors[0];
    expect(g.buildRejection(away, 'camp', 'p1'), 'nobody there').toBe('notOwner');
    // Any other building on the same ground stays out of reach.
    expect(g.buildRejection(away, 'shop', 'p1')).toBe('notOwner');

    g.trainUnits(CORE, 'p1', 'militia', 3);
    g.startMarch(CORE, away, 'p1', { militia: 3 });
    g.tick(g.marchSeconds(CORE, away, 'p1') + 1);
    // Walking into empty neutral land takes it, so pick somewhere still
    // neutral to prove the point: an enemy-held region with our army on it
    // isn't reachable without combat, so use the debug setter instead.
    g.setRegionOwner(away, 'p2');
    g.state.legions.push({
      id: 'test-legion',
      playerId: 'p1',
      units: { militia: 3 },
      supply: 1,
      regionId: away,
    });
    expect(g.buildRejection(away, 'camp', 'p1'), 'our army is standing on it').toBe(null);
    expect(g.buildRejection(away, 'shop', 'p1'), 'still not our land').toBe('notOwner');
  });

  it('belongs to whoever pitched it, and takes the region slot', () => {
    const g = newGame();
    armyNextDoor(g);
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.legions.push({
      id: 'test-legion',
      playerId: 'p1',
      units: { militia: 5 },
      supply: 0.5,
      regionId: NEXT_DOOR,
    });

    expect(g.startConstruction(NEXT_DOOR, 'camp', 'p1')).toBe(true);
    g.tick(21);
    expect(g.state.regions[NEXT_DOOR].building).toEqual({ type: 'camp', hp: 200, owner: 'p1' });
    // The landowner's own build slot is now taken by someone else's tent.
    expect(g.buildRejection(NEXT_DOOR, 'shop', 'p2')).toBe('occupied');
    expect(g.supplyDepotAt(NEXT_DOOR, 'p1'), 'ours').toBe(true);
    expect(g.supplyDepotAt(NEXT_DOOR, 'p2'), 'not theirs, though they hold the land').toBe(false);
  });

  it('is razed when the ground changes hands', () => {
    const g = newGame();
    armyNextDoor(g);
    g.startConstruction(NEXT_DOOR, 'camp', 'p1');
    g.tick(21);
    g.state.regions[NEXT_DOOR].building!.stock = 300;

    g.setRegionOwner(NEXT_DOOR, 'p2');
    expect(g.state.regions[NEXT_DOOR].building, 'tent and stores both go').toBe(undefined);
  });

  it('can be struck by its owner wherever it stands', () => {
    const g = newGame();
    armyNextDoor(g);
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.legions.push({
      id: 'test-legion',
      playerId: 'p1',
      units: { militia: 5 },
      supply: 1,
      regionId: NEXT_DOOR,
    });
    g.startConstruction(NEXT_DOOR, 'camp', 'p1');
    g.tick(21);

    expect(g.demolish(NEXT_DOOR, 'p2'), 'not the landowner’s to pull down').toBe(false);
    expect(g.demolish(NEXT_DOOR, 'p1')).toBe(true);
    expect(g.state.regions[NEXT_DOOR].building).toBe(undefined);
  });
});

describe('as a depot', () => {
  it('takes a cart’s load and hands it to the army camped there', () => {
    const g = newGame();
    g.state.players.p1.villagers = 10;
    g.startConstruction(CORE, 'granary', 'p1');
    g.tick(46);

    const legion = armyNextDoor(g, 5);
    g.startConstruction(NEXT_DOOR, 'camp', 'p1');
    g.tick(21);

    // Fill the army first so the cart's load lands in the tent rather than in
    // the soldiers, then drain them and watch the camp feed them back.
    legion.supply = 1;
    const cart = g.dispatchCart(CORE, NEXT_DOOR, 'p1', 5)!;
    expect(cart, 'a camp is a valid destination on its own').not.toBe(null);
    g.tick(cart.totalSeconds + 1);
    expect(g.state.regions[NEXT_DOOR].building?.stock).toBe(CART_FOOD_LOAD);

    legion.supply = 0.4;
    g.tick(1);
    expect(legion.supply, 'the tent tops them straight back up').toBe(1);
    expect(g.state.regions[NEXT_DOOR].building?.stock, '5 militia × 60% × 10 food').toBe(
      CART_FOOD_LOAD - 30,
    );
  });
});
