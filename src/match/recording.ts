import { GameEngine, type PlayerSetup } from '../engine/GameEngine';
import { TICK_SECONDS } from '../engine/clock';
import { applyOrder, parseOrder, type Order } from '../engine/orders';
import type { PlayerId } from '../engine/types';
import { AiController } from '../ai/AiController';
import { aiSeats, type Seat } from './seats';

/**
 * A match, written down (docs/game-design.md 16).
 *
 * Not a copy of the world — a copy of what everyone did to it. The engine
 * takes fixed steps and has no randomness in it, so the same orders in the
 * same steps rebuild the same match, exactly, every time. That makes a
 * recording a few kilobytes of decisions instead of a megabyte of states, and
 * it makes watching one and resuming one the same operation: replay to the
 * end, then either stop and watch or carry on playing.
 *
 * The machines aren't in here either. A controller is deterministic too, so
 * replaying re-runs its thinking rather than remembering its conclusions —
 * which is also a standing test of that claim: if an AI ever became
 * unpredictable, its replays would stop matching.
 */
export interface Recording {
  /** Bumped when the shape changes, so an old file is refused, not misread. */
  version: 1;
  /** Real-world time the match began, for sorting a list of them. */
  playedAt: number;
  setups: PlayerSetup[];
  seats: Seat[];
  /** Fixed steps the match ran for. */
  steps: number;
  /** Everything a person did, in the step it took effect. */
  events: RecordedOrder[];
}

export interface RecordedOrder {
  step: number;
  playerId: PlayerId;
  order: Order;
}

export const RECORDING_VERSION = 1;

/**
 * Writes a match down as it happens.
 *
 * Orders are stamped with the number of steps run so far, not the clock:
 * "before step 400" is a place in the match, and a place is what a replay can
 * return to. Nothing arrives mid-step — the loop runs whole steps and the
 * socket and the panels only get a word in between them.
 */
export class Recorder {
  private readonly recording: Recording;

  constructor(setups: PlayerSetup[], seats: Seat[], playedAt = Date.now()) {
    this.recording = {
      version: RECORDING_VERSION,
      playedAt,
      setups: structuredClone(setups),
      seats: structuredClone(seats),
      steps: 0,
      events: [],
    };
  }

  /** Someone did something. */
  wrote(step: number, playerId: PlayerId, order: Order): void {
    this.recording.events.push({ step, playerId, order: structuredClone(order) });
  }

  /** The match has reached this many steps. */
  reached(steps: number): void {
    this.recording.steps = Math.max(this.recording.steps, steps);
  }

  get result(): Recording {
    return this.recording;
  }
}

/**
 * Plays a recording back into an engine, one step at a time.
 *
 * Whoever owns the clock decides how fast — the replay screen runs it at
 * whatever speed is being watched, and a test runs it flat out.
 */
export class Replay {
  readonly engine: GameEngine;
  readonly recording: Recording;
  private readonly controllers: AiController[];
  private readonly byStep = new Map<number, RecordedOrder[]>();
  private stepsRun = 0;

  constructor(recording: Recording) {
    this.recording = recording;
    this.engine = new GameEngine(recording.setups);
    this.controllers = aiSeats(recording.seats).map(
      (seat) => new AiController(seat.playerId, seat.difficulty),
    );
    for (const event of recording.events) {
      const at = this.byStep.get(event.step);
      if (at) at.push(event);
      else this.byStep.set(event.step, [event]);
    }
  }

  get step(): number {
    return this.stepsRun;
  }

  get done(): boolean {
    return this.stepsRun >= this.recording.steps;
  }

  /** Advances one step: what people did first, then the world moving. */
  advance(): void {
    if (this.done) return;
    for (const event of this.byStep.get(this.stepsRun) ?? []) {
      applyOrder(this.engine, event.playerId, event.order);
    }
    this.engine.tick(TICK_SECONDS);
    for (const controller of this.controllers) controller.update(this.engine, TICK_SECONDS);
    this.stepsRun++;
  }

  /** Runs the whole thing, for resuming a match or checking one. */
  runToEnd(): GameEngine {
    while (!this.done) this.advance();
    return this.engine;
  }
}

/**
 * Reads a recording from a file somebody was handed.
 *
 * Same discipline as an order off the wire: shaped-checked here, and the
 * engine still refuses anything illegal when it is replayed. A file that
 * isn't one of ours is refused rather than half-loaded.
 */
export function parseRecording(value: unknown): Recording | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<Recording>;
  if (raw.version !== RECORDING_VERSION) return null;
  if (!Array.isArray(raw.setups) || raw.setups.length < 2) return null;
  if (!Array.isArray(raw.seats) || raw.seats.length !== raw.setups.length) return null;
  if (!Number.isSafeInteger(raw.steps) || (raw.steps as number) < 0) return null;
  if (!Array.isArray(raw.events)) return null;

  for (const setup of raw.setups) {
    if (typeof setup?.id !== 'string' || typeof setup?.coreRegionId !== 'string') return null;
  }

  const events: RecordedOrder[] = [];
  for (const event of raw.events) {
    const step = (event as RecordedOrder)?.step;
    const playerId = (event as RecordedOrder)?.playerId;
    const order = parseOrder((event as RecordedOrder)?.order);
    if (!Number.isSafeInteger(step) || step < 0 || typeof playerId !== 'string' || !order) {
      return null;
    }
    events.push({ step, playerId, order });
  }

  return {
    version: RECORDING_VERSION,
    playedAt: typeof raw.playedAt === 'number' ? raw.playedAt : 0,
    setups: raw.setups,
    seats: raw.seats,
    steps: raw.steps as number,
    events,
  };
}

// ---- keeping them ----------------------------------------------------------

const SHELF = 'salient.replays';

/** How many to keep. They're small, but a browser's cupboard isn't endless. */
export const REPLAYS_KEPT = 8;

/** Everything we have, newest first. Anything unreadable is quietly dropped. */
export function savedReplays(): Recording[] {
  try {
    const raw = localStorage.getItem(SHELF);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map(parseRecording)
      .filter((r): r is Recording => r !== null)
      .sort((a, b) => b.playedAt - a.playedAt);
  } catch {
    // A full or blocked localStorage is not a reason to stop the game.
    return [];
  }
}

/** Puts one on the shelf, pushing the oldest off the end. */
export function keepReplay(recording: Recording): void {
  try {
    const kept = [recording, ...savedReplays()].slice(0, REPLAYS_KEPT);
    localStorage.setItem(SHELF, JSON.stringify(kept));
  } catch {
    // Same again: worth trying, not worth failing over.
  }
}

export function forgetReplay(playedAt: number): void {
  try {
    localStorage.setItem(
      SHELF,
      JSON.stringify(savedReplays().filter((r) => r.playedAt !== playedAt)),
    );
  } catch {
    /* nothing to do about it */
  }
}

/** Hands the file to the player, so a match can outlive the browser. */
export function downloadReplay(recording: Recording, name: string): void {
  const blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.salient.json`;
  link.click();
  URL.revokeObjectURL(url);
}
