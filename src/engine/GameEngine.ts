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
import {
  CORE_UPGRADE,
  MAX_CORE_LEVEL,
  MAX_RESEARCHERS,
  RESEARCHER_SECONDS,
  RESEARCH_SLOTS,
  TECHS,
  attackMultiplier,
  damageTakenMultiplier,
  foodTechMultiplier,
  marchTimeMultiplier,
  moneyTechMultiplier,
  populationCapFromTech,
  researchTimeMultiplier,
  researcherCost,
  type TechId,
} from './tech';
import { DEFAULT_MAP_ID, getMap, type GameMap } from './maps';
import { garrisonAt } from './regions';
import type {
  AiDifficulty,
  Battle,
  Legion,
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
/** Legions start full; spending supply is the next piece of work (docs 7). */
const FULL_SUPPLY = 1;
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

export type ResearchRejection =
  | 'done'
  | 'inProgress'
  | 'notImplemented'
  | 'needsLab'
  | 'needsCoreLevel'
  | 'needsPrereq'
  | 'slotsFull'
  | 'cannotAfford';

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
        coreLevel: 1,
        techs: [],
        research: [],
        researchers: 0,
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
      legions: [],
      marches: [],
      battles: [],
      elapsedSeconds: 0,
      secondsUntilPayout: PAYOUT_INTERVAL_SECONDS,
    };
  }

  // ---- legions (docs/game-design.md 7) -----------------------------------

  private nextMarchId = 1;
  private nextLegionId = 1;

  /** Legions standing in a region — ones out on the road are excluded. */
  legionsAt(regionId: string): Legion[] {
    const marching = new Set(this.state.marches.map((m) => m.legionId));
    return this.state.legions.filter((l) => l.regionId === regionId && !marching.has(l.id));
  }

  /** What is standing here — see garrisonAt() in regions.ts. */
  garrisonAt(regionId: string): UnitCounts {
    return garrisonAt(this.state, regionId);
  }

  /**
   * This player's legion in a region, created empty if they have none there.
   * One per region per player, so reinforcements merge rather than piling up
   * as separate stacks — which keeps "the defender" a single target.
   */
  private legionFor(regionId: string, playerId: PlayerId): Legion {
    const existing = this.legionsAt(regionId).find((l) => l.playerId === playerId);
    if (existing) return existing;
    const legion: Legion = {
      id: `l${this.nextLegionId++}`,
      playerId,
      units: {},
      supply: FULL_SUPPLY,
      regionId,
    };
    this.state.legions.push(legion);
    return legion;
  }

  /** Forgets emptied legions, unless they're still out on a march. */
  private pruneLegions(): void {
    const marching = new Set(this.state.marches.map((m) => m.legionId));
    this.state.legions = this.state.legions.filter(
      (l) => totalUnits(l.units) > 0 || marching.has(l.id),
    );
  }

  /** Seconds a hop between these two regions takes. */
  marchSeconds(from: string, to: string, playerId?: PlayerId): number {
    const base = marchSeconds(this.map, from, to);
    if (!playerId) return base;
    // Rapid reaction only helps on ground you already hold, so it rewards
    // defending a front rather than pushing into one.
    const onOwnGround =
      this.state.regions[from]?.owner === playerId && this.state.regions[to]?.owner === playerId;
    return base * marchTimeMultiplier(this.ownedTechs(playerId), onOwnGround);
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
    if (region.owner === null && totalUnits(this.garrisonAt(regionId)) > 0) return false;
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
      (a, b) => terrainRejection(this.map, a, b, this.hasMountainRoad(playerId)) === null,
    );
  }

  /** Total seconds for a whole route, summing each hop. */
  routeSeconds(from: string, route: string[], playerId?: PlayerId): number {
    let total = 0;
    let at = from;
    for (const step of route) {
      total += this.marchSeconds(at, step, playerId);
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
    if (!stackContains(this.garrisonAt(from), units)) return 'noUnits';
    if (from === to) return 'notAdjacent';
    if (this.marchRoute(from, to, playerId) !== null) return null;
    // No route. Say which wall they hit: a sealed pass reads very differently
    // from "there's no way through", and both are actionable.
    if (terrainRejection(this.map, from, to, this.hasMountainRoad(playerId)) === 'passLocked')
      return 'passLocked';
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
    // The column becomes a legion of its own, inheriting the garrison's
    // supply — what marches out and what stays behind each keep their own bar.
    const garrison = this.legionFor(from, playerId);
    garrison.units = subtractUnits(garrison.units, units);
    const column: Legion = {
      id: `l${this.nextLegionId++}`,
      playerId,
      units: { ...units },
      supply: garrison.supply,
      regionId: from,
    };
    this.state.legions.push(column);
    const [next, ...rest] = route;
    const seconds = this.marchSeconds(from, next, playerId);
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
      legionId: column.id,
    };
    this.state.marches.push(march);
    this.pruneLegions();
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

  // ---- research (docs/game-design.md 10 and 11) --------------------------

  ownedTechs(playerId: PlayerId): Set<TechId> {
    return new Set(this.state.players[playerId].techs);
  }

  hasTech(playerId: PlayerId, techId: TechId): boolean {
    return this.state.players[playerId].techs.includes(techId);
  }

  /** Whether this player has a finished research institute anywhere. */
  private hasLab(playerId: PlayerId): boolean {
    return this.ownedRegions(playerId).some((r) => r.building?.type === 'research');
  }

  researchRejection(playerId: PlayerId, techId: TechId): ResearchRejection | null {
    const player = this.state.players[playerId];
    const def = TECHS[techId];
    if (player.techs.includes(techId)) return 'done';
    if (player.research.some((r) => r.techId === techId)) return 'inProgress';
    if (!def.implemented) return 'notImplemented';
    if (!this.hasLab(playerId)) return 'needsLab';
    if (player.coreLevel < def.coreLevel) return 'needsCoreLevel';
    if (!def.requires.every((id) => player.techs.includes(id))) return 'needsPrereq';
    if (player.research.length >= RESEARCH_SLOTS) return 'slotsFull';
    if (player.money < def.costMoney) return 'cannotAfford';
    return null;
  }

  /** Puts a tech into the research queue, charging for it up front. */
  startResearch(playerId: PlayerId, techId: TechId): boolean {
    if (this.researchRejection(playerId, techId) !== null) return false;
    const player = this.state.players[playerId];
    const def = TECHS[techId];
    player.money -= def.costMoney;
    // Researchers shorten the clock, so the duration is fixed at the moment
    // research starts rather than floating as more of them are trained.
    const seconds = def.seconds * researchTimeMultiplier(player.researchers);
    player.research.push({ techId, remainingSeconds: seconds, totalSeconds: seconds });
    return true;
  }

  researcherRejection(playerId: PlayerId): 'full' | 'training' | 'needsSchool' | 'noPopulationRoom' | 'cannotAfford' | null {
    const player = this.state.players[playerId];
    if (player.researchers >= MAX_RESEARCHERS) return 'full';
    if (player.researcherTraining) return 'training';
    if (!this.ownedRegions(playerId).some((r) => r.building?.type === 'school')) return 'needsSchool';
    if (this.populationRoom(playerId) < 1) return 'noPopulationRoom';
    if (player.money < researcherCost(player.researchers)) return 'cannotAfford';
    return null;
  }

  trainResearcher(playerId: PlayerId): boolean {
    if (this.researcherRejection(playerId) !== null) return false;
    const player = this.state.players[playerId];
    player.money -= researcherCost(player.researchers);
    player.researcherTraining = {
      remainingSeconds: RESEARCHER_SECONDS,
      totalSeconds: RESEARCHER_SECONDS,
    };
    return true;
  }

  coreUpgradeRejection(playerId: PlayerId): 'maxed' | 'inProgress' | 'cannotAfford' | null {
    const player = this.state.players[playerId];
    if (player.coreLevel >= MAX_CORE_LEVEL) return 'maxed';
    if (player.coreUpgrade) return 'inProgress';
    const next = (player.coreLevel + 1) as 2 | 3;
    const cost = CORE_UPGRADE[next];
    if (player.money < cost.costMoney || player.food < cost.costFood) return 'cannotAfford';
    return null;
  }

  startCoreUpgrade(playerId: PlayerId): boolean {
    if (this.coreUpgradeRejection(playerId) !== null) return false;
    const player = this.state.players[playerId];
    const next = (player.coreLevel + 1) as 2 | 3;
    const cost = CORE_UPGRADE[next];
    player.money -= cost.costMoney;
    player.food -= cost.costFood;
    player.coreUpgrade = {
      toLevel: next,
      remainingSeconds: cost.seconds,
      totalSeconds: cost.seconds,
    };
    return true;
  }

  /** Whether this player's infantry can cross a mountain pass yet (docs 3.2). */
  hasMountainRoad(playerId: PlayerId): boolean {
    return this.hasTech(playerId, 'mountainRoad');
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
    // Tech scales both what a side deals and what it soaks. A neutral
    // garrison has no research, so it fights at flat values.
    const attackerTechs = this.ownedTechs(battle.attackerId);
    const defenderTechs = battle.defenderId
      ? this.ownedTechs(battle.defenderId)
      : new Set<TechId>();
    const defenderLegion = battle.defenderId
      ? this.legionFor(battle.regionId, battle.defenderId)
      : null;
    const outcome = resolveRound(
      battle.attackerUnits,
      battle.attackerCarry,
      defenderLegion ? defenderLegion.units : region.units,
      battle.defenderCarry,
      {
        attackerAttack: attackMultiplier(attackerTechs),
        defenderAttack: attackMultiplier(defenderTechs),
        attackerTaken: damageTakenMultiplier(attackerTechs),
        defenderTaken: damageTakenMultiplier(defenderTechs),
      },
    );
    battle.attackerUnits = outcome.attacker.units;
    battle.attackerCarry = outcome.attacker.carry;
    if (defenderLegion) defenderLegion.units = outcome.defender.units;
    else region.units = outcome.defender.units;
    battle.defenderCarry = outcome.defender.carry;
    battle.roundsFought += 1;

    if (!outcome.attackerWiped && !outcome.defenderWiped) return false;

    if (outcome.attackerWiped && outcome.defenderWiped) {
      // Both gone. The ground belongs to nobody, and a remnant holds it — so
      // mutual annihilation doesn't quietly hand the region to the defender.
      this.setRegionOwner(battle.regionId, null);
      region.units = { militia: MUTINY_MILITIA };
      this.pruneLegions();
      return true;
    }
    if (outcome.defenderWiped) {
      this.setRegionOwner(battle.regionId, battle.attackerId);
      // The victors become the new garrison, as a legion of their own.
      this.legionFor(battle.regionId, battle.attackerId).units = battle.attackerUnits;
      this.pruneLegions();
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
    const seconds = this.marchSeconds(battle.regionId, battle.attackerFrom, playerId);
    const column: Legion = {
      id: `l${this.nextLegionId++}`,
      playerId,
      units: { ...battle.attackerUnits },
      supply: FULL_SUPPLY,
      regionId: battle.regionId,
    };
    this.state.legions.push(column);
    this.state.marches.push({
      legionId: column.id,
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
      this.state.legions = this.state.legions.filter((l) => l.id !== march.legionId);
      return true;
    }

    // Walking into empty neutral land takes it — that's the capture rule from
    // docs 3.3. setRegionOwner clears the region's units, so claim first and
    // land the army after.
    if (target.owner === null && totalUnits(this.garrisonAt(march.to)) === 0) {
      this.setRegionOwner(march.to, march.playerId);
    }

    const next = march.route[0];
    if (next === undefined) {
      // Land the column: it merges into whatever this player already has here,
      // supply averaging by headcount so relief actually relieves.
      const column = this.state.legions.find((l) => l.id === march.legionId);
      const garrison = this.legionFor(march.to, march.playerId);
      if (column && column !== garrison) {
        const had = totalUnits(garrison.units);
        const joining = totalUnits(column.units);
        if (had + joining > 0) {
          garrison.supply = (garrison.supply * had + column.supply * joining) / (had + joining);
        }
        garrison.units = addUnits(garrison.units, column.units);
        this.state.legions = this.state.legions.filter((l) => l !== column);
      }
      return true;
    }

    const walking = this.state.legions.find((l) => l.id === march.legionId);
    if (walking) walking.regionId = march.to;
    march.from = march.to;
    march.to = next;
    march.route = march.route.slice(1);
    march.totalSeconds = this.marchSeconds(march.from, march.to, march.playerId);
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
    if (totalUnits(this.garrisonAt(regionId)) > 0) return 'garrisoned';
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
    // Legions cover garrisons and columns on the road alike — a marching
    // legion is still a legion. Only troops committed to a battle sit outside
    // the list, so they're counted separately.
    const inLegions = this.state.legions
      .filter((l) => l.playerId === playerId)
      .reduce((sum, l) => sum + totalUnits(l.units), 0);
    const fighting = this.state.battles
      .filter((b) => b.attackerId === playerId)
      .reduce((sum, b) => sum + totalUnits(b.attackerUnits), 0);
    return inLegions + fighting;
  }

  /**
   * Total headcount: villagers plus troops. Both draw on one cap, so every
   * soldier permanently lowers the ceiling on income.
   */
  population(playerId: PlayerId): number {
    const player = this.state.players[playerId];
    // Researchers take a slot each, the same as troops do — one being trained
    // included, since its slot is already spoken for.
    const researchers = (player?.researchers ?? 0) + (player?.researcherTraining ? 1 : 0);
    return (player?.villagers ?? 0) + this.troopCount(playerId) + researchers;
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
    const legion = this.legionFor(regionId, playerId);
    legion.units[type] = (legion.units[type] ?? 0) + affordable;
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
    if ((this.garrisonAt(regionId)[def.upgradeFrom] ?? 0) < count) return 'noSourceUnits';
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

    const player = this.state.players[playerId];
    const legion = this.legionFor(regionId, playerId);
    const upgradable = Math.min(
      count,
      legion.units[def.upgradeFrom] ?? 0,
      Math.floor(player.money / def.upgradeCost),
    );
    if (upgradable <= 0) return 0;

    player.money -= upgradable * def.upgradeCost;
    legion.units[def.upgradeFrom] = (legion.units[def.upgradeFrom] ?? 0) - upgradable;
    legion.units[type] = (legion.units[type] ?? 0) + upgradable;
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
    // Legions don't change sides with the ground either. Ones out on the road
    // are left alone — they're not standing here to be captured.
    this.state.legions = this.state.legions.filter(
      (l) => l.regionId !== regionId || this.state.marches.some((m) => m.legionId === l.id),
    );
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

    // Tech multiplies on top of buildings rather than replacing them, and the
    // homestead line raises the base ceiling that housing then multiplies.
    const techs = this.ownedTechs(playerId);
    const baseCap = populationCapFromTech(techs, DEFAULT_POPULATION_CAP);

    return {
      // Gold comes from villagers, not territory.
      // Only villagers earn — population doing other jobs (soldiers,
      // researchers) contributes nothing.
      moneyPerMin:
        (player?.villagers ?? 0) *
        GOLD_PER_VILLAGER_PER_MIN *
        shopMult *
        moneyTechMultiplier(techs) *
        aiMult,
      foodPerMin: this.baseFoodPerMin(playerId) * farmMult * foodTechMultiplier(techs) * aiMult,
      foodCap: BASE_FOOD_CAP + GRANARY_FOOD_CAP * (counts.granary ?? 0),
      populationCap: Math.floor(baseCap * housingMult),
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
    // A separate gate from `implemented`: the building is real, it just has to
    // be earned. Reported as the same rejection so the UI shows the def's own
    // reason either way.
    if (def.requiresTech && !this.hasTech(playerId, def.requiresTech)) return 'notImplemented';

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

    // Research, researcher training and core upgrades all just run down a
    // clock. Charged up front, so finishing only has to hand over the result.
    for (const player of Object.values(this.state.players)) {
      if (player.research.length > 0) {
        const stillRunning: typeof player.research = [];
        for (const job of player.research) {
          job.remainingSeconds -= deltaSeconds;
          if (job.remainingSeconds <= 0) player.techs.push(job.techId);
          else stillRunning.push(job);
        }
        player.research = stillRunning;
      }
      if (player.researcherTraining) {
        player.researcherTraining.remainingSeconds -= deltaSeconds;
        if (player.researcherTraining.remainingSeconds <= 0) {
          player.researcherTraining = undefined;
          player.researchers += 1;
        }
      }
      if (player.coreUpgrade) {
        player.coreUpgrade.remainingSeconds -= deltaSeconds;
        if (player.coreUpgrade.remainingSeconds <= 0) {
          player.coreLevel = player.coreUpgrade.toLevel;
          player.coreUpgrade = undefined;
        }
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
