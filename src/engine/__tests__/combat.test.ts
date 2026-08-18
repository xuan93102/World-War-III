// Combat resolution (docs/game-design.md 6.2): multi-round attrition, both
// sides trading damage simultaneously, casualties taken weakest-first.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { COMBAT_ROUND_SECONDS, MUTINY_MILITIA, applyDamage, resolveRound } from '../combat';
import { MARCH_SECONDS_PER_HOP } from '../movement';
import { garrisonAt } from '../regions';
import { totalUnits } from '../units';

const CORE = 'taipei-1';
const NEXT_DOOR = 'taipei-2';

function newGame() {
  return new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
  ]);
}

describe('casualties', () => {
  it('spends damage on the cheapest units first', () => {
    // 3 militia (30hp) + 1 marine (500hp). 30 damage should wipe the militia
    // exactly and leave the marine untouched.
    const { units } = applyDamage({ militia: 3, marine: 1 }, 30);
    expect(units).toEqual({ marine: 1 });
  });

  it('keeps the elite core alive while there is chaff to soak', () => {
    const { units } = applyDamage({ militia: 10, marine: 2 }, 55);
    expect(units.marine, 'marines untouched').toBe(2);
    expect(units.militia, '5 of 10 militia lost').toBe(5);
  });

  it('carries damage too small to finish a unit into the next round', () => {
    // Militia have 10hp, so 4 damage kills nobody — but it must not vanish, or
    // a militia (ATK 1) could never kill another militia.
    const first = applyDamage({ militia: 2 }, 4);
    expect(first.units.militia).toBe(2);
    expect(first.carry).toBe(4);

    const second = applyDamage(first.units, 6, first.carry);
    expect(second.units.militia, 'the carried 4 + 6 finishes one off').toBe(1);
    expect(second.carry).toBe(0);
  });

  it('does not bank leftover damage once a stack is gone', () => {
    const { units, carry } = applyDamage({ militia: 1 }, 500);
    expect(totalUnits(units)).toBe(0);
    expect(carry, 'overkill is not saved up').toBe(0);
  });
});

describe('a round', () => {
  it('measures both attacks before either side takes losses', () => {
    // 1 militia each: both have ATK 1 and HP 10, so each round is a mutual
    // scratch and neither can ever gain an edge from striking "first".
    const out = resolveRound({ militia: 1 }, 0, { militia: 1 }, 0);
    expect(out.attacker.carry).toBe(1);
    expect(out.defender.carry).toBe(1);
    expect(out.attackerWiped).toBe(false);
    expect(out.defenderWiped).toBe(false);
  });

  it('lets a dying side land its final blow', () => {
    // 50 militia (ATK 50) against 1 conscript (HP 50): the conscript dies this
    // round, but its own ATK 10 was measured first, so it still kills a
    // militia on the way out.
    const out = resolveRound({ conscript: 1 }, 0, { militia: 50 }, 0);
    expect(out.attackerWiped, 'conscript died').toBe(true);
    expect(out.defenderWiped, 'militia survived').toBe(false);
    expect(out.defender.units.militia, 'but took a casualty on the way out').toBe(49);
  });
});

