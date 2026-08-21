// Matches written down (docs/game-design.md 16).
//
// The whole feature rests on one claim: the same orders in the same steps
// rebuild the same match. These tests hold it to that, by playing a match and
// then replaying it and comparing the entire state — not a summary of it.
import { describe, expect, it } from 'vitest';
import { GameEngine, type PlayerSetup } from '../../engine/GameEngine';
import { TICK_SECONDS } from '../../engine/clock';
import { applyOrder, type Order } from '../../engine/orders';
import { AiController } from '../../ai/AiController';
import { Recorder, Replay, parseRecording, RECORDING_VERSION } from '../recording';
import type { Seat } from '../seats';

const BLUE = 'taipei-1';
const RED = 'kaohsiung-1';

const SETUPS: PlayerSetup[] = [
  { id: 'p1', name: 'A', color: '#00f', coreRegionId: BLUE },
  { id: 'p2', name: 'B', color: '#f00', coreRegionId: RED, aiDifficulty: 'hard' },
];
const SEATS: Seat[] = [
  { by: 'human', playerId: 'p1' },
  { by: 'ai', playerId: 'p2', difficulty: 'hard' },
];

/** What a person did in this match, and when. */
const SCRIPT: { step: number; order: Order }[] = [
  { step: 0, order: { type: 'buyVillagers', count: 10 } },
  { step: 300, order: { type: 'buyVillagers', count: 20 } },
  { step: 700, order: { type: 'build', regionId: BLUE, building: 'shop' } },
  { step: 1500, order: { type: 'train', regionId: BLUE, unit: 'militia', count: 8 } },
  { step: 3000, order: { type: 'buyVillagers', count: 50 } },
];

/** Plays the script out live, recording as it goes — the way the screen does. */
function playAndRecord(steps: number) {
  const engine = new GameEngine(SETUPS);
  const controllers = [new AiController('p2', 'hard')];
  const recorder = new Recorder(SETUPS, SEATS, 1700000000000);

  for (let step = 0; step < steps; step++) {
    for (const line of SCRIPT.filter((s) => s.step === step)) {
      applyOrder(engine, 'p1', line.order);
      recorder.wrote(step, 'p1', line.order);
    }
    engine.tick(TICK_SECONDS);
    for (const controller of controllers) controller.update(engine, TICK_SECONDS);
    recorder.reached(step + 1);
  }
  return { engine, recording: recorder.result };
}

describe('a recorded match', () => {
  it('replays into exactly the state it finished in', () => {
    const { engine, recording } = playAndRecord(4000);
    const replayed = new Replay(recording).runToEnd();

    // Everything: every region, every legion, every march, both treasuries.
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(engine.state));
  });

  it('is decisions, not states — and small because of it', () => {
    const { recording } = playAndRecord(4000);
    const onDisk = JSON.stringify(recording).length;

    // Six and a half minutes of match, five orders. A single snapshot of the
    // state it ended in is several times this on its own.
    expect(recording.events).toHaveLength(SCRIPT.length);
    expect(onDisk).toBeLessThan(2000);
  });

  it('re-runs the machine rather than remembering what it did', () => {
    const { engine, recording } = playAndRecord(3000);
    // Nothing the AI did is written down…
    expect(recording.events.every((e) => e.playerId === 'p1')).toBe(true);
    // …and yet it is all there again, down to where its armies are standing.
    const replayed = new Replay(recording).runToEnd();
    expect(replayed.troopCount('p2')).toBe(engine.troopCount('p2'));
    expect(replayed.ownedRegionCount('p2')).toBe(engine.ownedRegionCount('p2'));
  });

  it('can be stopped anywhere and stepped on from there', () => {
    const { recording } = playAndRecord(2000);
    const replay = new Replay(recording);
    while (replay.step < 500) replay.advance();
    const halfway = JSON.stringify(replay.engine.state);

    // A second replay taken to the same point agrees with it: a step number
    // names a place in the match, which is what scrubbing needs.
    const other = new Replay(recording);
    while (other.step < 500) other.advance();
    expect(JSON.stringify(other.engine.state)).toBe(halfway);

    replay.runToEnd();
    expect(replay.done).toBe(true);
    expect(replay.step).toBe(recording.steps);
  });

  it('survives the round trip through a file', () => {
    const { engine, recording } = playAndRecord(2000);
    const onDisk = JSON.parse(JSON.stringify(recording));
    const read = parseRecording(onDisk);
    expect(read).not.toBe(null);
    expect(JSON.stringify(new Replay(read!).runToEnd().state)).toBe(JSON.stringify(engine.state));
  });
});

describe('a file that is not one of ours', () => {
  it('is refused rather than half-loaded', () => {
    const { recording } = playAndRecord(10);
    const rubbish: unknown[] = [
      null,
      42,
      'a match, honest',
      {},
      { ...recording, version: 99 },
      { ...recording, setups: [] },
      { ...recording, steps: -1 },
      { ...recording, steps: 1.5 },
      { ...recording, events: 'lots' },
      { ...recording, seats: [] },
      // An order that names something the engine looks up in a table would
      // throw on replay, so it never gets that far.
      { ...recording, events: [{ step: 0, playerId: 'p1', order: { type: 'research', techId: 'x' } }] },
      { ...recording, events: [{ step: -5, playerId: 'p1', order: { type: 'upgradeCore' } }] },
      { ...recording, events: [{ step: 0, playerId: 7, order: { type: 'upgradeCore' } }] },
    ];
    for (const value of rubbish) {
      expect(parseRecording(value), `let through: ${JSON.stringify(value)?.slice(0, 60)}`).toBe(
        null,
      );
    }
  });

  it('accepts one of ours', () => {
    const { recording } = playAndRecord(10);
    const read = parseRecording(JSON.parse(JSON.stringify(recording)));
    expect(read?.version).toBe(RECORDING_VERSION);
    expect(read?.steps).toBe(10);
  });
});
