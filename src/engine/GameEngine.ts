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
import { UNITS, totalUnits, type UnitCounts, type UnitType } from './units';
import {
  addUnits,
  findPath,
  marchSeconds,
  stackContains,
  subtractUnits,
  terrainRejection,
  type MarchRejection,
} from './movement';
import { COMBAT_ROUND_SECONDS, MUTINY_MILITIA, resolveRound } from './combat';
import { DEFAULT_MAP_ID, getMap, type GameMap } from './maps';
import type {
  AiDifficulty,
  Battle,
  GameState,
  March,
  PlayerId,
  PlayerState,
  RegionState,
} from './types';

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

  /** The map this match is played on. */
  readonly map: GameMap;

  constructor(setups: PlayerSetup[], mapId: string = DEFAULT_MAP_ID) {
    this.map = getMap(mapId);
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
    const safeZone = safeZoneAround(this.map, setups.map((s) => s.coreRegionId));
    const regions: GameState['regions'] = {};
    for (const region of this.map.regions) {
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
      marches: [],
      battles: [],
      elapsedSeconds: 0,
      secondsUntilPayout: PAYOUT_INTERVAL_SECONDS,
    };
  }

  // ---- marching (docs/game-design.md 8) ----------------------------------

  private nextMarchId = 1;

  /** Seconds a hop between these two regions takes. */
  marchSeconds(from: string, to: string): number {
    return marchSeconds(this.map, from, to);
  }

  /**
   * Whether an army of `playerId` can stand in this region. Enemy ground and
   * garrisoned neutral ground would both have to be fought for, and combat
   * resolution (docs 6.2) doesn't exist yet — so for now a march routes around
   * them rather than into them.
   */
  private canEnter(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    if (!region) return false;
    if (region.owner !== null && region.owner !== playerId) return false;
    // Your own regions are always open, garrison or not — that's how
    // reinforcements reach the front.
    if (region.owner === null && totalUnits(region.units) > 0) return false;
    return true;
  }

  /** Whether arriving here would be a peaceful landing rather than an attack. */
  canMarchInPeace(regionId: string, playerId: PlayerId): boolean {
    return this.canEnter(regionId, playerId);
  }

  /** The route a march would take, or null if there's no legal way through. */
  marchRoute(from: string, to: string, playerId: PlayerId): string[] | null {
    return findPath(
      this.map,
      from,
      to,
      (id) => this.canEnter(id, playerId),
      (a, b) => terrainRejection(this.map, a, b) === null,
    );
  }

  /** Total seconds for a whole route, summing each hop. */
  routeSeconds(from: string, route: string[]): number {
    let total = 0;
    let at = from;
    for (const step of route) {
      total += marchSeconds(this.map, at, step);
      at = step;
    }
    return total;
  }

  marchRejection(
    from: string,
    to: string,
    playerId: PlayerId,
    units: UnitCounts,
  ): MarchRejection | null {
    const origin = this.state.regions[from];
    if (!origin || origin.owner !== playerId) return 'notOwner';
    if (!stackContains(origin.units, units)) return 'noUnits';
    if (from === to) return 'notAdjacent';
    if (this.marchRoute(from, to, playerId) !== null) return null;
    // No route. Say which wall they hit: a sealed pass reads very differently
    // from "there's no way through", and both are actionable.
    if (terrainRejection(this.map, from, to) === 'passLocked') return 'passLocked';
    return 'noRoute';
  }

  /**
   * Sends part of a region's garrison to another region, however far. The army
   * walks the route one hop at a time.
   */
  startMarch(from: string, to: string, playerId: PlayerId, units: UnitCounts): March | null {
    if (this.marchRejection(from, to, playerId, units) !== null) return null;
    const route = this.marchRoute(from, to, playerId);
    if (!route || route.length === 0) return null;
    const origin = this.state.regions[from];
    origin.units = subtractUnits(origin.units, units);
    const [next, ...rest] = route;
    const seconds = marchSeconds(this.map, from, next);
    const march: March = {
      id: `m${this.nextMarchId++}`,
      playerId,
      from,
      to: next,
      route: rest,
      destination: to,
      units: { ...units },
      totalSeconds: seconds,
      remainingSeconds: seconds,
    };
    this.state.marches.push(march);
    return march;
  }

  /**
   * Marches leaving or heading for a region. Troops on the road belong to no
   * region, so this is how a region can still account for the troops that just
   * left it and the ones on their way in.
   */
  marchesInvolving(regionId: string): March[] {
    return this.state.marches.filter((m) => m.from === regionId || m.to === regionId);
  }

  /** Troops this player has on the road or committed to an attack. */
  marchingUnits(playerId: PlayerId): number {
    const onRoad = this.state.marches
      .filter((m) => m.playerId === playerId)
      .reduce((sum, m) => sum + totalUnits(m.units), 0);
    // Attackers in a battle have left their region but haven't taken the one
    // they're fighting for, so like marching troops they'd otherwise fall out
    // of the population count entirely.
    const fighting = this.state.battles
      .filter((b) => b.attackerId === playerId)
      .reduce((sum, b) => sum + totalUnits(b.attackerUnits), 0);
    return onRoad + fighting;
  }

  // ---- combat (docs/game-design.md 6.2) ----------------------------------

  battleAt(regionId: string): Battle | undefined {
    return this.state.battles.find((b) => b.regionId === regionId);
  }

  /**
   * Throws an army at a region someone else holds. Joining a fight already in
   * progress just adds to the attacking stack — the reinforcements take effect
   * from the next round, since the round clock keeps running.
   */
  private engage(regionId: string, attackerId: PlayerId, units: UnitCounts, from: string): void {
    const existing = this.battleAt(regionId);
    if (existing && existing.attackerId === attackerId) {
      existing.attackerUnits = addUnits(existing.attackerUnits, units);
      return;
    }
    if (existing) {
      // Someone else's fight. Third parties aren't modelled in a 1v1, so the
      // newcomer reinforces whichever side it isn't at war with rather than
      // opening a second front.
      existing.attackerUnits = addUnits(existing.attackerUnits, units);
      return;
    }
    const region = this.state.regions[regionId];
    this.state.battles.push({
      regionId,
      attackerId,
      attackerUnits: { ...units },
      attackerCarry: 0,
      attackerFrom: from,
      defenderId: region.owner,
      defenderCarry: 0,
      secondsUntilRound: COMBAT_ROUND_SECONDS,
      roundsFought: 0,
    });
  }

  /** Runs one exchange and settles the battle if it ended. Returns true when over. */
  private fightRound(battle: Battle): boolean {
    const region = this.state.regions[battle.regionId];
    const outcome = resolveRound(
      battle.attackerUnits,
      battle.attackerCarry,
      region.units,
      battle.defenderCarry,
    );
    battle.attackerUnits = outcome.attacker.units;
    battle.attackerCarry = outcome.attacker.carry;
    region.units = outcome.defender.units;
    battle.defenderCarry = outcome.defender.carry;
    battle.roundsFought += 1;

    if (!outcome.attackerWiped && !outcome.defenderWiped) return false;

    if (outcome.attackerWiped && outcome.defenderWiped) {
      // Both gone. The ground belongs to nobody, and a remnant holds it — so
      // mutual annihilation doesn't quietly hand the region to the defender.
      this.setRegionOwner(battle.regionId, null);
      region.units = { militia: MUTINY_MILITIA };
      return true;
    }
    if (outcome.defenderWiped) {
      this.setRegionOwner(battle.regionId, battle.attackerId);
      region.units = battle.attackerUnits;
      return true;
    }
    // Attacker wiped: the defender holds, with whatever survived.
    return true;
  }

  /**
   * Whether this player can break off the attack on a region. An attack has to
   * stand for at least one exchange before it can withdraw (6.2), and there
   * has to be somewhere to withdraw to.
   */
  retreatRejection(regionId: string, playerId: PlayerId): 'noBattle' | 'tooSoon' | 'cutOff' | null {
    const battle = this.battleAt(regionId);
    if (!battle || battle.attackerId !== playerId) return 'noBattle';
    if (battle.roundsFought < 1) return 'tooSoon';
    if (!this.canEnter(battle.attackerFrom, playerId)) return 'cutOff';
    return null;
  }

  /** Pulls the survivors out, marching them back the way they came. */
  retreat(regionId: string, playerId: PlayerId): boolean {
    if (this.retreatRejection(regionId, playerId) !== null) return false;
    const battle = this.battleAt(regionId)!;
    const seconds = marchSeconds(this.map, battle.regionId, battle.attackerFrom);
    this.state.marches.push({
      id: `m${this.nextMarchId++}`,
      playerId,
      from: battle.regionId,
      to: battle.attackerFrom,
      route: [],
      destination: battle.attackerFrom,
      units: battle.attackerUnits,
      totalSeconds: seconds,
      remainingSeconds: seconds,
    });
    this.state.battles = this.state.battles.filter((b) => b !== battle);
    return true;
  }

  /**
   * Ends the current hop. The army really enters `march.to` — taking it if
   * it's empty neutral land — and then either stops there or sets off on the
   * next leg. Returns true when the whole march is done.
   *
   * Entering for real at every stop is the point: it's what will let an enemy
   * standing on the route intercept the column (docs 6.2, once combat exists)
   * instead of watching it teleport past.
   */
  private completeHop(march: March): boolean {
    const target = this.state.regions[march.to];

    // Walking into ground someone else holds starts a fight rather than a
    // landing. This is also how interception works: a route is planned around
    // hostile ground, so if an enemy has moved into the column's path since it
    // set out, it walks straight into them.
    if (!this.canEnter(march.to, march.playerId)) {
      this.engage(march.to, march.playerId, march.units, march.from);
      return true;
    }

    // Walking into empty neutral land takes it — that's the capture rule from
    // docs 3.3. setRegionOwner clears the region's units, so claim first and
    // land the army after.
    if (target.owner === null && totalUnits(target.units) === 0) {
      this.setRegionOwner(march.to, march.playerId);
    }

    const next = march.route[0];
    if (next === undefined) {
      target.units = addUnits(target.units, march.units);
      return true;
    }

    march.from = march.to;
    march.to = next;
    march.route = march.route.slice(1);
    march.totalSeconds = marchSeconds(this.map, march.from, march.to);
    // Carry the overshoot into the next leg so a long march doesn't gain a
    // fraction of a second at every stop.
    march.remainingSeconds += march.totalSeconds;
    return false;
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
      (sum, id) => sum + FOOD_PER_MIN_BY_SIZE[landSizeOf(this.map.region(id).landArea)],
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

  /**
   * Troops a player has stationed anywhere, plus any on the road. Marching
   * troops belong to no region, so without the second term an army would drop
   * out of the population count the moment it set off — and marching everyone
   * out would free up headroom to recruit a second army for nothing.
   */
  troopCount(playerId: PlayerId): number {
    const garrisoned = this.ownedRegions(playerId).reduce((sum, r) => sum + totalUnits(r.units), 0);
    return garrisoned + this.marchingUnits(playerId);
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

    // Battles resolve BEFORE marches, and the order matters: a march landing
    // this tick starts a battle, and that battle must not then be handed the
    // whole tick's elapsed time. Fighting first means a fresh engagement waits
    // for its first proper round instead of retroactively grinding through
    // several the instant it begins.
    //
    // The inner loop covers a delta wide enough to span several rounds, which
    // tests and long stalls can produce.
    if (this.state.battles.length > 0) {
      const ongoing: Battle[] = [];
      for (const battle of this.state.battles) {
        battle.secondsUntilRound -= deltaSeconds;
        let over = false;
        while (!over && battle.secondsUntilRound <= 0) {
          battle.secondsUntilRound += COMBAT_ROUND_SECONDS;
          over = this.fightRound(battle);
        }
        if (!over) ongoing.push(battle);
      }
      this.state.battles = ongoing;
    }

    // Advance every march, landing the ones that arrive. Iterated over a copy
    // so arrival can't disturb the list being walked.
    if (this.state.marches.length > 0) {
      const stillMoving: March[] = [];
      for (const march of this.state.marches) {
        march.remainingSeconds -= deltaSeconds;
        // A loop, not an `if`: one tick can span several short hops.
        let done = false;
        while (!done && march.remainingSeconds <= 0) {
          done = this.completeHop(march);
        }
        if (!done) stillMoving.push(march);
      }
      this.state.marches = stillMoving;
    }

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
