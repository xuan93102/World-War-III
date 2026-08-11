import {
  BASE_FOOD_CAP,
  BUILDINGS,
  BUILDING_LIMITS,
  GOLD_PER_VILLAGER_PER_MIN,
  GRANARY_FOOD_CAP,
  STACK_BONUS,
  VILLAGER_COST,
  WONDER_HOLD_SECONDS,
  type BuildingType,
} from './buildings';
import { FOOD_PER_MIN_BY_SIZE, MILITIA_BY_SIZE, landSizeOf, safeZoneAround } from './land';
import { UNITS, totalUnits, type UnitType } from './units';
import { REGIONS, getRegion } from './regions';
import type { AiDifficulty, GameState, PlayerId, PlayerState, RegionState } from './types';

/**
 * Economy model (docs/game-design.md section 4):
 *
 * Gold is NOT produced by territory. You buy villagers with gold, and each
 * villager pays back 1 gold/min — so a villager repays itself in a minute and
 * is profit after that. Reinvesting everything therefore doubles your income
 * each minute until you hit the population cap (from 10 gold that's roughly
 * five minutes), after which growth has to come from raising the cap or from
 * multiplier buildings.
 *
 * The sharp edge is that population is also what soldiers, researchers and
 * supply crews are made of: every soldier you train is a villager who stops
 * earning. Army size is paid for in permanent income, not just up-front cost.
 *
 * Food is still territorial, so taking ground still matters — it's what feeds
 * an army even though it no longer prints gold.
 */
// Food output is per-region and scales with land size (see land.ts).
// Bigger ground feeds more, which is what makes taking it worthwhile now
// that gold comes from villagers rather than territory.
const DEFAULT_POPULATION_CAP = 200;
/** Starting gold: buys 10 villagers, i.e. one minute of compounding. */
export const STARTING_MONEY = 10;
/**
 * Gold is paid in whole-minute instalments rather than trickling in every
 * tick: "10 villagers" should visibly mean "+10 gold once a minute", and the
 * wait between payouts is what makes an early reinvestment feel like a real
 * commitment.
 */
export const PAYOUT_INTERVAL_SECONDS = 60;

// Difficulty currently only scales AI resource output (see docs/game-design.md
// "hard = bonus resource output"). The behavioural side — how fast the AI
// expands and whether it attacks — lands with the AI controller itself, which
// isn't built yet.
export const AI_OUTPUT_MULTIPLIER: Record<AiDifficulty, number> = {
  easy: 0.8,
  normal: 1,
  hard: 1.25,
};

export interface PlayerSetup {
  id: PlayerId;
  name: string;
  color: string;
  coreRegionId: string;
  /** Present for AI-controlled seats; omitted for human players. */
  aiDifficulty?: AiDifficulty;
}

export type BuildRejection =
  | 'notOwner'
  | 'occupied'
  | 'building'
  | 'notImplemented'
  | 'cannotAfford'
  | 'limitReached';

export interface PlayerEconomy {
  moneyPerMin: number;
  foodPerMin: number;
  foodCap: number;
  populationCap: number;
  /** Counts of completed buildings, by type. */
  buildingCounts: Record<string, number>;
}

export class GameEngine {
  state: GameState;

  constructor(setups: PlayerSetup[]) {
    const players: Record<PlayerId, PlayerState> = {};
    for (const setup of setups) {
      players[setup.id] = {
        id: setup.id,
        name: setup.name,
        color: setup.color,
        villagers: 0,
        populationCap: DEFAULT_POPULATION_CAP,
        money: STARTING_MONEY,
        food: 0,
        aiDifficulty: setup.aiDifficulty,
        coreRegionId: setup.coreRegionId,
      };
    }

    // Neutral land is garrisoned by militia scaled to its size, except within
    // the safe zone around each core (docs/game-design.md 3.3).
    const safeZone = safeZoneAround(setups.map((s) => s.coreRegionId));
    const regions: GameState['regions'] = {};
    for (const region of REGIONS) {
      regions[region.id] = {
        owner: null,
        isCore: false,
        units: safeZone.has(region.id)
          ? {}
          : { militia: MILITIA_BY_SIZE[landSizeOf(region.landArea)] },
      };
    }
    for (const setup of setups) {
      regions[setup.coreRegionId] = { owner: setup.id, isCore: true, units: {} };
    }

    this.state = {
      regions,
      players,
      elapsedSeconds: 0,
      secondsUntilPayout: PAYOUT_INTERVAL_SECONDS,
    };
  }

