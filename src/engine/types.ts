import type { BuildingType } from './buildings';
import type { TechId } from './tech';
import type { UnitCounts, UnitType } from './units';

export type PlayerId = string;

export type AiDifficulty = 'easy' | 'normal' | 'hard';

export interface RegionDef {
  id: string;
  name: string;
  area: 'north' | 'central' | 'south' | 'east';
  path: string;
  cx: number;
  cy: number;
  neighbors: string[];
  /** Projected land area; scales food output and neutral garrison size. */
  landArea: number;
}

export interface MountainPass {
  from: string;
  to: string;
  name: string;
  /** Midpoint of the two regions' real shared border, where the map draws it. */
  x: number;
  y: number;
  /** Crossing direction in degrees (perpendicular to the border there). */
  angle: number;
}

export interface RegionState {
  owner: PlayerId | null;
  isCore: boolean;
  /**
   * The *neutral* garrison: only ever militia, sized by land area. A player's
   * troops don't live here — they live in legions, so ask garrisonAt() for
   * "who is standing on this ground".
   */
  units: UnitCounts;
  /**
   * Completed building, if any. One per region (docs/game-design.md 5).
   *
   * `stock` is food a supply depot is holding (docs 7): carts deliver it, and
   * a legion standing here tops its supply up from it. Only fortresses and
   * camps use it.
   *
   * `owner` only matters for a camp, which can stand on ground its builder
   * doesn't hold (docs 6.3) — every other building belongs to whoever owns the
   * region. Without it, a camp pitched on neutral land would have no side.
   */
  building?: { type: BuildingType; hp: number; stock?: number; owner?: PlayerId };
  /** In-progress build, if any. Mutually exclusive with `building`. */
  construction?: {
    type: BuildingType;
    remainingSeconds: number;
    totalSeconds: number;
    /** Who paid for it — the camp it finishes into belongs to them. */
    builtBy?: PlayerId;
  };
  /**
   * Seconds the current owner has held a *completed* wonder here. Resets if
   * the wonder is lost or destroyed; at WONDER_HOLD_SECONDS the owner wins.
   */
  wonderHeldSeconds?: number;
  /**
   * Seconds of unrest left after taking this ground off another player
   * (docs/game-design.md 6.4). While it runs the region is yours but useless:
   * nothing can be built and no troops can be stationed. Taking neutral land
   * doesn't cause it.
   */
  unrestSeconds?: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  /**
   * Villagers on the payroll — the only population that earns gold. Troops
   * are counted separately (they live on regions); total population is
   * villagers + troops, via GameEngine.population().
   */
  villagers: number;
  populationCap: number;
  money: number;
  food: number;
  /** Present for AI-controlled seats; omitted for human players. */
  aiDifficulty?: AiDifficulty;
  coreRegionId: string;
  /**
   * The core's remaining hit points (docs/game-design.md 6.7). An enemy army
   * standing on the core's region — with a line of held ground back to its own
   * core — grinds this down; at zero the match is lost.
   */
  coreHp: number;

  // ---- research (docs/game-design.md 10 and 11) ----
  /** Gates which tier of tech can be researched. Starts at 1. */
  coreLevel: number;
  /** In-progress core upgrade, if any. */
  coreUpgrade?: { toLevel: number; remainingSeconds: number; totalSeconds: number };
  /** Completed techs. */
  techs: TechId[];
  /** Techs currently being researched — at most RESEARCH_SLOTS of them. */
  research: { techId: TechId; remainingSeconds: number; totalSeconds: number }[];
  /**
   * Trained researchers. They shorten research time and occupy population,
   * but unlike the design doc's "convert population" wording they don't take
   * villagers away — they cost gold and time of their own.
   */
  researchers: number;
  /** A researcher being trained, if any. */
  researcherTraining?: { remainingSeconds: number; totalSeconds: number };

  /**
   * Vehicles on the arsenal's slipway (docs 6.5). Paid for up front and built
   * one at a time, so a queue of four tanks is twelve minutes of commitment
   * rather than a burst of gold.
   */
  production: {
    type: UnitType;
    /** The arsenal building them; they roll out here. */
    regionId: string;
    remainingSeconds: number;
    totalSeconds: number;
    /** How many are still to come, the one under construction included. */
    remaining: number;
    /** Set for an upgrade: the tier the recruits came off, for refunds. */
    fromType?: UnitType;
  }[];
}

/**
 * An army on the road between two regions (docs/game-design.md 8). Troops in
 * transit belong to no region — they've left `from` and haven't reached `to` —
 * which is what makes interception, ambush and mid-battle reinforcement
 * possible later. They still count against their owner's population.
 */
