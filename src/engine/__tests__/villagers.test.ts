// Villagers as people on the map (docs/game-design.md 4.2): they walk, they
// die, they staff what's built, and they are the whole reason a building is
// worth anything.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { BUILDINGS, MAX_STAFF, STAFF_BONUS, STAFF_REPAIR_PER_SECOND } from '../buildings';
import { COMBAT_ROUND_SECONDS } from '../combat';
import { placeVillagers, trainNow } from './helpers';

const CORE = 'taipei-1';

function newGame() {
  return new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
}

/** An owned region next door with a finished building on it. */
function shopNextDoor(g: GameEngine, owner = 'p1') {
  const id = g.map.region(CORE).neighbors[0];
  g.setRegionOwner(id, owner);
  g.state.regions[id].building = { type: 'shop', hp: BUILDINGS.shop.hp };
  return id;
}

describe('villagers are units', () => {
  it('appear at the core when bought, standing in the open', () => {
    const g = newGame();
    g.buyVillagers('p1', 10);
    expect(g.ownGarrisonAt(CORE, 'p1').villager, 'they are somewhere, not a number').toBe(10);
    expect(g.villagerCount('p1')).toBe(10);
  });

  it('are not troops, however many of them there are', () => {
    const g = newGame();
    g.buyVillagers('p1', 10);
    expect(g.troopCount('p1'), 'a crowd is not an army').toBe(0);
    expect(g.population('p1'), 'but they are still people under the cap').toBe(10);
  });

  it('march, and are cut down when they walk into an army', () => {
    const g = newGame();
    const field = g.map.region(CORE).neighbors[0];
    placeVillagers(g, 'p1', 20);
    // An enemy company standing in the way.
    g.state.legions.push({
      id: 'them',
      playerId: 'p2',
      units: { militia: 20 },
      supply: 1,
      regionId: field,
    });

    g.startMarch(CORE, field, 'p1', { villager: 20 });
    g.tick(60);
    expect(g.battleAt(field), 'walking into them starts a fight').not.toBe(null);

    g.tick(COMBAT_ROUND_SECONDS * 4);
    expect(g.villagerCount('p1'), 'one hit point each').toBe(0);
  });
});

describe('a building is worth what its crew makes it worth', () => {
  it('produces nothing at all when empty', () => {
    const g = newGame();
    g.buyVillagers('p1', 100);
    const bare = g.economy('p1').moneyPerMin;
    shopNextDoor(g);
    expect(g.economy('p1').moneyPerMin, 'an empty shop is a shed').toBe(bare);
  });

  it('pays STAFF_BONUS per villager, up to a full crew', () => {
    const g = newGame();
    const shop = shopNextDoor(g);
    g.buyVillagers('p1', 100);
    placeVillagers(g, 'p1', MAX_STAFF, shop);

    g.staffBuilding(shop, 'p1', 3);
    const perHead = () => g.economy('p1').moneyPerMin / g.villagerCount('p1');
    expect(perHead()).toBeCloseTo(1 + 3 * STAFF_BONUS, 9);

    g.staffBuilding(shop, 'p1', 99);
    expect(g.state.regions[shop].building!.staff, 'a crew is capped').toBe(MAX_STAFF);
    expect(perHead()).toBeCloseTo(1 + MAX_STAFF * STAFF_BONUS, 9);
  });

  it('only takes villagers standing on the ground it occupies', () => {
    const g = newGame();
    const shop = shopNextDoor(g);
    g.buyVillagers('p1', 50); // at the core, not at the shop
    expect(g.staffRejection(shop, 'p1', 1)).toBe('noVillagers');
    expect(g.staffBuilding(shop, 'p1', 10)).toBe(0);
  });

  it('lets them back out again', () => {
    const g = newGame();
    const shop = shopNextDoor(g);
    placeVillagers(g, 'p1', 10, shop);
    g.staffBuilding(shop, 'p1', 10);
    expect(g.ownGarrisonAt(shop, 'p1').villager ?? 0, 'nobody outside').toBe(0);

    g.unstaffBuilding(shop, 'p1', 4);
    expect(g.state.regions[shop].building!.staff).toBe(6);
    expect(g.ownGarrisonAt(shop, 'p1').villager, 'back in the open').toBe(4);
  });
});

describe('a crew under fire', () => {
  it('patches the building up while it is being knocked down', () => {
    const g = newGame();
    const shop = shopNextDoor(g);
    placeVillagers(g, 'p1', MAX_STAFF, shop);
    g.staffBuilding(shop, 'p1', MAX_STAFF);
    g.state.regions[shop].building!.hp = 100;

    g.tick(10);
    expect(g.state.regions[shop].building!.hp).toBeCloseTo(
      100 + MAX_STAFF * STAFF_REPAIR_PER_SECOND * 10,
      6,
    );

    g.tick(600);
    expect(g.state.regions[shop].building!.hp, 'never past full').toBe(BUILDINGS.shop.hp);
  });

  it('goes down with the building', () => {
    const g = newGame();
    const shop = shopNextDoor(g, 'p2');
    // Their crew, inside their shop.
    g.state.regions[shop].building!.staff = MAX_STAFF;

    g.state.players.p1.money = 1000;
    trainNow(g, CORE, 'p1', 'militia', 60);
    g.startMarch(CORE, shop, 'p1', { militia: 60 });
    g.tick(60);
    g.assault(shop, 'p1');
    g.tick(120);

    expect(g.state.regions[shop].building, 'shop down').toBe(undefined);
    expect(g.villagerCount('p2'), 'and the crew with it').toBe(0);
  });
});

describe('ground with something built on it', () => {
  it('is taken by knocking the building down, not by walking on', () => {
    const g = newGame();
    const shop = shopNextDoor(g, 'p2');
    g.state.players.p1.money = 1000;
    trainNow(g, CORE, 'p1', 'militia', 60);
    g.startMarch(CORE, shop, 'p1', { militia: 60 });
    g.tick(60);

    expect(g.occupyRejection(shop, 'p1'), 'their shop holds the ground').toBe('building');

    g.assault(shop, 'p1');
    g.tick(120);
    expect(g.state.regions[shop].owner, 'the ground comes with the building').toBe('p1');
  });

  it('turns a standing occupy order into a siege', () => {
    const g = newGame();
    const shop = shopNextDoor(g, 'p2');
    g.state.players.p1.money = 1000;
    // A small column, so the siege is still going when we look at it.
    trainNow(g, CORE, 'p1', 'militia', 10);
    g.startMarch(CORE, shop, 'p1', { militia: 10 }, 'occupy');
    // Second by second: one coarse tick would land the column and flatten the
    // shop inside the same step.
    for (let second = 0; second < 40; second++) g.tick(1);

    const mine = g.legionsAt(shop).find((l) => l.playerId === 'p1')!;
    expect(mine.assaulting, 'told to take it, so it storms it').toBe(true);
    expect(g.state.regions[shop].building!.hp, 'and is getting through it').toBeLessThan(
      BUILDINGS.shop.hp,
    );
  });
});