  ownedRegions(playerId: PlayerId): RegionState[] {
    return Object.values(this.state.regions).filter((r) => r.owner === playerId);
  }

  /** Region ids owned by a player (ownedRegions loses the id). */
  ownedRegionIds(playerId: PlayerId): string[] {
    return Object.entries(this.state.regions)
      .filter(([, r]) => r.owner === playerId)
      .map(([id]) => id);
  }

  /** Base food per minute from land, before farm bonuses. */
  baseFoodPerMin(playerId: PlayerId): number {
    return this.ownedRegionIds(playerId).reduce(
      (sum, id) => sum + FOOD_PER_MIN_BY_SIZE[landSizeOf(getRegion(id).landArea)],
      0,
    );
  }

  ownedRegionCount(playerId: PlayerId): number {
    return this.ownedRegions(playerId).length;
  }

  /**
   * Why `playerId` can't take this neutral region right now, or null if they
   * could. Neutral land is claimed by force only: it takes soldiers, and any
   * militia holding it have to be beaten first. Nothing can produce soldiers
   * until the army system exists, so `needsSoldiers` is the standing answer
   * for now — the rule is in place ahead of the units that satisfy it.
   */
  captureRejection(regionId: string, playerId: PlayerId, soldiers = 0): 'notNeutral' | 'needsSoldiers' | 'garrisoned' | null {
    const region = this.state.regions[regionId];
    if (!region || region.owner !== null) return 'notNeutral';
    if (soldiers <= 0) return 'needsSoldiers';
    if (totalUnits(region.units) > 0) return 'garrisoned';
    void playerId;
    return null;
  }

  // ---- population -------------------------------------------------------

  /** Troops a player has stationed anywhere. */
  troopCount(playerId: PlayerId): number {
    return this.ownedRegions(playerId).reduce((sum, r) => sum + totalUnits(r.units), 0);
  }

  /**
   * Total headcount: villagers plus troops. Both draw on one cap, so every
   * soldier permanently lowers the ceiling on income.
   */
  population(playerId: PlayerId): number {
    const player = this.state.players[playerId];
    return (player?.villagers ?? 0) + this.troopCount(playerId);
  }

  /** Population slots still free under the cap. */
  populationRoom(playerId: PlayerId): number {
    return Math.max(0, this.economy(playerId).populationCap - Math.floor(this.population(playerId)));
  }

  // ---- training and upgrading -------------------------------------------

  /**
   * Where a unit type may be produced for this player: militia come out of
   * the core, everything else out of an academy (docs/game-design.md 6.1).
   */
  trainingSites(playerId: PlayerId, type: UnitType): string[] {
    const def = UNITS[type];
    if (def.trainAt === 'core') {
      const core = this.state.players[playerId]?.coreRegionId;
      return core && this.state.regions[core]?.owner === playerId ? [core] : [];
    }
    if (def.trainAt === 'academy') {
      return this.ownedRegionIds(playerId).filter(
        (id) => this.state.regions[id].building?.type === 'academy',
      );
    }
    return [];
  }

