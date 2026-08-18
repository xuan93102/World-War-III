// Supply carts (docs/game-design.md 7): the only way supply goes back up
// away from a granary, and the only supply unit an enemy can rob.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import {
  CART_BASE_HOP_SECONDS,
  CART_FOOD_LOAD,
  CART_MIN_HOP_SECONDS,
  FOOD_PER_SOLDIER_FULL,
  cartHopSeconds,
} from '../supply';
import { trainNow } from './helpers';

const CORE = 'taipei-1';
const NEXT_DOOR = 'taipei-2';

function newGame() {
  const g = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
  // Fortresses are gated on this tech (docs 5.3).
  g.state.players.p1.techs.push('fieldworks');
  g.state.players.p1.money = 100000;
  g.state.players.p1.food = 100000;
  return g;
}

/** Puts a finished building of `type` on a region p1 owns. */
function build(g: GameEngine, regionId: string, type: 'granary' | 'fortress') {
  if (g.state.regions[regionId].owner !== 'p1') g.setRegionOwner(regionId, 'p1');
  g.startConstruction(regionId, type, 'p1');
  g.tick(61);
}

/** A legion of p1 standing on `regionId`, at the given supply. */
function legionAt(g: GameEngine, regionId: string, militia: number, supply: number) {
  trainNow(g, CORE, 'p1', 'militia', militia);
  if (regionId !== CORE) {
    g.startMarch(CORE, regionId, 'p1', { militia });
    g.tick(g.marchSeconds(CORE, regionId, 'p1') + 1);
  }
  const legion = g.legionsAt(regionId).find((l) => l.playerId === 'p1')!;
  legion.supply = supply;
  return legion;
}

describe('how fast a cart rolls', () => {
  it('starts slow, speeds up per porter, and floors out', () => {
    expect(cartHopSeconds(0)).toBe(CART_BASE_HOP_SECONDS);
    expect(cartHopSeconds(10), 'ten porters, roughly a quarter off').toBe(52);
    // Diminishing, so the second ten porters buy less than the first ten.
    expect(CART_BASE_HOP_SECONDS - cartHopSeconds(10)).toBeGreaterThan(
      cartHopSeconds(10) - cartHopSeconds(20),
    );
    expect(cartHopSeconds(200), 'never beats the floor').toBe(CART_MIN_HOP_SECONDS);
  });
});

describe('dispatching', () => {
  it('needs a granary, a spare cart, porters and a load', () => {
    const g = newGame();
    g.state.players.p1.villagers = 10;
    build(g, NEXT_DOOR, 'fortress');

    expect(g.cartRejection(CORE, NEXT_DOOR, 'p1', 5), 'the core is not a granary').toBe(
      'notGranary',
    );

    build(g, CORE, 'granary');
    expect(g.cartRejection(CORE, NEXT_DOOR, 'p1', 0)).toBe('noPorters');
    expect(g.cartRejection(CORE, NEXT_DOOR, 'p1', 11), 'more porters than villagers').toBe(
      'noPorters',
    );
    expect(g.cartRejection(CORE, NEXT_DOOR, 'p1', 5)).toBe(null);

    g.state.players.p1.food = CART_FOOD_LOAD - 1;
    expect(g.cartRejection(CORE, NEXT_DOOR, 'p1', 5)).toBe('noFood');
  });

  it('will only go somewhere there is something to supply', () => {
    const g = newGame();
    g.state.players.p1.villagers = 10;
    build(g, CORE, 'granary');
    const empty = g.map.region(CORE).neighbors[0];
    expect(g.cartRejection(CORE, empty, 'p1', 5)).toBe('noTarget');

    legionAt(g, empty, 2, 0.5);
    expect(g.cartRejection(CORE, empty, 'p1', 5), 'an army is a target').toBe(null);
  });

  it('takes the porters off the payroll but not out of the population', () => {
    const g = newGame();
    g.state.players.p1.villagers = 10;
    build(g, CORE, 'granary');
    legionAt(g, NEXT_DOOR, 2, 0.5);
    const populationBefore = g.population('p1');

    g.dispatchCart(CORE, NEXT_DOOR, 'p1', 4);
    expect(g.state.players.p1.villagers, 'four stopped earning').toBe(6);
    expect(g.population('p1'), 'but they still take up room').toBe(populationBefore);
    expect(g.cartsAvailable('p1'), 'the only cart is out').toBe(0);
  });

  it('is capped by the transport techs', () => {
    const g = newGame();
    expect(g.supplyCartCap('p1')).toBe(1);
    g.state.players.p1.techs.push('transportCorps1');
    expect(g.supplyCartCap('p1')).toBe(2);
    g.state.players.p1.techs.push('transportCorps2');
    expect(g.supplyCartCap('p1')).toBe(3);
  });
});

