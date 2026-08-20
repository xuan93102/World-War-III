// The engine is deterministic under a fixed step (docs/game-design.md 14).
//
// This is the property everything networked rests on, and it is cheap to lose:
// one Math.random, one Date.now, one iteration over an unordered set, and a
// match stops replaying the same way. These tests are here to notice.
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { TICK_SECONDS, MAX_CATCH_UP_STEPS, fixedSteps } from '../clock';
import { AiController } from '../../ai/AiController';
import type { AiDifficulty } from '../types';

const BLUE = 'taipei-1';
const RED = 'kaohsiung-1';

function newMatch(difficulty: AiDifficulty | undefined = undefined) {
  const engine = new GameEngine([
    { id: 'p1', name: 'A', color: '#00f', coreRegionId: BLUE, aiDifficulty: difficulty },
    { id: 'p2', name: 'B', color: '#f00', coreRegionId: RED, aiDifficulty: difficulty },
  ]);
  const seats = difficulty
    ? [new AiController('p1', difficulty), new AiController('p2', difficulty)]
    : [];
  return { engine, seats };
}

/** Runs `steps` fixed steps, calling `orders` before the step it names. */
function play(
  engine: GameEngine,
  seats: AiController[],
  steps: number,
  orders: Record<number, (g: GameEngine) => void> = {},
) {
  for (let step = 0; step < steps; step++) {
    orders[step]?.(engine);
    engine.tick(TICK_SECONDS);
    for (const seat of seats) seat.update(engine, TICK_SECONDS);
  }
}

describe('the same match, played the same way', () => {
  it('comes out identical when the orders are identical', () => {
    const orders: Record<number, (g: GameEngine) => void> = {
      0: (g) => g.buyVillagers('p1', 10),
      50: (g) => g.startConstruction(BLUE, 'shop', 'p1'),
      400: (g) => g.trainUnits(BLUE, 'p1', 'militia', 5),
      900: (g) => {
        const next = g.map.region(BLUE).neighbors[0];
        g.startMarch(BLUE, next, 'p1', { militia: 5 }, 'occupy');
      },
    };

    const a = newMatch();
    const b = newMatch();
    play(a.engine, a.seats, 2000, orders);
    play(b.engine, b.seats, 2000, orders);

    expect(JSON.stringify(a.engine.state)).toBe(JSON.stringify(b.engine.state));
  });

  it('comes out identical with two machines playing it', () => {
    // The AI has its own clock and its own memory (the rally point), so this
    // covers the controllers as well as the engine.
    const a = newMatch('hard');
    const b = newMatch('hard');
    play(a.engine, a.seats, 6000);
    play(b.engine, b.seats, 6000);

    expect(a.engine.state.elapsedSeconds).toBeCloseTo(600, 6);
    expect(JSON.stringify(a.engine.state)).toBe(JSON.stringify(b.engine.state));
  });

  it('does not depend on how the steps were grouped into frames', () => {
    // One frame of ten steps and ten frames of one must agree: a fast machine
    // and a slow one are watching the same match.
    const a = newMatch('normal');
    const b = newMatch('normal');
    for (let frame = 0; frame < 300; frame++) play(a.engine, a.seats, 10);
    play(b.engine, b.seats, 3000);

    expect(JSON.stringify(a.engine.state)).toBe(JSON.stringify(b.engine.state));
  });
});

describe('splitting real time into steps', () => {
  it('banks the remainder rather than dropping or stretching it', () => {
    let banked = 0;
    let run = 0;
    // Frames of an awkward length that never divides evenly into a step.
    for (let frame = 0; frame < 100; frame++) {
      banked += 0.037;
      const { steps, left } = fixedSteps(banked);
      banked = left;
      run += steps;
    }
    // 3.7 seconds of real time is 37 whole steps, give or take the last one:
    // adding 0.037 a hundred times lands a hair under 3.7, which is what
    // floating point does and not something worth engineering around. What
    // matters is that no time is stretched and none is lost beyond a step.
    expect(run).toBeGreaterThanOrEqual(36);
    expect(run).toBeLessThanOrEqual(37);
    expect(banked).toBeLessThan(TICK_SECONDS);
  });

  it('refuses to fast-forward through a long stall', () => {
    // A tab hidden for a minute comes back to a match that waited.
    const { steps, left } = fixedSteps(60);
    expect(steps).toBe(MAX_CATCH_UP_STEPS);
    expect(left, 'the rest is dropped, not owed').toBe(0);
  });

  it('does nothing with nothing', () => {
    expect(fixedSteps(0)).toEqual({ steps: 0, left: 0 });
    expect(fixedSteps(TICK_SECONDS / 2).steps).toBe(0);
  });
});

describe('the match clock', () => {
  it('does not drift over an hour of tenths', () => {
    const { engine } = newMatch();
    for (let step = 0; step < 36_000; step++) engine.tick(TICK_SECONDS);
    // Adding 0.1 thirty-six thousand times is not 3600 unless somebody keeps
    // it honest: before this it read 3599.999999999662.
    expect(engine.state.elapsedSeconds).toBe(3600);
  });

  it('keeps the payout countdown clean too', () => {
    const { engine } = newMatch();
    for (let step = 0; step < 6_000; step++) engine.tick(TICK_SECONDS);
    expect(Number.isInteger(engine.state.secondsUntilPayout * 10)).toBe(true);
  });
});
