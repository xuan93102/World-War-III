// Unit production rules: where each tier can be made, what it costs, and the
// upgrade chain. Units cost gold only — they never consume villagers — but
// they do occupy population, so an army and an economy compete for one cap.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { garrisonAt } from '../regions';
import { UNITS, stackAtk, stackHp, totalUnits } from '../units';
import { trainNow, upgradeNow } from './helpers';

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

function newGame() {
  return new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: 'taipei-1' },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
}

/** Gives p1 a second region with a finished academy, and returns its id. */
function withAcademy(g: GameEngine, regionId = 'taipei-2') {
  g.state.players.p1.money = 100000;
  g.state.players.p1.food = 100000;
  g.setRegionOwner(regionId, 'p1');
  g.startConstruction(regionId, 'academy', 'p1');
  g.tick(46);
  return regionId;
}

describe('unit stats', () => {
  it('matches the designed tiers', () => {
    expect([UNITS.militia.atk, UNITS.militia.hp]).toEqual([1, 10]);
    expect([UNITS.conscript.atk, UNITS.conscript.hp]).toEqual([10, 50]);
    expect([UNITS.volunteer.atk, UNITS.volunteer.hp]).toEqual([20, 100]);
    expect([UNITS.marine.atk, UNITS.marine.hp]).toEqual([50, 500]);
  });

  it('prices each tier as designed', () => {
    expect(UNITS.militia.trainCost, 'militia cost 1 at the core').toBe(1);
    expect(UNITS.conscript.trainCost, 'conscripts cost 2').toBe(2);
    expect(UNITS.volunteer.upgradeCost, 'volunteer upgrade costs 2').toBe(2);
    expect(UNITS.marine.upgradeCost, 'marine upgrade costs 3').toBe(3);
  });

  it('sums a mixed stack correctly', () => {
    const stack = { militia: 2, conscript: 1, marine: 1 };
    expect(totalUnits(stack)).toBe(4);
    expect(stackAtk(stack), '2*1 + 10 + 50').toBe(62);
    expect(stackHp(stack), '2*10 + 50 + 500').toBe(570);
  });
});

describe('where units can be produced', () => {
  it('militia come from the core, not from an academy', () => {
    const g = newGame();
    const academy = withAcademy(g);
    expect(g.trainRejection('taipei-1', 'p1', 'militia'), 'core is the militia site').toBe(null);
    expect(g.trainRejection(academy, 'p1', 'militia'), 'academy is not').toBe('wrongSite');
  });

  it('conscripts need an academy and cannot come from the core', () => {
    const g = newGame();
    g.state.players.p1.money = 1000;
    expect(g.trainRejection('taipei-1', 'p1', 'conscript'), 'core cannot train them').toBe('wrongSite');

    const academy = withAcademy(g);
    expect(g.trainRejection(academy, 'p1', 'conscript')).toBe(null);
    expect(trainNow(g, academy, 'p1', 'conscript', 3), 'trained at the academy').toBe(3);
    expect(garrisonAt(g.state, academy).conscript).toBe(3);
    expect(garrisonAt(g.state, 'taipei-1').conscript ?? 0, 'they spawn on the academy tile').toBe(0);
  });

  it('higher tiers cannot be trained fresh at all', () => {
    const g = newGame();
    const academy = withAcademy(g);
    expect(g.trainRejection(academy, 'p1', 'volunteer')).toBe('notTrainable');
    expect(g.trainRejection(academy, 'p1', 'marine')).toBe('notTrainable');
    expect(trainNow(g, academy, 'p1', 'marine', 1)).toBe(0);
  });

  it('training costs gold and nothing else', () => {
    const g = newGame();
    g.state.players.p1.money = 10;
    const before = g.state.players.p1.villagers;
    expect(trainNow(g, 'taipei-1', 'p1', 'militia', 4)).toBe(4);
    expect(g.state.players.p1.money, '4 militia at 1 gold each').toBe(6);
    expect(g.state.players.p1.villagers, 'villagers untouched').toBe(before);
  });

  it('training is capped by gold on hand', () => {
    const g = newGame();
    g.state.players.p1.money = 3;
    expect(trainNow(g, 'taipei-1', 'p1', 'militia', 100), 'only what 3 gold buys').toBe(3);
    expect(g.state.players.p1.money).toBe(0);
  });
});