describe('battles in play', () => {
  /** Sends `count` militia from p1's core into the neighbouring region. */
  /**
   * Marches an army next door and orders it onto the militia there. Since
   * docs 6.6 arriving is only movement — the fight is a separate order.
   */
  function attackNextDoor(g: GameEngine, count: number) {
    g.state.players.p1.money = 1000;
    g.trainUnits(CORE, 'p1', 'militia', count);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: count });
    g.tick(MARCH_SECONDS_PER_HOP);
    g.assault(NEXT_DOOR, 'p1');
  }

  it('starts when an army walks onto defended ground', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    attackNextDoor(g, 5);

    const battle = g.battleAt(NEXT_DOOR);
    expect(battle, 'engaged rather than landed').toBeDefined();
    expect(totalUnits(battle!.attackerUnits)).toBe(5);
    expect(g.state.regions[NEXT_DOOR].owner, 'not taken yet').toBeNull();
  });

  it('grinds down over several rounds rather than resolving on contact', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    attackNextDoor(g, 5);

    g.tick(COMBAT_ROUND_SECONDS);
    const battle = g.battleAt(NEXT_DOOR);
    expect(battle, 'still fighting after one round').toBeDefined();
    expect(battle!.roundsFought).toBe(1);
    // 5 militia deal 5, defenders deal 3 — neither wipes anyone yet.
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR))).toBe(3);
  });

  it('clears the ground without taking it when the defenders are wiped out', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    attackNextDoor(g, 8);

    g.tick(COMBAT_ROUND_SECONDS * 10);
    expect(g.battleAt(NEXT_DOOR), 'over').toBeUndefined();
    // Winning is not taking: occupying is a separate order (docs 6.6).
    expect(g.state.regions[NEXT_DOOR].owner, 'still unclaimed').toBe(null);
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'survivors stand on it').toBeGreaterThan(0);

    expect(g.occupyRejection(NEXT_DOOR, 'p1')).toBe(null);
    expect(g.occupy(NEXT_DOOR, 'p1')).toBe(true);
    expect(g.state.regions[NEXT_DOOR].owner).toBe('p1');
    expect(totalUnits(garrisonAt(g.state, NEXT_DOOR)), 'and keep standing on it').toBeGreaterThan(
      0,
    );
  });

  it('leaves the ground to nobody when both sides are wiped out', () => {
    const g = newGame();
    // Evenly matched militia: simultaneous damage kills both stacks together.
    g.state.regions[NEXT_DOOR].units = { militia: 4 };
    attackNextDoor(g, 4);

    g.tick(COMBAT_ROUND_SECONDS * 20);
    expect(g.battleAt(NEXT_DOOR)).toBeUndefined();
    expect(g.state.regions[NEXT_DOOR].owner, 'neither side took it').toBeNull();
    expect(garrisonAt(g.state, NEXT_DOOR), 'a remnant holds it').toEqual({
      militia: MUTINY_MILITIA,
    });
  });

  it('counts troops committed to an attack against the population cap', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 3 };
    g.state.players.p1.money = 1000;
    g.trainUnits(CORE, 'p1', 'militia', 5);
    const before = g.population('p1');
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 5 });
    g.tick(MARCH_SECONDS_PER_HOP);
    g.assault(NEXT_DOOR, 'p1');

    expect(g.battleAt(NEXT_DOOR)).toBeDefined();
    expect(g.population('p1'), 'still on the books while fighting').toBe(before);
  });

  it('takes reinforcements into an ongoing fight', () => {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 20 };
    // Big enough to still be fighting when the second wave lands.
    attackNextDoor(g, 25);
    g.tick(COMBAT_ROUND_SECONDS);
    const holding = totalUnits(g.battleAt(NEXT_DOOR)!.attackerUnits);

    g.trainUnits(CORE, 'p1', 'militia', 4);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 4 });
    g.tick(MARCH_SECONDS_PER_HOP);

    const battle = g.battleAt(NEXT_DOOR);
    expect(battle, 'the fight is still on').toBeDefined();
    expect(
      totalUnits(battle!.attackerUnits),
      'the newcomers joined it rather than standing beside it',
    ).toBeGreaterThan(holding - 20);
  });
});

describe('breaking off', () => {
  function engagedGame() {
    const g = newGame();
    g.state.regions[NEXT_DOOR].units = { militia: 30 };
    g.state.players.p1.money = 1000;
    g.trainUnits(CORE, 'p1', 'militia', 5);
    g.startMarch(CORE, NEXT_DOOR, 'p1', { militia: 5 });
    g.tick(MARCH_SECONDS_PER_HOP);
    g.assault(NEXT_DOOR, 'p1');
    return g;
  }

  it('is refused before the attack has stood a single round', () => {
    const g = engagedGame();
    expect(g.retreatRejection(NEXT_DOOR, 'p1')).toBe('tooSoon');
    expect(g.retreat(NEXT_DOOR, 'p1')).toBe(false);
  });

  it('marches the survivors back the way they came', () => {
    const g = engagedGame();
    g.tick(COMBAT_ROUND_SECONDS);
    expect(g.retreatRejection(NEXT_DOOR, 'p1')).toBeNull();
    expect(g.retreat(NEXT_DOOR, 'p1')).toBe(true);
    expect(g.battleAt(NEXT_DOOR), 'fight abandoned').toBeUndefined();

    g.tick(MARCH_SECONDS_PER_HOP);
    expect(totalUnits(garrisonAt(g.state, CORE)), 'home again, fewer than set out').toBeGreaterThan(0);
  });

  it('is refused when there is nowhere left to fall back to', () => {
    const g = engagedGame();
    g.tick(COMBAT_ROUND_SECONDS);
    // Losing the ground behind you isn't enough — empty ground can be walked
    // back onto (docs 6.6). It takes enemy troops standing on it to cut a
    // retreat off.
    g.setRegionOwner(CORE, 'p2');
    expect(g.retreatRejection(NEXT_DOOR, 'p1'), 'empty, so still a way home').toBe(null);

    g.state.legions.push({
      id: 'blockers',
      playerId: 'p2',
      units: { militia: 4 },
      supply: 1,
      regionId: CORE,
    });
    expect(g.retreatRejection(NEXT_DOOR, 'p1'), 'cut off').toBe('cutOff');
  });
});
