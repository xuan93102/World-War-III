/**
 * The match clock (docs/game-design.md 14).
 *
 * The simulation advances in fixed steps, never in whatever slice of time
 * happened to pass since the last frame. Two reasons, and only the second one
 * is about networking:
 *
 *  - The same match, played the same way, now plays out the same way. With
 *    wall-clock deltas a slow machine fed the engine different numbers than a
 *    fast one, so results drifted for no reason anybody could see.
 *  - A networked match needs both ends to agree on what "now" means, and a
 *    recorded order stream only replays if the steps between orders are the
 *    same length every time.
 *
 * Rendering is a separate rate: the loop can draw as often as it likes and
 * still hand the engine whole steps.
 */

/** One simulation step. Ten a second — finer than anything in the rules. */
export const TICK_SECONDS = 0.1;

/**
 * Most steps one frame may catch up by. A tab that was hidden for a minute
 * comes back to a match that waited, not one that fast-forwarded through a
 * minute of war in a single frame.
 */
export const MAX_CATCH_UP_STEPS = 20;

/**
 * Splits banked real time into whole steps, returning what's left over to
 * bank for next time. Time beyond the catch-up limit is dropped rather than
 * kept, so a long stall can't leave the loop permanently behind.
 */
export function fixedSteps(banked: number): { steps: number; left: number } {
  if (!Number.isFinite(banked) || banked <= 0) return { steps: 0, left: Math.max(0, banked || 0) };
  const wanted = Math.floor(banked / TICK_SECONDS);
  const steps = Math.min(wanted, MAX_CATCH_UP_STEPS);
  return { steps, left: wanted > steps ? 0 : banked - steps * TICK_SECONDS };
}

/**
 * Snaps a running total back onto a clean tenth of a millisecond.
 *
 * A tenth of a second is not a number a computer can hold exactly, so adding
 * it fifteen thousand times leaves a match clock reading 1499.9999999997312
 * instead of 1500. Nothing in the rules notices — both ends drift by exactly
 * the same amount, so it costs no determinism — but it spreads through every
 * derived number, and it goes over the wire as seventeen digits where four
 * would do.
 */
export function pinned(seconds: number): number {
  return Math.round(seconds * 1e4) / 1e4;
}