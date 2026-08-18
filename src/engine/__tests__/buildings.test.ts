// Engine-level checks for the building system: construction timing, the
// one-building-per-region rule, stacking bonuses, food caps and the two
// victory paths. These are all things that would take minutes of real time
// to exercise through the UI.
import { describe, expect, it } from 'vitest';
import { GameEngine, STARTING_MONEY } from '../GameEngine';
import { BASE_FOOD_CAP, BUILDINGS, GRANARY_FOOD_CAP, WONDER_HOLD_SECONDS } from '../buildings';
import { FOOD_PER_MIN_BY_SIZE, MILITIA_BY_SIZE, SAFE_ZONE_HOPS, landSizeOf } from '../land';
import { TAIWAN } from '../maps';
import { garrisonAt } from '../regions';
import { totalUnits } from '../units';

function newGame() {
  return new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: 'taipei-1' },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
}

describe('building system', () => {
  it('players start with 10 gold and no villagers', () => {
  const g = newGame();
  expect(STARTING_MONEY).toBe(10);
  expect(g.state.players.p1.money).toBe(STARTING_MONEY);
  expect(g.population('p1'), 'population must be bought').toBe(0);
  expect(g.state.players.p1.villagers, 'no villagers yet').toBe(0);
  expect(g.buildRejection('taipei-1', 'shop', 'p1'), 'buildings are out of reach at first').toBe('cannotAfford');
});

  it('cannot build without resources', () => {
  const g = newGame();
  g.state.players.p1.money = 0;
  expect(g.buildRejection('taipei-1', 'shop', 'p1')).toBe('cannotAfford');
});

  it('cannot build on a region you do not own', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  expect(g.buildRejection('kaohsiung-1', 'shop', 'p1')).toBe('notOwner');
});

  it('buildings gated on research are rejected even when affordable', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.state.players.p1.food = 10000;
  // Every building's own system exists now, so the only gate left is research:
  // a fortress waits on 基礎工事 (docs 5.3).
  expect(g.buildRejection('taipei-1', 'fortress', 'p1')).toBe('notImplemented');
  expect(g.buildRejection('taipei-1', 'arsenal', 'p1'), 'vehicles landed').toBe(null);
  expect(g.buildRejection('taipei-1', 'academy', 'p1'), 'academy is buildable now').toBe(null);
});

  it('starting a build deducts cost and finishes after the build time', () => {
  const g = newGame();
  const cost = BUILDINGS.shop.costMoney;
  g.state.players.p1.money = cost + 50;
  expect(g.startConstruction('taipei-1', 'shop', 'p1')).toBe(true);
  expect(g.state.players.p1.money, 'cost deducted').toBe(50);
  expect(g.state.regions['taipei-1'].construction, 'construction started').toBeTruthy();

  g.tick(29);
  expect(g.state.regions['taipei-1'].construction, 'still building at 29s').toBeTruthy();
  expect(g.state.regions['taipei-1'].building).toBe(undefined);

  g.tick(2);
  expect(g.state.regions['taipei-1'].construction, 'construction cleared').toBe(undefined);
  expect(g.state.regions['taipei-1'].building?.type, 'shop completed').toBe('shop');
  expect(g.state.regions['taipei-1'].building?.hp, 'hp from the def').toBe(250);
});

  it('one building per region', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.startConstruction('taipei-1', 'shop', 'p1');
  g.tick(31);
  expect(g.buildRejection('taipei-1', 'housing', 'p1')).toBe('occupied');
});

  it('cannot queue a second build while one is running', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.startConstruction('taipei-1', 'shop', 'p1');
  expect(g.buildRejection('taipei-1', 'housing', 'p1')).toBe('building');
});

  it('cancelling a build refunds the full cost', () => {
  const g = newGame();
  const cost = BUILDINGS.shop.costMoney;
  g.state.players.p1.money = cost;
  g.startConstruction('taipei-1', 'shop', 'p1');
  g.tick(10);
  // The tick can also pay out, so compare the refund delta rather than the
  // absolute balance.
  const before = g.state.players.p1.money;
  expect(g.cancelConstruction('taipei-1', 'p1')).toBe(true);
  expect(g.state.players.p1.money - before, 'full cost refunded').toBe(cost);
  expect(g.state.regions['taipei-1'].construction).toBe(undefined);
});

  it('shops stack a +20% money bonus each', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.buyVillagers('p1', 100);
  g.setRegionOwner('taipei-2', 'p1');
  g.setRegionOwner('taipei-3', 'p1');
  const base = g.economy('p1').moneyPerMin;
  expect(base, '100 villagers = 100 gold/min').toBe(100);

  g.startConstruction('taipei-2', 'shop', 'p1');
  g.tick(31);
  expect(Math.abs(g.economy('p1').moneyPerMin - base * 1.2) < 1e-9, 'one shop = +20%').toBeTruthy();

  g.startConstruction('taipei-3', 'shop', 'p1');
  g.tick(31);
  expect(Math.abs(g.economy('p1').moneyPerMin - base * 1.4) < 1e-9, 'two shops = +40% (stacking, not multiplicative)').toBeTruthy();
});

  it('gold income comes from villagers, not territory', () => {
  const g = newGame();
  expect(g.economy('p1').moneyPerMin, 'no villagers, no income').toBe(0);

  // Ten more regions must not move the gold rate at all.
  for (const id of ['taipei-2', 'taipei-3', 'taipei-4', 'taipei-5', 'newtaipei-1']) {
    g.setRegionOwner(id, 'p1');
  }
  expect(g.economy('p1').moneyPerMin, 'territory alone earns nothing').toBe(0);

  g.buyVillagers('p1', 10);
  expect(g.economy('p1').moneyPerMin, '10 villagers = 10 gold/min').toBe(10);
});

  it('food still scales with territory, by land size', () => {
  const g = newGame();
  const before = g.economy('p1').foodPerMin;
  g.setRegionOwner('taipei-2', 'p1');
  const added = FOOD_PER_MIN_BY_SIZE[landSizeOf(TAIWAN.region('taipei-2').landArea)];
  expect(g.economy('p1').foodPerMin, 'gains exactly that region’s size tier').toBe(before + added);
});

  it('farms boost food without touching gold', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.buyVillagers('p1', 50);
  g.setRegionOwner('taipei-2', 'p1');
  const before = g.economy('p1');
  g.startConstruction('taipei-2', 'farm', 'p1');
  g.tick(31);
  const after = g.economy('p1');
  expect(after.foodPerMin > before.foodPerMin, 'food up').toBeTruthy();
  expect(after.moneyPerMin, 'gold unchanged').toBe(before.moneyPerMin);
});

  it('granary raises the food cap and food is clamped to it', () => {
  const g = newGame();
  expect(g.economy('p1').foodCap).toBe(BASE_FOOD_CAP);

  g.state.players.p1.food = 99999;
  g.tick(1);
  expect(g.state.players.p1.food, 'clamped to base cap').toBe(BASE_FOOD_CAP);

  g.state.players.p1.money = 10000;
  g.state.players.p1.food = 10000;
  g.setRegionOwner('taipei-2', 'p1');
  g.startConstruction('taipei-2', 'granary', 'p1');
  g.tick(46);
  expect(g.economy('p1').foodCap, 'granary adds capacity').toBe(BASE_FOOD_CAP + GRANARY_FOOD_CAP);
});

  it('losing a region cancels its build and frees nothing else', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.setRegionOwner('taipei-2', 'p1');
  g.startConstruction('taipei-2', 'shop', 'p1');
  g.setRegionOwner('taipei-2', 'p2');
  expect(g.state.regions['taipei-2'].construction, 'build interrupted').toBe(undefined);
});

});