describe('the upgrade chain', () => {
  it('walks conscript -> volunteer -> marine, at the academy', () => {
    const g = newGame();
    const academy = withAcademy(g);
    trainNow(g, academy, 'p1', 'conscript', 2);

    // A unit type that's been used up drops out of the stack entirely rather
    // than lingering as a zero — same convention subtractUnits follows.
    expect(upgradeNow(g, academy, 'p1', 'volunteer', 2), 'both promoted').toBe(2);
    expect(garrisonAt(g.state, academy).conscript ?? 0, 'sources consumed').toBe(0);
    expect(garrisonAt(g.state, academy).volunteer).toBe(2);

    expect(upgradeNow(g, academy, 'p1', 'marine', 2)).toBe(2);
    expect(garrisonAt(g.state, academy).volunteer ?? 0).toBe(0);
    expect(garrisonAt(g.state, academy).marine).toBe(2);
  });

  it('cannot skip a tier', () => {
    const g = newGame();
    const academy = withAcademy(g);
    trainNow(g, academy, 'p1', 'conscript', 2);
    expect(g.upgradeRejection(academy, 'p1', 'marine'), 'no volunteers to promote').toBe('noSourceUnits');
  });

  it('upgrading costs gold per unit', () => {
    const g = newGame();
    const academy = withAcademy(g);
    trainNow(g, academy, 'p1', 'conscript', 3);
    const before = g.state.players.p1.money;
    upgradeNow(g, academy, 'p1', 'volunteer', 3);
    expect(before - g.state.players.p1.money, '3 upgrades at 2 gold').toBe(6);
  });

  it('upgrading never changes headcount, so it needs no population room', () => {
    const g = newGame();
    const academy = withAcademy(g);
    trainNow(g, academy, 'p1', 'conscript', 5);
    // Fill every remaining slot with villagers.
    g.buyVillagers('p1', g.maxAffordableVillagers('p1'));
    expect(g.populationRoom('p1'), 'cap is full').toBe(0);

    const before = g.population('p1');
    expect(upgradeNow(g, academy, 'p1', 'volunteer', 5), 'still allowed at a full cap').toBe(5);
    expect(g.population('p1'), 'headcount unchanged').toBe(before);
  });

  it('troops must be at an academy region to upgrade', () => {
    const g = newGame();
    const academy = withAcademy(g);
    trainNow(g, academy, 'p1', 'conscript', 2);

    // Move them to a plain region: the upgrade is refused there.
    const plain = 'taipei-3';
    g.setRegionOwner(plain, 'p1');
    station(g, plain, 'p1', { conscript: 2 });
    station(g, academy, 'p1', {});
    expect(g.upgradeRejection(plain, 'p1', 'volunteer'), 'no academy here').toBe('needsAcademy');
  });

  it('a marine is far tougher than the militia it took to fund it', () => {
    // 2 (conscript) + 2 (volunteer) + 3 (marine) = 7 gold, versus 7 militia.
    const marine = { marine: 1 };
    const militia = { militia: 7 };
    expect(stackAtk(marine)).toBeGreaterThan(stackAtk(militia));
    expect(stackHp(marine)).toBeGreaterThan(stackHp(militia));
  });
});

describe('troops do not change sides with the ground', () => {
  it('taking neutral land does not hand you its garrison', () => {
    const g = newGame();
    const defended = Object.keys(g.state.regions).find(
      (id) => totalUnits(garrisonAt(g.state, id)) > 0,
    )!;
    const garrison = totalUnits(garrisonAt(g.state, defended));
    expect(garrison, 'that region really was defended').toBeGreaterThan(0);

    g.setRegionOwner(defended, 'p1');
    expect(totalUnits(garrisonAt(g.state, defended)), 'garrison is gone, not captured').toBe(0);
    expect(g.troopCount('p1'), 'and it did not join your army').toBe(0);
    expect(g.population('p1'), 'nor inflate your population').toBe(0);
  });

  it('losing a region does not gift your army to the enemy', () => {
    const g = newGame();
    g.state.players.p1.money = 100;
    trainNow(g, 'taipei-1', 'p1', 'militia', 10);
    expect(g.troopCount('p1')).toBe(10);

    g.setRegionOwner('taipei-1', 'p2');
    expect(g.troopCount('p2'), 'the enemy gains nothing').toBe(0);
    expect(g.troopCount('p1'), 'and the defenders are lost, not transferred').toBe(0);
  });
});
