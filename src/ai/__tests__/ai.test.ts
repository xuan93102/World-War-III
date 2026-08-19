// The local AI seat (docs/game-design.md 13). These run whole matches headless
// — the only way to find out whether the thing actually plays.
import { describe, expect, it } from 'vitest';
import { AiController } from '../AiController';
import { GameEngine } from '../../engine/GameEngine';
import type { AiDifficulty } from '../../engine/types';
import { totalUnits } from '../../engine/units';

const HUMAN_CORE = 'taipei-1';
const AI_CORE = 'kaohsiung-1';

function newMatch(difficulty: AiDifficulty = 'normal') {
  const engine = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: HUMAN_CORE },
    { id: 'ai', name: 'AI', color: '#f00', coreRegionId: AI_CORE, aiDifficulty: difficulty },
  ]);
  return { engine, ai: new AiController('ai', difficulty) };
}

/** Runs the match for `minutes`, ticking the way the game loop does. */
function play(engine: GameEngine, ai: AiController, minutes: number, step = 1) {
  for (let elapsed = 0; elapsed < minutes * 60; elapsed += step) {
    engine.tick(step);
    ai.update(engine, step);
  }
}

describe('an AI left alone', () => {
  it('turns its opening gold into an economy', () => {
    const { engine, ai } = newMatch();
    play(engine, ai, 3);

    expect(
      engine.villagerCount('ai'),
      'bought villagers with the starting purse',
    ).toBeGreaterThan(10);
    expect(engine.economy('ai').moneyPerMin, 'which is income').toBeGreaterThan(10);
  });

  it('expands off its core', () => {
    const { engine, ai } = newMatch();
    expect(engine.ownedRegionCount('ai')).toBe(1);
    play(engine, ai, 6);
    expect(engine.ownedRegionCount('ai'), 'took ground').toBeGreaterThan(1);
  });

  it('builds and raises troops as it goes', () => {
    const { engine, ai } = newMatch();
    play(engine, ai, 6);

    const built = engine
      .ownedRegionIds('ai')
      .filter((id) => engine.state.regions[id].building !== undefined);
    expect(built.length, 'put something up').toBeGreaterThan(0);
    expect(engine.troopCount('ai'), 'and has an army').toBeGreaterThan(0);
  });

  it('keeps a garrison on its core rather than emptying it', () => {
    const { engine, ai } = newMatch();
    play(engine, ai, 8);
    expect(totalUnits(engine.ownGarrisonAt(AI_CORE, 'ai')), 'home guard').toBeGreaterThan(0);
  });

  it('never runs its population past the cap', () => {
    const { engine, ai } = newMatch('hard');
    play(engine, ai, 10);
    expect(engine.population('ai')).toBeLessThanOrEqual(engine.economy('ai').populationCap);
  });
});

describe('difficulty', () => {
  it('leaves the player alone on easy', () => {
    const { engine, ai } = newMatch('easy');
    // Hand the human a region right next to the AI, then look away.
    const border = engine.map.region(AI_CORE).neighbors[0];
    engine.setRegionOwner(border, 'p1');
    play(engine, ai, 10);

    expect(engine.state.regions[border].owner, 'still the human’s').toBe('p1');
    expect(engine.state.players.p1.coreHp, 'core untouched').toBe(5000);
  });

  it('comes for the player on hard', () => {
    const { engine, ai } = newMatch('hard');
    const border = engine.map.region(AI_CORE).neighbors[0];
    engine.setRegionOwner(border, 'p1');
    play(engine, ai, 12);

    // Either it took the region or it's fighting over it — both count as
    // having come for them.
    const taken = engine.state.regions[border].owner === 'ai';
    const fighting = engine.battleAt(border) !== undefined;
    const standing = engine.legionsAt(border).some((l) => l.playerId === 'ai');
    expect(taken || fighting || standing, 'made a move on their ground').toBe(true);
  });

  it('expands faster on hard than on easy', () => {
    const easy = newMatch('easy');
    play(easy.engine, easy.ai, 8);
    const hard = newMatch('hard');
    play(hard.engine, hard.ai, 8);

    expect(hard.engine.ownedRegionCount('ai')).toBeGreaterThanOrEqual(
      easy.engine.ownedRegionCount('ai'),
    );
  });
});

describe('two AIs', () => {
  it('play each other to a finish without the engine falling over', () => {
    const engine = new GameEngine([
      { id: 'a', name: 'A', color: '#00f', coreRegionId: HUMAN_CORE, aiDifficulty: 'hard' },
      { id: 'b', name: 'B', color: '#f00', coreRegionId: AI_CORE, aiDifficulty: 'hard' },
    ]);
    const seats = [new AiController('a', 'hard'), new AiController('b', 'hard')];

    for (let elapsed = 0; elapsed < 25 * 60; elapsed += 1) {
      engine.tick(1);
      for (const seat of seats) seat.update(engine, 1);
      if (engine.getWinner()) break;
    }

    // Not asserting who wins — only that a long match stays coherent.
    for (const id of ['a', 'b']) {
      expect(engine.population(id)).toBeLessThanOrEqual(engine.economy(id).populationCap);
      expect(engine.state.players[id].money).toBeGreaterThanOrEqual(0);
      expect(engine.state.players[id].food).toBeGreaterThanOrEqual(0);
    }
    expect(engine.ownedRegionCount('a') + engine.ownedRegionCount('b')).toBeGreaterThan(2);
  });
});

describe('the ladder and the arsenal', () => {
  /** Puts the AI in a position to promote: an academy, conscripts, money. */
  function readyToPromote() {
    const { engine, ai } = newMatch('hard');
    const site = engine.map.region(AI_CORE).neighbors[0];
    engine.setRegionOwner(site, 'ai');
    engine.state.regions[site].building = { type: 'academy', hp: 300 };
    engine.state.players.ai.money = 500;
    return { engine, ai, site };
  }

  it('promotes conscripts standing at an academy', () => {
    const { engine, ai, site } = readyToPromote();
    engine.state.legions.push({
      id: 'squad',
      playerId: 'ai',
      units: { conscript: 10 },
      supply: 1,
      regionId: site,
    });

    ai.decide(engine);
    const here = engine.ownGarrisonAt(site, 'ai');
    expect(here.conscript ?? 0, 'conscripts went off to be trained').toBeLessThan(10);
  });

  it('holds them at the academy instead of marching them off first', () => {
    const { engine, ai, site } = readyToPromote();
    engine.state.legions.push({
      id: 'squad',
      playerId: 'ai',
      units: { conscript: 30 },
      supply: 1,
      regionId: site,
    });

    ai.decide(engine);
    expect(engine.state.marches.some((m) => m.from === site), 'stayed put').toBe(false);
  });

  it('keeps vehicles a minority of the army', () => {
    const { engine, ai } = newMatch('hard');
    const site = engine.map.region(AI_CORE).neighbors[0];
    engine.setRegionOwner(site, 'ai');
    engine.state.regions[site].building = { type: 'arsenal', hp: 300 };
    engine.state.players.ai.techs.push('mortarCorps');
    // More gold than the whole match would ever produce: the only thing that
    // should stop the arsenal is the doctrine.
    engine.state.players.ai.money = 100000;

    for (let i = 0; i < 200; i++) ai.decide(engine);

    const queued = engine.state.players.ai.production.reduce((n, b) => n + b.remaining, 0);
    const cap = engine.economy('ai').populationCap * 0.35 * 0.25;
    expect(queued, 'stopped at its share of the army').toBeLessThanOrEqual(Math.ceil(cap));
    expect(queued, 'but did build some').toBeGreaterThan(0);
  });
});