describe('victory conditions', () => {

  it('capturing the enemy core wins', () => {
  const g = newGame();
  expect(g.getWinner()).toBe(null);
  g.setRegionOwner('kaohsiung-1', 'p1');
  expect(g.getWinner()?.id).toBe('p1');
});

  it('a wonder wins only after being held long enough', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.state.players.p1.food = 10000;
  g.setRegionOwner('taipei-2', 'p1');
  g.startConstruction('taipei-2', 'wonder', 'p1');

  g.tick(299);
  expect(g.getWinner(), 'not built yet').toBe(null);
  g.tick(2);
  expect(g.state.regions['taipei-2'].building?.type, 'wonder built').toBe('wonder');
  expect(g.getWinner(), 'built but not held yet').toBe(null);

  g.tick(WONDER_HOLD_SECONDS - 5);
  expect(g.getWinner(), 'still counting down').toBe(null);
  const left = g.wonderCountdown();
  expect(left?.playerId).toBe('p1');
  expect(left && left.secondsLeft > 0 && left.secondsLeft <= 6, `countdown sane: ${left?.secondsLeft}`).toBeTruthy();

  g.tick(6);
  expect(g.getWinner()?.id, 'wonder victory').toBe('p1');
});

  it('losing the wonder resets its hold timer', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.state.players.p1.food = 10000;
  g.setRegionOwner('taipei-2', 'p1');
  g.startConstruction('taipei-2', 'wonder', 'p1');
  g.tick(301);
  g.tick(WONDER_HOLD_SECONDS - 10);

  g.setRegionOwner('taipei-2', 'p2'); // captured!
  expect(g.state.regions['taipei-2'].wonderHeldSeconds, 'timer reset').toBe(undefined);
  g.tick(20);
  expect(g.getWinner(), 'p2 must hold it for the full duration itself').toBe(null);
});

  it('demolishing frees the slot but the core cannot be demolished', () => {
  const g = newGame();
  g.state.players.p1.money = 10000;
  g.setRegionOwner('taipei-2', 'p1');
  g.startConstruction('taipei-2', 'shop', 'p1');
  g.tick(31);
  expect(g.demolish('taipei-2', 'p1')).toBe(true);
  expect(g.state.regions['taipei-2'].building).toBe(undefined);

  g.startConstruction('taipei-1', 'shop', 'p1');
  g.tick(31);
  expect(g.demolish('taipei-1', 'p1'), 'core region refuses demolition').toBe(false);
});

});

