// The local AI seat (docs/game-design.md 13). These run whole matches headless
// — the only way to find out whether the thing actually plays.
import { describe, expect, it } from 'vitest';
import { AiController } from '../AiController';
import { GameEngine } from '../../engine/GameEngine';
import type { AiDifficulty } from '../../engine/types';
import { totalUnits, troopsOnly } from '../../engine/units';
import { placeVillagers } from '../../engine/__tests__/helpers';
import { BUILDINGS } from '../../engine/buildings';
import { CORE_UPGRADE, MAX_CORE_LEVEL, TECHS } from '../../engine/tech';

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

describe('war, not a parade', () => {
  /** Two seats, played out headless. */
  function machineWar(minutes: number) {
    const engine = new GameEngine([
      { id: 'a', name: 'A', color: '#00f', coreRegionId: HUMAN_CORE, aiDifficulty: 'hard' },
      { id: 'b', name: 'B', color: '#f00', coreRegionId: AI_CORE, aiDifficulty: 'hard' },
    ]);
    const seats = [new AiController('a', 'hard'), new AiController('b', 'hard')];
    const owner = new Map<string, string | null>();
    let takenFromPlayer = 0;
    for (let elapsed = 0; elapsed < minutes * 60; elapsed += 1) {
      engine.tick(1);
      for (const seat of seats) seat.update(engine, 1);
      for (const region of engine.map.regions) {
        const now = engine.state.regions[region.id].owner;
        const was = owner.get(region.id);
        if (was !== undefined && was !== null && now !== null && was !== now) takenFromPlayer++;
        owner.set(region.id, now);
      }
      if (engine.getWinner()) break;
    }
    return { engine, takenFromPlayer };
  }

  it('masses an army instead of leaving it strung out on the road', () => {
    const { engine } = machineWar(20);
    const marching = new Set(engine.state.marches.map((m) => m.legionId));
    const biggest = (id: string) =>
      Math.max(
        0,
        ...engine.state.legions
          .filter((l) => l.playerId === id && !marching.has(l.id))
          .map((l) => totalUnits(troopsOnly(l.units))),
      );

    // The failure this guards against is a rally point recomputed every cycle:
    // the whole army lives permanently in transit, in columns of one, and
    // never reaches fighting weight however many troops get trained.
    expect(Math.max(biggest('a'), biggest('b')), 'someone has a real army').toBeGreaterThan(12);
  });

  it('actually takes ground off the other player', () => {
    const { takenFromPlayer } = machineWar(30);
    expect(takenFromPlayer, 'regions changed hands between the two of them').toBeGreaterThan(0);
  });
});

