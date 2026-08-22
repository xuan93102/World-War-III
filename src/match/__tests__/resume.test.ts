// Surviving a reload (docs/game-design.md 15.8).
//
// What comes back out of storage was written by us, but it has been somewhere
// anything on the machine could have edited it, and the host's half is about
// to be replayed into an engine. So these tests are mostly about refusing:
// half a match is not a match to walk back into, and landing on the menu is
// better than landing on a screen that spins.
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerSetup } from '../../engine/GameEngine';
import { Recorder, type Recording } from '../recording';
import type { Seat } from '../seats';
import {
  forgetMatch,
  rememberMatch,
  resumableMatch,
  RESUME_WINDOW_MS,
  type InProgress,
} from '../resume';

const SETUPS: PlayerSetup[] = [
  { id: 'p1', name: 'A', color: '#00f', coreRegionId: 'taipei-1' },
  { id: 'p2', name: 'B', color: '#f00', coreRegionId: 'kaohsiung-1' },
];
const SEATS: Seat[] = [
  { by: 'human', playerId: 'p1' },
  { by: 'remote', playerId: 'p2' },
];

/** Just enough of a Storage to be one. */
class Slot implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

let slot: Slot;
beforeEach(() => {
  slot = new Slot();
  (globalThis as { window?: unknown }).window = { sessionStorage: slot };
});

function aRecording(): Recording {
  const recorder = new Recorder(SETUPS, SEATS, 1000);
  recorder.wrote(4, 'p1', { type: 'buyVillagers', count: 3 });
  recorder.reached(40);
  return recorder.result;
}

const hostsMatch = (over: Partial<InProgress> = {}) => ({
  role: 'host' as const,
  code: 'ABC234',
  token: 'A-KEY',
  setups: SETUPS,
  seats: SEATS,
  opponentId: 'p2',
  steps: 40,
  recording: aRecording(),
  ...over,
});

describe('a match this tab was in before it reloaded', () => {
  it('comes back the way it went in', () => {
    rememberMatch(hostsMatch());
    const back = resumableMatch();
    expect(back?.code).toBe('ABC234');
    expect(back?.token, 'the key back into our own seat').toBe('A-KEY');
    expect(back?.steps).toBe(40);
    expect(back?.recording?.events, 'and what everybody did').toHaveLength(1);
  });

  it('is gone once walked out of', () => {
    rememberMatch(hostsMatch());
    forgetMatch();
    expect(resumableMatch()).toBeNull();
  });

  it('needs nothing but the room when we were the guest', () => {
    // The guest never held the match, so there is nothing of it to keep. It
    // rejoins and the next snapshot is the whole world.
    rememberMatch(hostsMatch({ role: 'guest', token: null, recording: null }));
    expect(resumableMatch()?.role).toBe('guest');
  });
});

describe('what is refused', () => {
  it('a host with no token, because that seat cannot be taken back', () => {
    rememberMatch(hostsMatch({ token: null }));
    expect(resumableMatch()).toBeNull();
  });

  it('a host with no recording, because there is no world to rebuild', () => {
    rememberMatch(hostsMatch({ recording: null }));
    expect(resumableMatch()).toBeNull();
  });

  it('a recording that has been tampered with', () => {
    const bent = aRecording();
    (bent.events[0] as { order: unknown }).order = { type: 'nothing anybody can do' };
    rememberMatch(hostsMatch({ recording: bent }));
    expect(resumableMatch(), 'refused whole, not half-loaded').toBeNull();
  });

  it('anything left over from a version that meant something else', () => {
    rememberMatch(hostsMatch());
    const stored = JSON.parse(slot.getItem('salient.match')!);
    slot.setItem('salient.match', JSON.stringify({ ...stored, version: 99 }));
    expect(resumableMatch()).toBeNull();
  });

  it('one old enough that the room is gone', () => {
    rememberMatch(hostsMatch());
    // The relay holds an emptied room for three minutes. Past that, offering
    // to walk back in would be offering something that is not there.
    expect(resumableMatch(Date.now() + RESUME_WINDOW_MS + 1)).toBeNull();
    expect(slot.getItem('salient.match'), 'and it is cleared out').toBeNull();
  });

  it('nonsense, without throwing', () => {
    slot.setItem('salient.match', 'not json at all');
    expect(resumableMatch()).toBeNull();
  });
});