describe('villager economy', () => {
  it('a villager costs 1 gold and earns 1 gold per minute', () => {
    const g = newGame();
    expect(g.buyVillagers('p1', 10), 'spends all 10 starting gold').toBe(10);
    expect(g.state.players.p1.money).toBe(0);
    expect(g.state.players.p1.villagers, 'villagers recruited').toBe(10);
    expect(g.population('p1'), 'villagers count toward population').toBe(10);

    g.tick(60);
    expect(g.state.players.p1.money, '10 villagers earn 10 gold in a minute').toBe(10);
  });

  it('reinvesting doubles income each minute until the cap', () => {
    const g = newGame();
    const counts: number[] = [];
    for (let minute = 0; minute < 6; minute++) {
      g.buyVillagers('p1', g.maxAffordableVillagers('p1'));
      counts.push(g.state.players.p1.villagers);
      g.tick(60);
    }
    // 10 -> 20 -> 40 -> 80 -> 160 -> 200 (capped)
    expect(counts).toEqual([10, 20, 40, 80, 160, 200]);
    expect(g.economy('p1').populationCap, 'base cap with no housing').toBe(200);
  });

  it('cannot buy more villagers than gold or the cap allow', () => {
    const g = newGame();
    expect(g.buyVillagers('p1', 999), 'limited by the 10 starting gold').toBe(10);

    g.state.players.p1.money = 10000;
    expect(g.buyVillagers('p1', 9999), 'limited by the population cap').toBe(190);
    expect(g.population('p1')).toBe(200);
    expect(g.maxAffordableVillagers('p1'), 'no room left').toBe(0);
    expect(g.buyVillagers('p1', 5), 'buying at the cap is a no-op').toBe(0);
  });

  it('housing raises the population cap by 20% each, up to 3', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    const regions = ['taipei-2', 'taipei-3', 'taipei-4', 'taipei-5'];
    for (const id of regions) g.setRegionOwner(id, 'p1');

    expect(g.economy('p1').populationCap).toBe(200);

    g.startConstruction(regions[0], 'housing', 'p1');
    g.tick(31);
    expect(g.economy('p1').populationCap, 'one housing = +20%').toBe(240);

    g.startConstruction(regions[1], 'housing', 'p1');
    g.tick(31);
    g.startConstruction(regions[2], 'housing', 'p1');
    g.tick(31);
    expect(g.economy('p1').populationCap, 'three housing = +60%').toBe(320);

    expect(g.buildRejection(regions[3], 'housing', 'p1'), 'a fourth is refused').toBe('limitReached');
  });

  it('the housing limit counts builds already in progress', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    const regions = ['taipei-2', 'taipei-3', 'taipei-4', 'taipei-5'];
    for (const id of regions) g.setRegionOwner(id, 'p1');

    // Queue three at once without letting any finish.
    for (let i = 0; i < 3; i++) expect(g.startConstruction(regions[i], 'housing', 'p1')).toBe(true);
    expect(g.buildRejection(regions[3], 'housing', 'p1'), 'queued builds count toward the limit').toBe('limitReached');
  });

  it('raising then losing housing clamps population back down', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    g.setRegionOwner('taipei-2', 'p1');
    g.startConstruction('taipei-2', 'housing', 'p1');
    g.tick(31);
    g.buyVillagers('p1', 240);
    expect(g.population('p1')).toBe(240);

    g.demolish('taipei-2', 'p1');
    g.tick(1);
    expect(g.population('p1'), 'clamped to the lower cap').toBe(200);
    expect(g.state.players.p1.villagers, 'the lost headcount was villagers').toBe(200);
  });
});

