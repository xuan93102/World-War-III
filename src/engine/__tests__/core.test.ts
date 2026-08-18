// The core (docs/game-design.md 6.7): it has hit points, it can't be taken,
// and knocking it down needs a line of held ground reaching it.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { CORE_HP } from '../buildings';
import { COMBAT_ROUND_SECONDS } from '../combat';
import { stackAtk } from '../units';

const CORE = 'taipei-1';
const ENEMY_CORE = 'taipei-5';

function newGame() {
  // Cores close together, so a line of held ground is a short one to build.
  const g = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: CORE },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: ENEMY_CORE },
  ]);
  g.state.players.p1.money = 100000;
  g.state.players.p1.food = 100000;
  return g;
}

/** Puts `militia` of p1 on the enemy core region, with nobody defending it. */
function besiege(g: GameEngine, militia = 20) {
  g.state.legions.push({
    id: 'besiegers',
    playerId: 'p1',
    units: { militia },
    supply: 1,
    regionId: ENEMY_CORE,
    // Standing on a core does nothing by itself — it's an order (docs 6.6).
    assaulting: true,
  });
}

/** Hands p1 every region on one path from its core to the enemy's. */
function holdRouteToEnemyCore(g: GameEngine) {
  const route = g.map.regions
    .map((r) => r.id)
    .filter((id) => id !== CORE && id !== ENEMY_CORE && g.map.distance(CORE, id) === 1)
    .find((id) => g.map.region(id).neighbors.includes(ENEMY_CORE));
  if (!route) throw new Error('no one-hop link between the two cores');
  g.setRegionOwner(route, 'p1');
  return route;
}

describe('hit points', () => {
  it('start full and end the match at zero', () => {
    const g = newGame();
    expect(g.state.players.p2.coreHp).toBe(CORE_HP);
    expect(g.getWinner()).toBe(null);

    g.state.players.p2.coreHp = 0;
    expect(g.getWinner()?.id, 'the other side wins').toBe('p1');
  });
});

describe('the supply line', () => {
  it('is needed before a core takes any damage', () => {
    const g = newGame();
    besiege(g);
    // Standing on it isn't enough: nothing of ours reaches it.
    expect(g.coreAttackConnected(ENEMY_CORE, 'p1'), 'no line yet').toBe(false);
    expect(g.coreSiegeAt(ENEMY_CORE)).toBe(null);
    g.tick(30);
    expect(g.state.players.p2.coreHp, 'untouched').toBe(CORE_HP);

    holdRouteToEnemyCore(g);
    expect(g.coreAttackConnected(ENEMY_CORE, 'p1')).toBe(true);
    expect(g.coreSiegeAt(ENEMY_CORE)).toEqual({ defenderId: 'p2', attackerId: 'p1' });
  });

  it('counts a camp on ground you do not own', () => {
    const g = newGame();
    besiege(g);
    // The one region that touches both cores, so it alone is the chain.
    const link = g.map
      .region(CORE)
      .neighbors.find((id) => g.map.region(id).neighbors.includes(ENEMY_CORE))!;
    g.setRegionOwner(link, 'p2');
    expect(g.coreAttackConnected(ENEMY_CORE, 'p1'), 'their land breaks it').toBe(false);

    // Their ground, our tent (docs 6.3) — the chain runs through it anyway.
    g.state.regions[link].building = { type: 'camp', hp: 200, owner: 'p1' };
    expect(g.coreAttackConnected(ENEMY_CORE, 'p1'), 'a camp carries the chain').toBe(true);
  });

  it('breaks if the ground is lost again', () => {
    const g = newGame();
    besiege(g);
    const link = holdRouteToEnemyCore(g);
    expect(g.coreSiegeAt(ENEMY_CORE)).not.toBe(null);

    g.setRegionOwner(link, 'p2');
    expect(g.coreSiegeAt(ENEMY_CORE), 'cut off, so the siege lifts').toBe(null);
    const hp = g.state.players.p2.coreHp;
    g.tick(30);
    expect(g.state.players.p2.coreHp, 'and the core stops taking damage').toBe(hp);
  });
});

describe('knocking it down', () => {
  it('grinds at the rate a combat round would', () => {
    const g = newGame();
    besiege(g, 20);
    holdRouteToEnemyCore(g);

    g.tick(COMBAT_ROUND_SECONDS);
    const dealt = CORE_HP - g.state.players.p2.coreHp;
    expect(dealt, 'one round of 20 militia').toBeCloseTo(stackAtk({ militia: 20 }), 5);
  });

  it('stops at zero and hands the match over', () => {
    const g = newGame();
    besiege(g, 20);
    holdRouteToEnemyCore(g);
    g.state.players.p2.coreHp = 10;

    g.tick(COMBAT_ROUND_SECONDS * 2);
    expect(g.state.players.p2.coreHp, 'never negative').toBe(0);
    expect(g.getWinner()?.id).toBe('p1');
  });

  it('is halted while defenders are still standing', () => {
    const g = newGame();
    besiege(g, 20);
    holdRouteToEnemyCore(g);
    g.state.legions.push({
      id: 'defenders',
      playerId: 'p2',
      units: { militia: 5 },
      supply: 1,
      regionId: ENEMY_CORE,
    });

    expect(g.coreSiegeAt(ENEMY_CORE), 'clear them first').toBe(null);
    const hp = g.state.players.p2.coreHp;
    g.tick(COMBAT_ROUND_SECONDS);
    expect(g.state.players.p2.coreHp).toBe(hp);
  });
});

describe('the ground under it', () => {
  it('cannot be occupied while the core stands', () => {
    const g = newGame();
    besiege(g);
    holdRouteToEnemyCore(g);
    expect(g.occupyRejection(ENEMY_CORE, 'p1')).toBe('enemyCore');
    expect(g.occupy(ENEMY_CORE, 'p1')).toBe(false);
    expect(g.state.regions[ENEMY_CORE].owner, 'still theirs').toBe('p2');
  });
});