  trainRejection(
    regionId: string,
    playerId: PlayerId,
    type: UnitType,
    count = 1,
  ): 'wrongSite' | 'notTrainable' | 'cannotAfford' | 'noPopulationRoom' | null {
    const def = UNITS[type];
    if (def.trainCost === null || def.trainAt === null) return 'notTrainable';
    if (!this.trainingSites(playerId, type).includes(regionId)) return 'wrongSite';
    const player = this.state.players[playerId];
    if (player.money < def.trainCost * count) return 'cannotAfford';
    if (this.populationRoom(playerId) < count) return 'noPopulationRoom';
    return null;
  }

  /** Trains units into `regionId`. Returns how many were produced. */
  trainUnits(regionId: string, playerId: PlayerId, type: UnitType, count = 1): number {
    const def = UNITS[type];
    if (def.trainCost === null) return 0;
    if (this.trainRejection(regionId, playerId, type, 1) !== null) return 0;

    const player = this.state.players[playerId];
    const affordable = Math.min(
      count,
      Math.floor(player.money / def.trainCost),
      this.populationRoom(playerId),
    );
    if (affordable <= 0) return 0;

    player.money -= affordable * def.trainCost;
    const units = this.state.regions[regionId].units;
    units[type] = (units[type] ?? 0) + affordable;
    return affordable;
  }

  upgradeRejection(
    regionId: string,
    playerId: PlayerId,
    type: UnitType,
    count = 1,
  ): 'notUpgradable' | 'needsAcademy' | 'noSourceUnits' | 'cannotAfford' | null {
    const def = UNITS[type];
    if (def.upgradeFrom === null || def.upgradeCost === null) return 'notUpgradable';
    const region = this.state.regions[regionId];
    if (!region || region.owner !== playerId) return 'needsAcademy';
    // Upgrades happen at an academy, so troops have to march back to one.
    if (region.building?.type !== 'academy') return 'needsAcademy';
    if ((region.units[def.upgradeFrom] ?? 0) < count) return 'noSourceUnits';
    if (this.state.players[playerId].money < def.upgradeCost * count) return 'cannotAfford';
    return null;
  }

  /**
   * Upgrades units already standing in `regionId` to the next tier. Headcount
   * is unchanged, so this never needs population room.
   */
  upgradeUnits(regionId: string, playerId: PlayerId, type: UnitType, count = 1): number {
    const def = UNITS[type];
    if (def.upgradeFrom === null || def.upgradeCost === null) return 0;
    if (this.upgradeRejection(regionId, playerId, type, 1) !== null) return 0;

    const region = this.state.regions[regionId];
    const player = this.state.players[playerId];
    const upgradable = Math.min(
      count,
      region.units[def.upgradeFrom] ?? 0,
      Math.floor(player.money / def.upgradeCost),
    );
    if (upgradable <= 0) return 0;

    player.money -= upgradable * def.upgradeCost;
    region.units[def.upgradeFrom] = (region.units[def.upgradeFrom] ?? 0) - upgradable;
    region.units[type] = (region.units[type] ?? 0) + upgradable;
    return upgradable;
  }

  setRegionOwner(regionId: string, owner: PlayerId | null): void {
    const region = this.state.regions[regionId];
    if (!region) throw new Error(`Unknown region id: ${regionId}`);
    region.owner = owner;
    // Troops standing here don't change sides with the ground. A neutral
    // garrison had to be beaten to take the region, and a defender's army
    // is destroyed or routed rather than defecting — without this, taking
    // land handed the winner the loser's units *and* their population.
    // The attacking army arrives via the movement system instead.
    region.units = {};
    // A change of hands interrupts any build in progress and resets the
    // wonder hold clock — you have to hold it yourself to win with it.
    region.construction = undefined;
    region.wonderHeldSeconds = undefined;
  }

