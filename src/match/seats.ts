import type { AiDifficulty, PlayerId } from '../engine/types';

/**
 * Who is playing each side (docs/game-design.md 15.4).
 *
 * The engine has never known the difference — a seat gives orders, and orders
 * are orders — but the app has to, because the three kinds are driven from
 * three different places: the panels, the decision clock, and a socket. This
 * is the one description of a match that says which is which, so PvE,
 * watching two machines, and a networked game all set up the same way instead
 * of each being inferred from some other field.
 *
 * A seat is a description rather than a live thing: it says what drives a
 * player, not the object doing the driving. That keeps it copyable, and lets
 * whoever runs the match own the controllers.
 */
export type Seat =
  /** This machine's player: orders come from the panels. */
  | { by: 'human'; playerId: PlayerId }
  /** A controller on this machine, thinking on its own clock (docs 13). */
  | { by: 'ai'; playerId: PlayerId; difficulty: AiDifficulty }
  /** Somebody else's machine: orders arrive over the wire. */
  | { by: 'remote'; playerId: PlayerId };

/**
 * The player this machine is playing, or null when nobody here is — which is
 * what watching two machines actually is, rather than a special mode.
 */
export function localPlayerId(seats: Seat[]): PlayerId | null {
  return seats.find((seat) => seat.by === 'human')?.playerId ?? null;
}

/** The seats a controller has to be built for. */
export function aiSeats(seats: Seat[]): Extract<Seat, { by: 'ai' }>[] {
  return seats.filter((seat): seat is Extract<Seat, { by: 'ai' }> => seat.by === 'ai');
}

/** Whether anyone in this match is somewhere else. */
export function isNetworked(seats: Seat[]): boolean {
  return seats.some((seat) => seat.by === 'remote');
}
