// How a force is sized on the map (docs/game-design.md 6.1).
//
// The models themselves have to be looked at, but where the steps fall does
// not: that is arithmetic, and it is the part that decides whether a player
// can read a board at a glance. Pinned here so a later tweak to the artwork
// cannot quietly move them.
import { describe, expect, it } from 'vitest';
import { INFANTRY_STEPS, VEHICLE_STEPS, VILLAGER_STEPS, tierFor } from '../unitTiers';

describe('how many models stand for how many troops', () => {
  it('gives infantry three sizes: a section, a platoon, a battalion', () => {
    expect(tierFor(1, INFANTRY_STEPS)).toBe(1);
    expect(tierFor(9, INFANTRY_STEPS)).toBe(1);
    expect(tierFor(10, INFANTRY_STEPS)).toBe(2);
    expect(tierFor(29, INFANTRY_STEPS)).toBe(2);
    expect(tierFor(30, INFANTRY_STEPS)).toBe(3);
    expect(tierFor(500, INFANTRY_STEPS), 'and nothing above the top one').toBe(3);
  });

  it('steps armour sooner, because armour is dearer', () => {
    expect(tierFor(1, VEHICLE_STEPS)).toBe(1);
    expect(tierFor(2, VEHICLE_STEPS)).toBe(1);
    expect(tierFor(3, VEHICLE_STEPS)).toBe(2);
    expect(tierFor(7, VEHICLE_STEPS)).toBe(2);
    expect(tierFor(8, VEHICLE_STEPS)).toBe(3);
  });

  it('steps villagers later, because there are simply more of them', () => {
    // Bought in tens, and a healthy economy runs on a hundred, so soldiers'
    // thresholds would put every settled player at the top size for ever.
    expect(tierFor(19, VILLAGER_STEPS)).toBe(1);
    expect(tierFor(20, VILLAGER_STEPS)).toBe(2);
    expect(tierFor(59, VILLAGER_STEPS)).toBe(2);
    expect(tierFor(60, VILLAGER_STEPS)).toBe(3);
    expect(tierFor(30, VILLAGER_STEPS), 'thirty is a battalion but not a workforce').toBe(2);
  });

  it('never leaves a force that exists looking like nothing', () => {
    // One soldier and one tank are still a thing standing on that ground.
    expect(tierFor(1, INFANTRY_STEPS)).toBeGreaterThan(0);
    expect(tierFor(1, VEHICLE_STEPS)).toBeGreaterThan(0);
  });

  it('sizes the two halves of a mixed force apart', () => {
    // The point of the whole arrangement: taking delivery of more tanks must
    // move the armour up a size and leave the infantry exactly as it was.
    const infantry = 40;
    const before = tierFor(2, VEHICLE_STEPS);
    const after = tierFor(9, VEHICLE_STEPS);
    expect(before).toBe(1);
    expect(after).toBe(3);
    expect(tierFor(infantry, INFANTRY_STEPS), 'the foot did not move').toBe(3);
  });
});
