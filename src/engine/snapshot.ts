import { CORE_HP } from './buildings';
import type { GameEngine } from './GameEngine';
import type { GameState, PlayerId, PlayerState, RegionState } from './types';
import { unitsVisibleTo } from './vision';

/**
 * What one player is allowed to be told (docs/game-design.md 15.3).
 *
 * This is the security boundary of a networked match. Everywhere else, fog is
 * a matter of what the interface draws; here it is a matter of what leaves
 * the machine. A client cannot reveal what it was never sent, so the rule is
 * that hidden facts are *absent* from the snapshot rather than merely unused.
 *
 * Three things are public on purpose and stay in:
 *
 *  - **Where the cores are.** Every player is shown both from the setup
 *    screen on (docs 9), and an army needs to know which way the war is.
 *  - **A wonder and its countdown.** It exists to end stalemates (docs 5.2);
 *    a clock nobody can see would end the match by surprise instead.
 *  - **A core at zero.** The match is over — there is nothing left to keep
 *    secret, and the loser is entitled to know they lost.
 */
export function snapshotFor(engine: GameEngine, viewerId: PlayerId): GameState {
  const seen = engine.visibleTo(viewerId);
  const counterRecon = engine.hasTech(viewerId, 'counterRecon');
  const canSee = (regionId: string) => seen.has(regionId);

  const regions: Record<string, RegionState> = {};
  for (const [id, region] of Object.entries(engine.state.regions)) {
    regions[id] = canSee(id) ? region : hideRegion(region);
  }

  const players: Record<PlayerId, PlayerState> = {};
  for (const [id, player] of Object.entries(engine.state.players)) {
    players[id] = id === viewerId ? player : hidePlayer(player, canSee(player.coreRegionId));
  }

  // A column on the road belongs to the region it set out from, so it shows
  // up if either end of the hop it is walking can be seen — the same rule the
  // map markers have always drawn by.
  const marchOf = new Map(engine.state.marches.map((m) => [m.legionId, m]));
  const marchSeen = (legionId: string) => {
    const march = marchOf.get(legionId);
    return march !== undefined && (canSee(march.from) || canSee(march.to));
  };

  const legions = engine.state.legions
    .filter((l) => l.playerId === viewerId || canSee(l.regionId) || marchSeen(l.id))
    .map((legion) =>
      legion.playerId === viewerId
        ? legion
        : { ...legion, units: unitsVisibleTo(legion.units, false, counterRecon) },
    );

  const marches = engine.state.marches.filter(
    (m) => m.playerId === viewerId || canSee(m.from) || canSee(m.to),
  );
  const carts = engine.state.carts.filter(
    (c) => c.playerId === viewerId || canSee(c.from) || canSee(c.to),
  );
  const battles = engine.state.battles.filter(
    (b) =>
      b.attackerId === viewerId ||
      b.defenderId === viewerId ||
      canSee(b.regionId),
  );

  // Through JSON on the way out: it drops the undefined fields the hiding
  // functions leave behind, and it is what goes on the wire anyway — so a
  // snapshot that can't be serialised fails here rather than in a match.
  //
  // Fractions are trimmed on the way past. Supply, hit points and countdowns
  // are all carrying a tail of floating-point noise that no player will ever
  // see the end of, and seventeen digits of it travel five times a second.
  // The host keeps its exact numbers; only the copy is rounded, and the next
  // snapshot corrects whatever the guest predicted from it.
  return JSON.parse(
    JSON.stringify(
      {
        regions,
        players,
        legions,
        marches,
        carts,
        battles,
        elapsedSeconds: engine.state.elapsedSeconds,
        secondsUntilPayout: engine.state.secondsUntilPayout,
      },
      trimFractions,
    ),
  ) as GameState;
}

/**
 * Three decimal places is finer than anything the game shows: a thousandth of
 * a hit point, a tenth of a percent of supply, a millisecond of a countdown.
 */
function trimFractions(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value)
    ? Math.round(value * 1e3) / 1e3
    : value;
}

/** A region nobody of ours has eyes on: a name on the map and nothing else. */
function hideRegion(region: RegionState): RegionState {
  const wonder = region.building?.type === 'wonder' ? region.building : undefined;
  // A wonder going up is shown as well as a finished one. It takes five
  // minutes to build and then has to be held, and that whole span is the
  // window an opponent has to do something about it — a warning that arrives
  // only once it is finished is not a warning.
  const rising = region.construction?.type === 'wonder' ? region.construction : undefined;
  return {
    // Whose it is stays hidden — unless it's a core, which everyone knows.
    owner: region.isCore ? region.owner : null,
    isCore: region.isCore,
    units: {},
    building: wonder,
    wonderHeldSeconds: wonder ? region.wonderHeldSeconds : undefined,
    construction: rising,
    unrestSeconds: undefined,
  };
}

/**
 * Another player's books. No amount of looking at a map tells you what's in
 * someone's treasury, what they're researching, or what they have on order.
 */
function hidePlayer(player: PlayerState, coreVisible: boolean): PlayerState {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    coreRegionId: player.coreRegionId,
    aiDifficulty: player.aiDifficulty,
    // Dead is not a secret: at zero the match is over.
    coreHp: coreVisible || player.coreHp <= 0 ? player.coreHp : CORE_HP,
    populationCap: 0,
    money: 0,
    food: 0,
    coreLevel: 0,
    techs: [],
    research: [],
    researchers: 0,
    production: [],
  };
}
