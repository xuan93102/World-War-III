import type { PlayerSetup } from '../engine/GameEngine';
import type { GameState, PlayerId } from '../engine/types';
import type { Seat } from './seats';

/**
 * What the two ends say to each other (docs/game-design.md 15.4).
 *
 * The relay carries these without reading them, so this is a conversation
 * between two browsers that happens to be shouted through a post box. Which
 * means the guest's messages are exactly as trustworthy as the guest — every
 * order is parsed before it goes anywhere near the engine, and the host never
 * takes the guest's word for whose order it is.
 */

/** What the relay itself says. */
export type RelayMessage =
  /** The token is the key back into this room if our socket dies (docs 15.8). */
  | { t: 'room'; code: string; token: string }
  | { t: 'joined'; code: string }
  /** The other side turned up. */
  | { t: 'peer' }
  /** The other side went away. */
  | { t: 'gone' }
  | { t: 'error'; why: 'noRoom' | 'roomFull' }
  | { t: 'msg'; data: unknown };

/**
 * Host to guest: here is the match, and here is how it stands.
 *
 * There is no 'the match is over' message and there doesn't need to be — a
 * core at zero rides in the snapshot (docs 15.3), so the guest works out the
 * result from the same state everything else is read from.
 */
/**
 * The lobby, while the two of them are still agreeing what to play.
 *
 * The host holds it and posts it after every change, for the same reason it
 * holds the match: somebody has to be right when the two disagree, and it may
 * as well be the one who will be running the game anyway. The guest asks;
 * the host decides and says what the answer was.
 */
export interface SetupState {
  mapId: string;
  hostCore: string;
  /** null until they have chosen somewhere far enough away. */
  guestCore: string | null;
  hostReady: boolean;
  guestReady: boolean;
}

export type HostMessage =
  | { t: 'setup'; state: SetupState }
  | { t: 'start'; setups: PlayerSetup[]; seats: Seat[]; you: PlayerId }
  | { t: 'snapshot'; state: GameState };

/** Guest to host: this is what I want done. Never who I am. */
export type GuestMessage =
  | { t: 'order'; order: unknown }
  /** Where they would like to start. The host decides whether they may. */
  | { t: 'pick'; core: string }
  | { t: 'ready'; ready: boolean };

/** Narrowing for messages off the wire, which are `unknown` until checked. */
export function asRelayMessage(value: unknown): RelayMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const t = (value as { t?: unknown }).t;
  switch (t) {
    case 'room':
      return typeof (value as { code?: unknown }).code === 'string' &&
        typeof (value as { token?: unknown }).token === 'string'
        ? (value as RelayMessage)
        : null;
    case 'joined':
      return typeof (value as { code?: unknown }).code === 'string'
        ? (value as RelayMessage)
        : null;
    case 'peer':
    case 'gone':
      return { t };
    case 'error': {
      const why = (value as { why?: unknown }).why;
      return why === 'noRoom' || why === 'roomFull' ? { t: 'error', why } : null;
    }
    case 'msg':
      return { t: 'msg', data: (value as { data?: unknown }).data };
    default:
      return null;
  }
}