describe('a delivery', () => {
  it('fills the army it reaches, then walks home and frees the cart', () => {
    const g = newGame();
    g.state.players.p1.villagers = 10;
    build(g, CORE, 'granary');
    const legion = legionAt(g, NEXT_DOOR, 5, 0.4);

    const cart = g.dispatchCart(CORE, NEXT_DOOR, 'p1', 5)!;
    expect(cart).not.toBe(null);
    g.tick(cart.totalSeconds + 1);

    expect(legion.supply, '5 militia need 30 food; the cart has plenty').toBe(1);
    expect(g.state.carts.length, 'still rolling — it has to get home').toBe(1);
    expect(g.state.carts[0].returning).toBe(true);

    g.tick(g.state.carts[0].totalSeconds + 1);
    expect(g.state.carts.length, 'home').toBe(0);
    expect(g.state.players.p1.villagers, 'porters back on the payroll').toBe(10);
    expect(g.cartsAvailable('p1')).toBe(1);
  });

  it('only buys as much bar as its load covers', () => {
    const g = newGame();
    g.state.players.p1.villagers = 10;
    build(g, CORE, 'granary');
    // 100 militia from empty would need 1000 food; a cart carries 500, so it
    // should land exactly halfway.
    const legion = legionAt(g, NEXT_DOOR, 100, 0);
    const needed = FOOD_PER_SOLDIER_FULL * 100;
    expect(needed).toBeGreaterThan(CART_FOOD_LOAD);

    const cart = g.dispatchCart(CORE, NEXT_DOOR, 'p1', 5)!;
    g.tick(cart.totalSeconds + 1);
    expect(legion.supply).toBeCloseTo(CART_FOOD_LOAD / needed, 5);
  });

  it('stocks a fortress, which then tops up whoever stands there', () => {
    const g = newGame();
    g.state.players.p1.villagers = 10;
    build(g, CORE, 'granary');
    build(g, NEXT_DOOR, 'fortress');

    const cart = g.dispatchCart(CORE, NEXT_DOOR, 'p1', 5)!;
    g.tick(cart.totalSeconds + 1);
    expect(g.state.regions[NEXT_DOOR].building?.stock, 'nobody there to take it').toBe(
      CART_FOOD_LOAD,
    );

    // An army walks in afterwards and drinks from the store.
    const legion = legionAt(g, NEXT_DOOR, 5, 0.4);
    g.tick(1);
    expect(legion.supply).toBe(1);
    expect(g.state.regions[NEXT_DOOR].building?.stock, '5 militia × 60% × 10 food').toBeCloseTo(
      CART_FOOD_LOAD - 30,
      5,
    );
  });
});

describe('interception', () => {
  it('hands the load to whoever it walks into, porters and all', () => {
    const g = newGame();
    g.state.players.p1.villagers = 10;
    build(g, CORE, 'granary');
    legionAt(g, NEXT_DOOR, 2, 0.5);

    const cart = g.dispatchCart(CORE, NEXT_DOOR, 'p1', 5)!;
    const enemyFoodBefore = g.state.players.p2.food;
    // An enemy column moves into the cart's path mid-run. Troops are what
    // intercepts it — empty ground, however owned, it would just roll across.
    g.setRegionOwner(NEXT_DOOR, 'p2');
    g.state.legions.push({
      id: 'raiders',
      playerId: 'p2',
      units: { militia: 4 },
      supply: 1,
      regionId: NEXT_DOOR,
    });
    g.tick(cart.totalSeconds + 1);

    expect(g.state.carts.length, 'the cart is gone').toBe(0);
    // They also earn food from the ground they just took, so bound it rather
    // than matching the load exactly.
    const gained = g.state.players.p2.food - enemyFoodBefore;
    expect(gained, 'they took the load').toBeGreaterThanOrEqual(CART_FOOD_LOAD);
    expect(gained, 'and only the load').toBeLessThan(CART_FOOD_LOAD + 50);
    expect(g.state.players.p1.villagers, 'the porters are lost with it').toBe(5);
  });
});