  /** Completed-building counts for a player, keyed by building type. */
  buildingCounts(playerId: PlayerId): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const region of this.ownedRegions(playerId)) {
      if (region.building) counts[region.building.type] = (counts[region.building.type] ?? 0) + 1;
    }
    return counts;
  }

  /** Current production rates and caps, with building bonuses applied. */
  economy(playerId: PlayerId): PlayerEconomy {
    const player = this.state.players[playerId];
    const counts = this.buildingCounts(playerId);
    const aiMult = player?.aiDifficulty ? AI_OUTPUT_MULTIPLIER[player.aiDifficulty] : 1;

    const shopMult = 1 + STACK_BONUS * (counts.shop ?? 0);
    const farmMult = 1 + STACK_BONUS * (counts.farm ?? 0);
    // Housing is limit-capped at build time, but clamp here too so the number
    // shown can never disagree with the rule.
    const housingCount = Math.min(counts.housing ?? 0, BUILDING_LIMITS.housing ?? Infinity);
    const housingMult = 1 + STACK_BONUS * housingCount;

    return {
      // Gold comes from villagers, not territory.
      // Only villagers earn — population doing other jobs (soldiers,
      // researchers) contributes nothing.
      moneyPerMin: (player?.villagers ?? 0) * GOLD_PER_VILLAGER_PER_MIN * shopMult * aiMult,
      foodPerMin: this.baseFoodPerMin(playerId) * farmMult * aiMult,
      foodCap: BASE_FOOD_CAP + GRANARY_FOOD_CAP * (counts.granary ?? 0),
      populationCap: Math.floor(DEFAULT_POPULATION_CAP * housingMult),
      buildingCounts: counts,
    };
  }

  /**
   * How many villagers `playerId` can afford and house right now — the cap on
   * a "buy max" action.
   */
  maxAffordableVillagers(playerId: PlayerId): number {
    const player = this.state.players[playerId];
    if (!player) return 0;
    return Math.max(
      0,
      Math.min(Math.floor(player.money / VILLAGER_COST), this.populationRoom(playerId)),
    );
  }

  /** Recruits villagers at VILLAGER_COST each. Returns how many were bought. */
  buyVillagers(playerId: PlayerId, count: number): number {
    const affordable = Math.min(count, this.maxAffordableVillagers(playerId));
    if (affordable <= 0) return 0;
    const player = this.state.players[playerId];
    player.money -= affordable * VILLAGER_COST;
    player.villagers += affordable;
    return affordable;
  }

  /** Why `playerId` can't start `type` here, or null if they can. */
  buildRejection(regionId: string, type: BuildingType, playerId: PlayerId): BuildRejection | null {
    const region = this.state.regions[regionId];
    const player = this.state.players[playerId];
    if (!region || !player) return 'notOwner';
    if (region.owner !== playerId) return 'notOwner';
    if (region.building) return 'occupied';
    if (region.construction) return 'building';

    const def = BUILDINGS[type];
    if (!def.implemented) return 'notImplemented';

    const limit = BUILDING_LIMITS[type];
    if (limit !== undefined) {
      // Count in-progress builds too, otherwise you could queue past the
      // limit by starting several before any of them finish.
      const built = this.buildingCounts(playerId)[type] ?? 0;
      const queued = this.ownedRegions(playerId).filter((r) => r.construction?.type === type).length;
      if (built + queued >= limit) return 'limitReached';
    }

    if (player.money < def.costMoney || player.food < def.costFood) return 'cannotAfford';
    return null;
  }

  canBuild(regionId: string, type: BuildingType, playerId: PlayerId): boolean {
    return this.buildRejection(regionId, type, playerId) === null;
  }

  /** Deducts the cost and starts the build timer. Returns false if rejected. */
  startConstruction(regionId: string, type: BuildingType, playerId: PlayerId): boolean {
    if (!this.canBuild(regionId, type, playerId)) return false;
    const def = BUILDINGS[type];
    const player = this.state.players[playerId];
    player.money -= def.costMoney;
    player.food -= def.costFood;
    this.state.regions[regionId].construction = {
      type,
      remainingSeconds: def.buildSeconds,
      totalSeconds: def.buildSeconds,
    };
    return true;
  }

  /** Cancels an in-progress build and refunds its full cost. */
  cancelConstruction(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    if (!region || region.owner !== playerId || !region.construction) return false;
    const def = BUILDINGS[region.construction.type];
    const player = this.state.players[playerId];
    player.money += def.costMoney;
    player.food += def.costFood;
    region.construction = undefined;
    return true;
  }

  /** Removes a completed building, freeing the region's single slot. */
  demolish(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    if (!region || region.owner !== playerId || !region.building) return false;
    if (region.isCore) return false; // the core can't be removed (docs 6.7)
    region.building = undefined;
    region.wonderHeldSeconds = undefined;
    return true;
  }

  /**
   * Winner, if the match is decided. Two paths, both from docs 12:
   *  - the opponent's core region changes hands (core HP isn't built yet, so
   *    losing control stands in for the core falling)
   *  - a completed wonder is held for WONDER_HOLD_SECONDS
   */
  getWinner(): PlayerState | null {
    for (const region of Object.values(this.state.regions)) {
      if (
        region.building?.type === 'wonder' &&
        region.owner &&
        (region.wonderHeldSeconds ?? 0) >= WONDER_HOLD_SECONDS
      ) {
        return this.state.players[region.owner] ?? null;
      }
    }

    const alive = Object.values(this.state.players).filter(
      (p) => this.state.regions[p.coreRegionId]?.owner === p.id,
    );
    if (alive.length === 1 && Object.keys(this.state.players).length > 1) return alive[0];
    return null;
  }

  /** Seconds remaining before a held wonder wins, or null if none is held. */
  wonderCountdown(): { playerId: PlayerId; secondsLeft: number } | null {
    for (const region of Object.values(this.state.regions)) {
      if (region.building?.type === 'wonder' && region.owner) {
        return {
          playerId: region.owner,
          secondsLeft: Math.max(0, WONDER_HOLD_SECONDS - (region.wonderHeldSeconds ?? 0)),
        };
      }
    }
    return null;
  }

  tick(deltaSeconds: number): void {
    this.state.elapsedSeconds += deltaSeconds;
    const minutes = deltaSeconds / 60;

    for (const region of Object.values(this.state.regions)) {
      if (region.construction) {
        region.construction.remainingSeconds -= deltaSeconds;
        if (region.construction.remainingSeconds <= 0) {
          const type = region.construction.type;
          region.construction = undefined;
          region.building = { type, hp: BUILDINGS[type].hp };
          if (type === 'wonder') region.wonderHeldSeconds = 0;
        }
      }
      if (region.building?.type === 'wonder' && region.owner) {
        region.wonderHeldSeconds = (region.wonderHeldSeconds ?? 0) + deltaSeconds;
      }
    }

    for (const player of Object.values(this.state.players)) {
      const eco = this.economy(player.id);
      // Population no longer grows on its own — it's recruited with gold via
      // buyVillagers(). Keep the cached cap in sync so the UI and the
      // recruit action agree on the ceiling.
      player.populationCap = eco.populationCap;
      // A lowered cap (e.g. housing demolished or captured) sheds headcount.
      // Villagers absorb it, since they're the uncommitted population —
      // troops already in the field aren't disbanded by a housing loss.
      const over = this.population(player.id) - player.populationCap;
      if (over > 0) player.villagers = Math.max(0, player.villagers - over);
      // Food still accrues continuously; only gold is batched.
      player.food = Math.min(eco.foodCap, player.food + eco.foodPerMin * minutes);
    }

    // Gold payout. The loop covers a delta larger than one interval, which
    // real ticks never produce but tests and long stalls can.
    this.state.secondsUntilPayout -= deltaSeconds;
    while (this.state.secondsUntilPayout <= 0) {
      this.state.secondsUntilPayout += PAYOUT_INTERVAL_SECONDS;
      for (const player of Object.values(this.state.players)) {
        // moneyPerMin is exactly one instalment, since the interval is a minute.
        player.money += this.economy(player.id).moneyPerMin;
      }
    }
  }
}