describe('population: villagers and troops share one cap', () => {
  it('with no troops, population is just the villagers', () => {
    const g = newGame();
    g.state.players.p1.money = 1000;
    g.buyVillagers('p1', 40);
    expect(g.population('p1'), 'total headcount').toBe(40);
    expect(g.troopCount('p1'), 'no troops yet').toBe(0);
  });

  it('training troops raises population without touching villagers', () => {
    const g = newGame();
    g.state.players.p1.money = 1000;
    g.buyVillagers('p1', 100);
    expect(g.economy('p1').moneyPerMin).toBe(100);

    const trained = g.trainUnits('taipei-1', 'p1', 'militia', 40);
    expect(trained, 'militia come out of the core').toBe(40);
    expect(g.state.players.p1.villagers, 'villagers are not converted').toBe(100);
    expect(g.troopCount('p1')).toBe(40);
    expect(g.population('p1'), 'troops count toward population').toBe(140);
    expect(g.economy('p1').moneyPerMin, 'income is unchanged by training').toBe(100);
  });

  it('an army squeezes out villagers by eating the shared cap', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    g.trainUnits('taipei-1', 'p1', 'militia', 150);
    expect(g.populationRoom('p1'), 'only 50 slots left of 200').toBe(50);
    expect(g.buyVillagers('p1', 999), 'villagers limited by what the army left').toBe(50);
    expect(
      g.economy('p1').moneyPerMin,
      'a 150-strong army caps income at 50/min instead of 200/min',
    ).toBe(50);
  });

  it('recruiting is blocked once the cap is reached, whoever filled it', () => {
    const g = newGame();
    g.state.players.p1.money = 100000;
    g.buyVillagers('p1', 200);
    expect(g.populationRoom('p1')).toBe(0);
    expect(g.trainUnits('taipei-1', 'p1', 'militia', 5), 'no room for troops either').toBe(0);
  });
});

describe('gold payout timing', () => {
  it('pays nothing until a full minute has elapsed', () => {
    const g = newGame();
    g.buyVillagers('p1', 10);
    expect(g.state.players.p1.money, 'spent it all on villagers').toBe(0);

    g.tick(59);
    expect(g.state.players.p1.money, 'no trickle before the minute is up').toBe(0);
    expect(g.state.secondsUntilPayout).toBeCloseTo(1);

    g.tick(1);
    expect(g.state.players.p1.money, 'the whole minute arrives at once').toBe(10);
    expect(g.state.secondsUntilPayout, 'timer resets').toBe(60);
  });

  it('pays once per minute, not per tick', () => {
    const g = newGame();
    g.buyVillagers('p1', 10);
    // 300 x 0.2s ticks = 60s: a trickle model would pay every tick.
    for (let i = 0; i < 300; i++) g.tick(0.2);
    expect(g.state.players.p1.money, 'exactly one instalment').toBe(10);
  });

  it('covers several intervals if a large delta arrives at once', () => {
    const g = newGame();
    g.buyVillagers('p1', 10);
    g.tick(180);
    expect(g.state.players.p1.money, 'three instalments').toBe(30);
  });

  it('an instalment reflects the villager count at payout time', () => {
    const g = newGame();
    g.buyVillagers('p1', 10);
    g.tick(30);
    g.state.players.p1.money += 5;
    g.buyVillagers('p1', 5); // mid-cycle recruits
    g.tick(30);
    expect(g.state.players.p1.money, '15 villagers at the moment of payout').toBe(15);
  });

  it('the elapsed clock tracks real time independently of payouts', () => {
    const g = newGame();
    g.tick(25);
    expect(g.state.elapsedSeconds).toBe(25);
    g.tick(50);
    expect(g.state.elapsedSeconds).toBe(75);
    expect(g.state.secondsUntilPayout, 'one payout consumed').toBeCloseTo(45);
  });
});