describe('digging in', () => {
  /** An AI that holds a mountain pass, has met the enemy, and can pay. */
  function atThePass() {
    const engine = new GameEngine([
      { id: 'p1', name: 'A', color: '#00f', coreRegionId: HUMAN_CORE },
      { id: 'ai', name: 'AI', color: '#f00', coreRegionId: AI_CORE, aiDifficulty: 'hard' },
    ]);
    const ai = new AiController('ai', 'hard');
    const me = engine.state.players.ai;
    me.money = 5000;
    me.food = 5000;
    me.techs.push('fieldworks');
    placeVillagers(engine, 'ai', 60);

    // A region of ours with a mountain pass on its border.
    const pass = engine.map.regions.find((r) =>
      r.neighbors.some((n) => engine.map.isPass(r.id, n)),
    )!.id;
    engine.setRegionOwner(pass, 'ai');
    // And an enemy in plain sight, so we know there is a war on.
    const border = engine.map.region(AI_CORE).neighbors[0];
    engine.setRegionOwner(border, 'p1');
    return { engine, ai, pass };
  }

  it('shuts a pass with a fortress rather than building one anywhere', () => {
    const { engine, ai, pass } = atThePass();
    for (let think = 0; think < 5; think++) ai.decide(engine);

    const region = engine.state.regions[pass];
    // A fortress is worth its three hundred food where there is no way round
    // it, and much less anywhere else (docs 5.3).
    expect(
      region.building?.type === 'fortress' || region.construction?.type === 'fortress',
      'fortified the pass',
    ).toBe(true);
  });

  it('digs a trench on the ground nearest them', () => {
    const { engine, ai } = atThePass();
    // No pass to shut: the fortress option is off, the trench is not.
    engine.state.players.ai.techs.length = 0;
    for (let think = 0; think < 5; think++) ai.decide(engine);

    const dug = engine
      .ownedRegionIds('ai')
      .filter((id) => engine.state.regions[id].construction?.type === 'trench');
    expect(dug.length, 'dug in somewhere').toBeGreaterThan(0);
    // And at the gate: nothing of ours is closer to them than the trench is.
    const theirCore = engine.state.players.p1.coreRegionId;
    const distances = engine
      .ownedRegionIds('ai')
      .filter((id) => !engine.state.regions[id].building)
      .map((id) => engine.map.distance(id, theirCore));
    expect(engine.map.distance(dug[0], theirCore)).toBe(Math.min(...distances));
  });

  it('does not fortify a border nobody has come near', () => {
    const { engine, ai, pass } = atThePass();
    // Take the enemy back out of sight. Spending three hundred food on a wall
    // against nobody is the cheapest way to lose on economy.
    for (const id of engine.ownedRegionIds('p1')) engine.setRegionOwner(id, null);
    for (let think = 0; think < 5; think++) ai.decide(engine);

    expect(engine.state.regions[pass].construction?.type).not.toBe('fortress');
    const dug = engine
      .ownedRegionIds('ai')
      .filter((id) => engine.state.regions[id].construction?.type === 'trench');
    expect(dug, 'nothing dug').toEqual([]);
  });
});

describe('clearing a slot', () => {
  /** Every region ours, all built on, with a trench stranded in the middle. */
  function fullyBuilt() {
    const engine = new GameEngine([
      { id: 'p1', name: 'A', color: '#00f', coreRegionId: HUMAN_CORE },
      { id: 'ai', name: 'AI', color: '#f00', coreRegionId: AI_CORE, aiDifficulty: 'hard' },
    ]);
    const ai = new AiController('ai', 'hard');
    const me = engine.state.players.ai;
    me.money = 5000;
    me.food = 5000;
    placeVillagers(engine, 'ai', 60);

    // A ring of ours around one region, so that middle one has our ground on
    // every side — nobody can walk onto whatever is standing there.
    const middle = engine.map.region(AI_CORE).neighbors[0];
    engine.setRegionOwner(middle, 'ai');
    for (const n of engine.map.region(middle).neighbors) engine.setRegionOwner(n, 'ai');
    engine.state.regions[middle].building = { type: 'trench', hp: BUILDINGS.trench.hp };
    // Everything else of ours is spoken for, so there is nowhere left to build.
    for (const id of engine.ownedRegionIds('ai')) {
      if (id === middle || engine.state.regions[id].isCore) continue;
      if (!engine.state.regions[id].building) {
        engine.state.regions[id].building = { type: 'shop', hp: BUILDINGS.shop.hp };
      }
    }
    return { engine, ai, middle };
  }

  it('pulls down a defence nobody can reach when it needs the ground', () => {
    const { engine, ai, middle } = fullyBuilt();
    for (let think = 0; think < 3; think++) ai.decide(engine);

    // A trench stops whoever walks onto it; with our own ground on every side
    // of it, nobody ever will. The border moved and it did not.
    expect(engine.state.regions[middle].building?.type).not.toBe('trench');
  });

  it('leaves it alone while there is anywhere else to build', () => {
    const { engine, ai, middle } = fullyBuilt();
    // One empty field is all it takes: pulling a building down is a pure loss
    // unless the ground under it is worth more than it is. One decision, since
    // the next one will have built on that field and be short again.
    const spare = engine.map.regions.find(
      (r) => engine.state.regions[r.id].owner === null,
    )!.id;
    engine.setRegionOwner(spare, 'ai');

    ai.decide(engine);
    expect(engine.state.regions[middle].building?.type, 'still there').toBe('trench');
  });

  it('never pulls down a defence that is still on the border', () => {
    const { engine, ai, middle } = fullyBuilt();
    // Hand one neighbour back: the trench is a border post again.
    const exposed = engine.map.region(middle).neighbors[0];
    engine.setRegionOwner(exposed, 'p1');

    for (let think = 0; think < 3; think++) ai.decide(engine);
    expect(engine.state.regions[middle].building?.type, 'still doing its job').toBe('trench');
  });
});

