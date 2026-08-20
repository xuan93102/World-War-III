// Who is playing each side (docs/game-design.md 15.4).
import { describe, expect, it } from 'vitest';
import { aiSeats, isNetworked, localPlayerId, type Seat } from '../seats';

const HUMAN: Seat = { by: 'human', playerId: 'p1' };
const MACHINE: Seat = { by: 'ai', playerId: 'p2', difficulty: 'hard' };
const ELSEWHERE: Seat = { by: 'remote', playerId: 'p2' };

describe('describing a match by its seats', () => {
  it('names the player this machine is playing', () => {
    expect(localPlayerId([HUMAN, MACHINE])).toBe('p1');
    expect(localPlayerId([HUMAN, ELSEWHERE])).toBe('p1');
  });

  it('says nobody is playing here when two machines are', () => {
    // Watching is not a mode with a flag — it's a match with no human seat.
    expect(localPlayerId([MACHINE, { by: 'ai', playerId: 'p1', difficulty: 'easy' }])).toBe(null);
  });

  it('picks out the seats that need a controller built', () => {
    const controllers = aiSeats([HUMAN, MACHINE, ELSEWHERE]);
    expect(controllers).toEqual([MACHINE]);
  });

  it('knows when somebody is somewhere else', () => {
    expect(isNetworked([HUMAN, MACHINE])).toBe(false);
    expect(isNetworked([HUMAN, ELSEWHERE])).toBe(true);
  });
});