describe('building prices vs the villager economy', () => {
  // Prices are tuned against a REALISTIC working economy, not the population
  // cap: soldiers, researchers and supply crews all come out of the same
  // population pool, so a side that's actually fighting only has a fraction
  // of its headcount still earning. Pricing off the theoretical all-villager
  // cap (200/min) overestimated income roughly tenfold and made everything
  // unreachable in practice.
  const WORKING_INCOME = 30; // ~30 villagers still on the payroll mid-match

  it('nothing is affordable from the 10 starting gold', () => {
    for (const def of Object.values(BUILDINGS)) {
      expect(def.costMoney, `${def.type} must cost more than the opening purse`).toBeGreaterThan(
        STARTING_MONEY,
      );
    }
  });

  it('economy buildings cost about a minute of a working economy', () => {
    for (const type of ['shop', 'housing', 'farm'] as const) {
      const minutes = BUILDINGS[type].costMoney / WORKING_INCOME;
      expect(minutes, `${type} too cheap`).toBeGreaterThanOrEqual(0.5);
      expect(minutes, `${type} too expensive`).toBeLessThanOrEqual(2);
    }
  });

  it('a shop pays for itself well inside a match', () => {
    // A shop adds 20% of current income.
    const paybackMinutes = BUILDINGS.shop.costMoney / (WORKING_INCOME * 0.2);
    expect(paybackMinutes, 'shop payback should be worth making').toBeLessThanOrEqual(10);
    expect(paybackMinutes, 'and not instant').toBeGreaterThanOrEqual(2);
  });

  it('the wonder is a genuine late-game commitment', () => {
    const minutes = BUILDINGS.wonder.costMoney / WORKING_INCOME;
    expect(minutes, 'wonder should take many minutes of income').toBeGreaterThanOrEqual(5);
  });

  it('military and storage buildings are gated by food, not gold', () => {
    // Food comes from territory, so these are the buildings that make taking
    // ground pay off — their gold cost should be the lesser constraint.
    for (const type of ['granary', 'academy', 'arsenal', 'fortress'] as const) {
      const def = BUILDINGS[type];
      expect(def.costFood, `${type} should lean on food`).toBeGreaterThan(def.costMoney);
    }
  });

  it('the wonder cannot be afforded without a granary', () => {
    // Base food storage is below the wonder's food cost, so you must raise
    // the cap first — an intentional dependency rather than an oversight.
    expect(BUILDINGS.wonder.costFood).toBeGreaterThan(BASE_FOOD_CAP);
    expect(BUILDINGS.wonder.costFood).toBeLessThanOrEqual(BASE_FOOD_CAP + GRANARY_FOOD_CAP);
  });

  it('every other building fits inside base food storage', () => {
    for (const def of Object.values(BUILDINGS)) {
      if (def.type === 'wonder') continue;
      expect(def.costFood, `${def.type} should not require a granary`).toBeLessThanOrEqual(
        BASE_FOOD_CAP,
      );
    }
  });
});

