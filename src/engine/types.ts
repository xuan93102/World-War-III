import type { BuildingType } from './buildings';
import type { UnitCounts } from './units';

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
}

export interface RegionState {
  owner: PlayerId | null;
  isCore: boolean;
  /**
   * Troops stationed here. On neutral land this is the garrison, which is
   * only ever militia and is sized by land area; on owned land it's whatever
   * the owner has trained or moved in.
   */
  units: UnitCounts;
  /** Completed building, if any. One per region (docs/game-design.md 5). */
  building?: { type: BuildingType; hp: number };
  /** In-progress build, if any. Mutually exclusive with `building`. */
  construction?: { type: BuildingType; remainingSeconds: number; totalSeconds: number };
  /**
   * Seconds the current owner has held a *completed* wonder here. Resets if
   * the wonder is lost or destroyed; at WONDER_HOLD_SECONDS the owner wins.
   */
  wonderHeldSeconds?: number;
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
}

export interface GameState {
  regions: Record<string, RegionState>;
  players: Record<PlayerId, PlayerState>;
  /** Armies currently on the road. */
  marches: March[];
  elapsedSeconds: number;
  /**
   * Seconds until the next gold payout. Gold arrives in whole-minute
   * instalments rather than trickling in, so "10 villagers" visibly means
   * "+10 gold, once a minute".
   */
  secondsUntilPayout: number;
}