export interface March {
  id: string;
  playerId: PlayerId;
  /** Where the current hop started. */
  from: string;
  /** The region this hop ends in — the *next* stop, not the final one. */
  to: string;
  /**
   * Regions still to enter after `to`, in order. A long march is walked one
   * hop at a time, genuinely entering each region on the way, so an enemy can
   * intercept it by standing on the route.
   */
  route: string[];
  /** Where the whole march is headed; equals `to` on the final leg. */
  destination: string;
  units: UnitCounts;
  /** Duration of the current hop. */
  totalSeconds: number;
  remainingSeconds: number;
  /** The legion doing the marching. */
  legionId: string;
}

/**
 * A body of troops with an identity of its own (docs/game-design.md 7).
 *
 * Troops used to be a bare count on a region, which was enough for marching
 * and fighting but leaves supply nowhere to live: §7 gives each *army* a
 * supply bar, and "the army" has to be a thing before it can carry one. A
 * legion keeps its identity as it marches and garrisons, so the column that
 * walked three regions into enemy ground is the one that runs dry.
 *
 * Invariant: **at most one standing legion per region per player.** Anything
 * arriving merges into the one already there, which keeps "the defender" a
 * single target in combat. A marching legion is separate until it lands.
 *
 * Neutral garrisons are not legions — they belong to no player and never move.
 */
export interface Legion {
  id: string;
  playerId: PlayerId;
  units: UnitCounts;
  /**
   * Supply, 0..1. Drains off friendly ground, holds on it, and only a
   * granary, a farm or a supply cart puts it back (docs 7).
   */
  supply: number;
  /** Where it stands, or the region it set out from while marching. */
  regionId: string;
  /**
   * A standing order to batter what's built here — an enemy building, or a
   * core (docs 6.6, 6.7). Marching is movement only, so attacking a structure
   * is something the army is told to do and keeps doing until the target is
   * gone or it moves away.
   */
  assaulting?: boolean;
  /**
   * A standing order to shell a region within range without closing on it
   * (docs 6.5). Holds the target's id while it lasts.
   */
  bombarding?: string;
  /**
   * What this column was told to do when it gets where it's going — set when
   * the march is ordered, so "go there and take it" is one decision rather
   * than a march now and a second visit to the panel later.
   *
   * It survives the fight it starts: an order to occupy garrisoned ground
   * beats the garrison first and takes the ground after.
   */
  onArrival?: 'assault' | 'occupy';
}

/**
 * A supply cart on the road (docs/game-design.md 7).
 *
 * Carts are how supply gets *back*, which nothing else does: own land only
 * holds the bar steady and a granary can't walk to the front. A cart leaves a
 * granary with a load of food, refills whoever it reaches, and walks home to
 * be used again — so the number of carts is a real ceiling on how many pushes
 * you can sustain at once.
 *
 * It travels the same way an army does, one hop at a time over ground it
 * could stand on, and it cannot fight: walking into an enemy loses it.
 */
export interface SupplyCart {
  id: string;
  playerId: PlayerId;
  /** The granary it left from, and the one it walks back to. */
  homeRegionId: string;
  /** Where this run is headed. Equals `homeRegionId` once returning. */
  destination: string;
  /** Villagers pulling it. They stop earning until it gets home. */
  porters: number;
  /** Food still aboard. Spent on arrival; the remainder rides home. */
  load: number;
  /** true once it has delivered and is on its way back. */
  returning: boolean;
  from: string;
  to: string;
  route: string[];
  totalSeconds: number;
  remainingSeconds: number;
}

/**
 * A fight in progress over one region (docs/game-design.md 6.2). Rounds are
 * traded every few seconds rather than the whole thing resolving on contact,
 * so reinforcements can join and an attacker can break off.
 *
 * The defender's troops are the region's own garrison — a battle doesn't copy
 * them out, it just tracks the attacking force and the round clock.
 */
export interface Battle {
  regionId: string;
  attackerId: PlayerId;
  attackerUnits: UnitCounts;
  attackerCarry: number;
  /** The attacking force’s supply, which scales how well it fights (docs 7). */
  attackerSupply: number;
  /** Where the attack came from, so breaking off has somewhere to go back to. */
  attackerFrom: string;
  /** What the attacker was told to do here, kept for the survivors. */
  attackerOnArrival?: 'assault' | 'occupy';
  /** null when the defender is a neutral garrison. */
  defenderId: PlayerId | null;
  defenderCarry: number;
  secondsUntilRound: number;
  roundsFought: number;
}

export interface GameState {
  regions: Record<string, RegionState>;
  players: Record<PlayerId, PlayerState>;
  /** Every player-owned body of troops, standing or on the road. */
  legions: Legion[];
  /** Armies currently on the road. Each belongs to a legion. */
  marches: March[];
  /** Supply carts out on a run. Idle carts aren't tracked — they're a count. */
  carts: SupplyCart[];
  /** Fights in progress, at most one per region. */
  battles: Battle[];
  elapsedSeconds: number;
  /**
   * Seconds until the next gold payout. Gold arrives in whole-minute
   * instalments rather than trickling in, so "10 villagers" visibly means
   * "+10 gold, once a minute".
   */
  secondsUntilPayout: number;
}