describe('saving up for the things gold cannot buy in a hurry', () => {
  /** Every region on the board, so there is somewhere to put anything. */
  function withLand(engine: GameEngine) {
    for (const region of engine.map.regions) engine.setRegionOwner(region.id, 'ai');
  }

  it('does not hold anything back while the economy is still starting', () => {
    // The opening purse is ten gold. Saving out of that buys nothing and
    // earns nothing, and the AI never gets off the ground — which is exactly
    // what the first version of this did.
    const { engine, ai } = newMatch();
    play(engine, ai, 3);
    expect(engine.villagerCount('ai'), 'spent it on the villager loop').toBeGreaterThan(10);
  });

  it('raises the core once there is nothing left to learn at this level', () => {
    const { engine, ai } = newMatch('hard');
    withLand(engine);
    const me = engine.state.players.ai;
    // Everything level one has to offer, already learnt.
    for (const tech of Object.values(TECHS)) {
      if (tech.coreLevel === 1 && tech.implemented) me.techs.push(tech.id);
    }
    me.money = CORE_UPGRADE[2].costMoney + 500;
    me.food = CORE_UPGRADE[2].costFood + 500;
    placeVillagers(engine, 'ai', 60, AI_CORE);

    for (let i = 0; i < 12 && me.coreLevel === 1; i++) ai.decide(engine);

    // Before this, promotions alone would absorb the surplus every cycle and
    // the upgrade was never once affordable.
    const started = engine.coreUpgradeRejection('ai') === 'inProgress' || me.coreLevel > 1;
    expect(started, 'started the upgrade').toBe(true);
  });

  it('goes for the wonder once there is nothing else gold can buy', () => {
    const { engine, ai } = newMatch('hard');
    withLand(engine);
    const me = engine.state.players.ai;
    me.coreLevel = MAX_CORE_LEVEL;
    for (const tech of Object.values(TECHS)) {
      if (tech.implemented) me.techs.push(tech.id);
    }
    me.money = BUILDINGS.wonder.costMoney + 1000;
    me.food = BUILDINGS.wonder.costFood + 500;
    placeVillagers(engine, 'ai', 60, AI_CORE);

    for (let i = 0; i < 20; i++) ai.decide(engine);

    const raising = Object.values(engine.state.regions).some(
      (r) => r.construction?.type === 'wonder' || r.building?.type === 'wonder',
    );
    expect(raising, 'the one thing left that wins the game outright').toBe(true);
  });

  it('puts it on ground with its own on every side', () => {
    const { engine, ai } = newMatch('hard');
    withLand(engine);
    const me = engine.state.players.ai;
    me.coreLevel = MAX_CORE_LEVEL;
    for (const tech of Object.values(TECHS)) {
      if (tech.implemented) me.techs.push(tech.id);
    }
    // One border region, everything else interior.
    engine.setRegionOwner(HUMAN_CORE, 'p1');
    me.money = BUILDINGS.wonder.costMoney + 1000;
    me.food = BUILDINGS.wonder.costFood + 500;
    placeVillagers(engine, 'ai', 60, AI_CORE);

    for (let i = 0; i < 20; i++) ai.decide(engine);

    const site = Object.entries(engine.state.regions).find(
      ([, r]) => r.construction?.type === 'wonder' || r.building?.type === 'wonder',
    );
    expect(site, 'it built one').toBeTruthy();
    // Five minutes to build and then a hold to survive is a long time to
    // stand on a border.
    const exposed = engine.map
      .region(site![0])
      .neighbors.some((n) => engine.state.regions[n].owner !== 'ai');
    expect(exposed, 'not on the frontier').toBe(false);
  });
});
