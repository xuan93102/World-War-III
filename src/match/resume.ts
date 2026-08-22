import type { PlayerSetup } from '../engine/GameEngine';
import { parseRecording, type Recording } from './recording';
import type { Seat } from './seats';

/**
 * Surviving a reload (docs/game-design.md 15.8).
 *
 * A dropped socket was already handled: the connection retries and the relay
 * holds the room. F5 is a harder case, because it does not drop a socket —
 * it throws away the entire browser tab, engine and all. What is kept here is
 * everything needed to build that tab again.
 *
 * For the guest that is almost nothing: it never held the match, only pictures
 * of it, so it needs the way back into the room and the host will send the
 * rest. For the host it is the recording — the match written down as decisions
 * — because replaying that rebuilds the exact world it was holding. This is
 * the same property the replay screen uses, put to a different purpose.
 */
export interface InProgress {
  version: 1;
  role: 'host' | 'guest';
  code: string;
  /** Host only: the key back into our own seat, which a code alone is not. */
  token: string | null;
  setups: PlayerSetup[];
  seats: Seat[];
  opponentId: string;
  /** Steps run when this was written. */
  steps: number;
  /** Host only: everything anybody did, which is the match itself. */
  recording: Recording | null;
  savedAt: number;
}

const KEY = 'salient.match';
export const RESUME_VERSION = 1;

/**
 * How long a saved match is worth trying.
 *
 * The relay keeps an emptied room for three minutes, so past that there is
 * nothing to walk back into and offering to try would be a lie. Better to
 * land on the menu than on a screen that spins.
 */
export const RESUME_WINDOW_MS = 180_000;

/**
 * Where this lives matters. sessionStorage belongs to one tab and dies with
 * it, which is exactly the claim being made: *this tab* is in a match. A
 * second tab opening into somebody else's match would be wrong, and a match
 * still being offered tomorrow would be worse.
 */
function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // Blocked storage is not a reason to stop playing.
  }
}

export function rememberMatch(match: Omit<InProgress, 'version' | 'savedAt'>): void {
  try {
    store()?.setItem(
      KEY,
      JSON.stringify({ ...match, version: RESUME_VERSION, savedAt: Date.now() }),
    );
  } catch {
    // A full quota costs us the reload, not the match being played right now.
  }
}

export function forgetMatch(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* nothing to do about it */
  }
}

/**
 * A match to walk back into, or nothing.
 *
 * Everything here was written by us, but it has been through storage that
 * anything on this machine could have edited, so it is checked as carefully
 * as something off the wire — the recording especially, since it is about to
 * be replayed into an engine.
 */
export function resumableMatch(now = Date.now()): InProgress | null {
  let raw: string | null = null;
  try {
    raw = store()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    forgetMatch();
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const saved = value as Partial<InProgress>;

  if (saved.version !== RESUME_VERSION) return drop();
  if (saved.role !== 'host' && saved.role !== 'guest') return drop();
  if (typeof saved.code !== 'string' || saved.code.length !== 6) return drop();
  if (typeof saved.opponentId !== 'string') return drop();
  if (!Array.isArray(saved.setups) || saved.setups.length < 2) return drop();
  if (!Array.isArray(saved.seats) || saved.seats.length !== saved.setups.length) return drop();
  if (!Number.isSafeInteger(saved.steps) || (saved.steps as number) < 0) return drop();
  if (typeof saved.savedAt !== 'number' || now - saved.savedAt > RESUME_WINDOW_MS) return drop();

  // The host cannot take its seat back without the token, and cannot rebuild
  // the world without the recording. Half of either is not a resumable match.
  const recording = saved.recording ? parseRecording(saved.recording) : null;
  if (saved.role === 'host' && (typeof saved.token !== 'string' || !recording)) return drop();

  return {
    version: RESUME_VERSION,
    role: saved.role,
    code: saved.code,
    token: typeof saved.token === 'string' ? saved.token : null,
    setups: saved.setups,
    seats: saved.seats,
    opponentId: saved.opponentId,
    steps: saved.steps as number,
    recording,
    savedAt: saved.savedAt,
  };
}

function drop(): null {
  forgetMatch();
  return null;
}