describe('opening pacing', () => {
  it('a first shop is reachable within a few minutes of optimal play', () => {
    // Optimal opening is to reinvest every payout into villagers; the
    // question is how long before a building is also within reach.
    const g = newGame();
    let firstAffordableMinute: number | null = null;

    for (let minute = 1; minute <= 10; minute++) {
      g.buyVillagers('p1', g.maxAffordableVillagers('p1'));
      g.tick(60);
      if (firstAffordableMinute === null && g.buildRejection('taipei-1', 'shop', 'p1') === null) {
        firstAffordableMinute = minute;
      }
    }

    expect(firstAffordableMinute, 'buildings should not be locked out of the early game').not.toBeNull();
    expect(firstAffordableMinute!, 'reachable within a few minutes').toBeLessThanOrEqual(4);
    expect(firstAffordableMinute!, 'but not on the opening tick').toBeGreaterThanOrEqual(2);
  });

  it('building early costs growth in the short run but is repaid by the cap', () => {
    const pure = newGame();
    const builder = newGame();
    let built = false;
    const villagersAt: { minute: number; pure: number; builder: number }[] = [];

    for (let minute = 1; minute <= 6; minute++) {
      pure.buyVillagers('p1', pure.maxAffordableVillagers('p1'));
      pure.tick(60);

      // The builder buys a shop the first minute it can afford one, and
      // reinvests in villagers otherwise.
      if (!built && builder.startConstruction('taipei-1', 'shop', 'p1')) {
        built = true;
      } else {
        builder.buyVillagers('p1', builder.maxAffordableVillagers('p1'));
      }
      builder.tick(60);

      villagersAt.push({
        minute,
        pure: pure.state.players.p1.villagers,
        builder: builder.state.players.p1.villagers,
      });
    }

    expect(built, 'the builder managed to afford a shop').toBe(true);
    expect(builder.state.regions['taipei-1'].building?.type, 'and it finished').toBe('shop');

    // Mid-game the skipped reinvestment shows up as a smaller workforce...
    const midGame = villagersAt.find((v) => v.minute === 5)!;
    expect(midGame.pure, 'pure compounding is ahead before the cap binds').toBeGreaterThan(
      midGame.builder,
    );

    // ...but the shop's multiplier refills the gap once the cap is the
    // binding constraint, so building early is not a lasting setback.
    const end = villagersAt[villagersAt.length - 1];
    expect(end.builder, 'the builder catches up at the cap').toBe(end.pure);
    expect(
      builder.economy('p1').moneyPerMin,
      'and ends richer, because the shop keeps paying',
    ).toBeGreaterThan(pure.economy('p1').moneyPerMin);
  });
});

describe('land: garrisons and size', () => {
  it('neutral land within 2 hops of a core starts undefended', () => {
    const g = newGame();
    for (const id of Object.keys(g.state.regions)) {
      const nearACore =
        TAIWAN.distance('taipei-1', id) <= SAFE_ZONE_HOPS ||
        TAIWAN.distance('kaohsiung-1', id) <= SAFE_ZONE_HOPS;
      if (nearACore) {
        expect(totalUnits(garrisonAt(g.state, id)), `${id} is in a safe zone`).toBe(0);
      }
    }
  });

  it('neutral land outside the safe zones is garrisoned by land size', () => {
    const g = newGame();
    let checked = 0;
    for (const [id, region] of Object.entries(g.state.regions)) {
      const nearACore =
        TAIWAN.distance('taipei-1', id) <= SAFE_ZONE_HOPS ||
        TAIWAN.distance('kaohsiung-1', id) <= SAFE_ZONE_HOPS;
      if (nearACore || region.isCore) continue;
      expect(totalUnits(garrisonAt(g.state, id)), `${id} garrison matches its size`).toBe(
        MILITIA_BY_SIZE[landSizeOf(TAIWAN.region(id).landArea)],
      );
      checked++;
    }
    expect(checked, 'there is contested land to garrison').toBeGreaterThan(20);
  });

  it('bigger land gives both more food and a bigger garrison', () => {
    const sizes = ['small', 'medium', 'large', 'huge'] as const;
    for (let i = 1; i < sizes.length; i++) {
      expect(
        FOOD_PER_MIN_BY_SIZE[sizes[i]],
        `${sizes[i]} feeds more than ${sizes[i - 1]}`,
      ).toBeGreaterThan(FOOD_PER_MIN_BY_SIZE[sizes[i - 1]]);
      expect(
        MILITIA_BY_SIZE[sizes[i]],
        `${sizes[i]} defends harder than ${sizes[i - 1]}`,
      ).toBeGreaterThan(MILITIA_BY_SIZE[sizes[i - 1]]);
    }
  });

  it('cores themselves hold no militia', () => {
    const g = newGame();
    expect(totalUnits(garrisonAt(g.state, 'taipei-1'))).toBe(0);
    expect(totalUnits(garrisonAt(g.state, 'kaohsiung-1'))).toBe(0);
  });

  // The old captureRejection() lived here. Taking ground is occupy() now
  // (docs 6.6), and occupy.test.ts covers the rules it used to state.
});
