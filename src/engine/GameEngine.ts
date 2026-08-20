import {
  BASE_FOOD_CAP,
  BUILDINGS,
  BASTION_BONUS,
  BUILDING_LIMITS,
  CORE_HP,
  buildingHp,
  GOLD_PER_VILLAGER_PER_MIN,
  GRANARY_FOOD_CAP,
  MAX_STAFF,
  STAFFABLE,
  STAFF_BONUS,
  STAFF_REPAIR_PER_SECOND,
  STACK_BONUS,
  VILLAGER_COST,
  WONDER_HOLD_SECONDS,
  type BuildingType,
} from './buildings';
import { pinned } from './clock';
import { FOOD_PER_MIN_BY_SIZE, MILITIA_BY_SIZE, landSizeOf, safeZoneAround } from './land';
import {
  UNITS,
  UNIT_ORDER,
  isVehicle,
  rangedAtk,
  siegeAtk,
  stackAtk,
  stackSpeed,
  totalUnits,
  troopsOnly,
  type UnitCounts,
  type UnitType,
} from './units';
import {
  addUnits,
  findPath,
  MARCH_SECONDS_VIA_PASS,
  marchSeconds,
  stackContains,
  subtractUnits,
  terrainRejection,
  type MarchRejection,
} from './movement';
import { COMBAT_ROUND_SECONDS, MUTINY_MILITIA, applyDamage, resolveRound } from './combat';
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
  arsenalTimeMultiplier,
  researcherCost,
  trainTimeMultiplier,
  siegeDamageMultiplier,
  supplyCartCap,
  vehiclesCrossPasses,
  type TechId,
} from './tech';
import { DEFAULT_MAP_ID, getMap, type GameMap } from './maps';
import {
  CART_FOOD_LOAD,
  FULL_SUPPLY,
  cartHopSeconds,
  footingAt,
  logisticsZones,
  nextSupply,
  refillFrom,
  supplyAttackMultiplier,
  supplyDamageTakenMultiplier,
  type LogisticsZones,
} from './supply';
import { garrisonAt } from './regions';
import { unitsVisibleTo, visibleRegions } from './vision';
import type {
  AiDifficulty,
  Battle,
  Legion,
  GameState,
  March,
  PlayerId,
  PlayerState,
  RegionState,
  SupplyCart,
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

export type ResearchRejection =
  | 'done'
  | 'inProgress'
  | 'notImplemented'
  | 'needsLab'
  | 'needsCoreLevel'
  | 'needsPrereq'
  | 'slotsFull'
  | 'cannotAfford';

export type CartRejection =
  /** Carts only leave from a granary you own (docs 7). */
  | 'notGranary'
  | 'noCart'
  | 'noPorters'
  | 'noFood'
  /** Nothing there to supply: no legion of yours, no fortress of yours. */
  | 'noTarget'
  | 'passLocked'
  | 'noRoute';

/**
 * How long ground taken off another player stays in unrest (docs 6.4): yours,
 * and garrisoned normally, but nothing can be built on it until it settles.
 * v1 draft.
 */
export const UNREST_SECONDS = 300;

export type VehicleRejection =
  | 'notVehicle'
  | 'needsArsenal'
  /** The unlocking tech hasn't been researched (docs 6.5). */
  | 'needsTech'
  | 'unrest'
  | 'cannotAfford'
  | 'noPopulationRoom';

export type BombardRejection =
  | 'noGuns'
  /** Further away than anything in the stack can reach. */
  | 'outOfRange'
  /** Nothing of theirs there to shell. */
  | 'noTarget'
  /** Out of sight, so out of reach (docs 9.1). */
  | 'noVision'
  /** Guns caught in a melee shoot at what's in front of them, not at range. */
  | 'contested';

export type AssaultRejection =
  | 'noArmy'
  /** A fight is already running here, or an enemy army is standing on it. */
  | 'contested'
  /** Nothing here to attack: no militia, no enemy building, no enemy core. */
  | 'noTarget'
  /** Scouts alone can't fight — ordering it would just get them killed. */
  | 'unarmed';

export type OccupyRejection =
  /** No army of yours standing there. */
  | 'noArmy'
  /** A fight is still on, or someone else's troops are still on their feet. */
  | 'contested'
  /** A living core stands here — it has to be destroyed, not taken (docs 6.7). */
  | 'enemyCore'
  /**
   * Something of theirs is built here. Ground with a building on it isn't
   * taken, it's stormed: knock the building down and the ground comes with it
   * (docs 6.6).
   */
  | 'building'
  | 'alreadyYours';

export type BuildRejection =
  | 'notOwner'
  | 'occupied'
  | 'building'
  /** Taken off another player less than UNREST_SECONDS ago (docs 6.4). */
  | 'unrest'
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
        populationCap: DEFAULT_POPULATION_CAP,
        money: STARTING_MONEY,
        food: 0,
        aiDifficulty: setup.aiDifficulty,
        coreRegionId: setup.coreRegionId,
        coreHp: CORE_HP,
        coreLevel: 1,
        techs: [],
        research: [],
        researchers: 0,
        production: [],
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
      carts: [],
      battles: [],
      elapsedSeconds: 0,
      secondsUntilPayout: PAYOUT_INTERVAL_SECONDS,
    };
  }

  /**
   * An engine wrapped around a state that came from somewhere else — a
   * snapshot off the wire, or a saved match (docs 15.3).
   *
   * The point is that a guest needs no special interface: give it one of
   * these over the filtered state it was sent, and every derived reading the
   * panels ask for works exactly as it does at home. It is not ticked by its
   * owner; the state is replaced as snapshots arrive.
   */
  static fromState(state: GameState, mapId: string = DEFAULT_MAP_ID): GameEngine {
    const engine = new GameEngine(
      Object.values(state.players).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        coreRegionId: p.coreRegionId,
        aiDifficulty: p.aiDifficulty,
      })),
      mapId,
    );
    engine.state = state;
    return engine;
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
   * Just this player's troops standing here. garrisonAt() answers "who is on
   * this ground" and since docs 6.6 that can be two sides at once, so anything
   * asking "what can I order about" has to ask this instead.
   */
  ownGarrisonAt(regionId: string, playerId: PlayerId): UnitCounts {
    const legion = this.legionsAt(regionId).find((l) => l.playerId === playerId);
    return legion ? legion.units : {};
  }

  /**
   * This player's legion in a region, created empty if they have none there.
   * One per region per player, so reinforcements merge rather than piling up
   * as separate stacks — which keeps "the defender" a single target.
   */
  legionFor(regionId: string, playerId: PlayerId): Legion {
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

  /**
   * Seconds a hop between these two regions takes. `units` matters because a
   * column moves at its slowest member's pace (docs 6.5) — a mortar makes the
   * whole march three times longer.
   */
  marchSeconds(from: string, to: string, playerId?: PlayerId, units?: UnitCounts): number {
    const base = marchSeconds(this.map, from, to) / stackSpeed(units);
    if (!playerId) return base;
    // Rapid reaction only helps on ground you already hold, so it rewards
    // defending a front rather than pushing into one.
    const onOwnGround =
      this.state.regions[from]?.owner === playerId && this.state.regions[to]?.owner === playerId;
    return base * marchTimeMultiplier(this.ownedTechs(playerId), onOwnGround);
  }

  /**
   * Another player's army standing here — the only thing that stops a march.
   *
   * A neutral militia garrison deliberately isn't one: the 亂軍 hold their own
   * ground but don't police the roads, so columns walk past them (docs 8.1).
   * They still have to be beaten to take the region — that's `contestedAt`.
   */
  private blockingForceAt(regionId: string, playerId: PlayerId): boolean {
    if (!this.state.regions[regionId]) return false;
    return this.legionsAt(regionId).some(
      (l) => l.playerId !== playerId && totalUnits(l.units) > 0,
    );
  }

  /** Anyone here who would have to be beaten before the ground could be taken. */
  private contestedAt(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    if (!region) return false;
    return totalUnits(region.units) > 0 || this.blockingForceAt(regionId, playerId);
  }

  /**
   * Whether an army of `playerId` can walk into this region without a fight.
   *
   * Only the troops standing there decide it, not the deed: docs 6.6 says you
   * reach a region by moving there, with no need to own the route or the
   * target. So undefended enemy ground is walked onto — you're standing on it,
   * you just don't hold it until you occupy it.
   */
  private canEnter(regionId: string, playerId: PlayerId): boolean {
    if (!this.state.regions[regionId]) return false;
    if (this.fortressSeals(regionId, playerId)) return false;
    return !this.blockingForceAt(regionId, playerId);
  }

  /**
   * Is a fortress here closed against this player (docs 5.3)?
   *
   * A held pass is a wall across the road: nothing marches *through* it, so
   * the region drops out of route planning the way the central range does.
   * It is still somewhere you can march *to* — that's a siege, and knocking
   * the gate down is the only way the road ever opens.
   */
  fortressSeals(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    if (region?.building?.type !== 'fortress') return false;
    return region.owner !== null && region.owner !== playerId;
  }

  /** Whether arriving here would be a peaceful landing rather than an attack. */
  canMarchInPeace(regionId: string, playerId: PlayerId): boolean {
    return this.canEnter(regionId, playerId);
  }

  /**
   * The route a march would take, or null if there's no legal way through.
   * `units` matters at the passes: vehicles can't cross one until 橫貫工程 is
   * researched, even though infantry can with 山地公路 (docs 3.2).
   */
  marchRoute(from: string, to: string, playerId: PlayerId, units?: UnitCounts): string[] | null {
    const techs = this.ownedTechs(playerId);
    const heavy = units !== undefined && UNIT_ORDER.some((t) => isVehicle(t) && (units[t] ?? 0) > 0);
    return findPath(
      this.map,
      from,
      to,
      (id) => this.canEnter(id, playerId),
      (a, b) =>
        terrainRejection(this.map, a, b, this.hasMountainRoad(playerId)) === null &&
        (!heavy || !this.map.isPass(a, b) || vehiclesCrossPasses(techs)),
    );
  }

  /** Total seconds for a whole route, summing each hop. */
  routeSeconds(from: string, route: string[], playerId?: PlayerId, units?: UnitCounts): number {
    let total = 0;
    let at = from;
    for (const step of route) {
      total += this.marchSeconds(at, step, playerId, units);
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
    // Troops march out of wherever they stand, not out of ground you hold: an
    // army on someone else's land (docs 6.6) still has to be able to leave.
    if (!this.state.regions[from]) return 'notOwner';
    if (!stackContains(this.ownGarrisonAt(from, playerId), units)) return 'noUnits';
    if (from === to) return 'notAdjacent';
    // Standing at the gate is not the same as being through it (docs 5.3).
    // Marching in to besiege a fortress is allowed; marching on past one
    // that is still standing is exactly what it exists to prevent.
    if (this.fortressSeals(from, playerId)) return 'fortressHolds';
    if (this.marchRoute(from, to, playerId, units) !== null) return null;
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
  startMarch(
    from: string,
    to: string,
    playerId: PlayerId,
    units: UnitCounts,
    onArrival?: 'assault' | 'occupy',
  ): March | null {
    if (this.marchRejection(from, to, playerId, units) !== null) return null;
    const route = this.marchRoute(from, to, playerId, units);
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
      onArrival,
    };
    this.state.legions.push(column);
    const [next, ...rest] = route;
    const seconds = this.marchSeconds(from, next, playerId, units);
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

  // ---- supply carts (docs/game-design.md 7) ------------------------------

  private nextCartId = 1;

  /** Carts this player may have out at once, raised by the transport techs. */
  supplyCartCap(playerId: PlayerId): number {
    return supplyCartCap(this.ownedTechs(playerId));
  }

  /** Carts sitting idle at granaries, ready to be sent. */
  cartsAvailable(playerId: PlayerId): number {
    const out = this.state.carts.filter((c) => c.playerId === playerId).length;
    return Math.max(0, this.supplyCartCap(playerId) - out);
  }

  /** How much research shortens a job at this kind of site. */
  private productionSpeed(playerId: PlayerId, site: 'core' | 'academy' | 'arsenal' | null): number {
    const techs = this.ownedTechs(playerId);
    if (site === 'arsenal') return arsenalTimeMultiplier(techs);
    // 徵兵效率 is written as an academy tech, so the core's militia miss out.
    if (site === 'academy') return trainTimeMultiplier(techs);
    return 1;
  }

  private enqueue(
    playerId: PlayerId,
    job: { type: UnitType; regionId: string; seconds: number; count: number; fromType?: UnitType },
  ): void {
    this.state.players[playerId].production.push({
      type: job.type,
      regionId: job.regionId,
      remainingSeconds: job.seconds,
      totalSeconds: job.seconds,
      remaining: job.count,
      fromType: job.fromType,
    });
  }

  /** Units paid for and still in production, wherever they're being made. */
  queuedUnits(playerId: PlayerId): number {
    return (this.state.players[playerId]?.production ?? []).reduce(
      (sum, job) => sum + job.remaining,
      0,
    );
  }

  /** Porters this player has tied up on the road. They're still population. */
  porterCount(playerId: PlayerId): number {
    return this.state.carts
      .filter((c) => c.playerId === playerId)
      .reduce((sum, c) => sum + c.porters, 0);
  }

  /**
   * Whether this player has somewhere here that banks food (docs 6.3, 7): a
   * fortress on their own ground, or their own camp on anyone's ground.
   */
  supplyDepotAt(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    const building = region?.building;
    if (!building) return false;
    if (building.type === 'camp') return building.owner === playerId;
    return building.type === 'fortress' && region.owner === playerId;
  }

  /** Whether a cart sent here would have anything to do on arrival. */
  private isCartTarget(regionId: string, playerId: PlayerId): boolean {
    if (!this.state.regions[regionId]) return false;
    if (this.supplyDepotAt(regionId, playerId)) return true;
    return this.legionsAt(regionId).some((l) => l.playerId === playerId);
  }

  /** Everywhere a cart could usefully be sent from `from`. */
  cartTargets(from: string, playerId: PlayerId): string[] {
    return Object.keys(this.state.regions).filter(
      (id) =>
        id !== from &&
        this.isCartTarget(id, playerId) &&
        this.marchRoute(from, id, playerId) !== null,
    );
  }

  cartRejection(
    from: string,
    to: string,
    playerId: PlayerId,
    porters: number,
  ): CartRejection | null {
    const origin = this.state.regions[from];
    if (!origin || origin.owner !== playerId || origin.building?.type !== 'granary')
      return 'notGranary';
    if (this.cartsAvailable(playerId) < 1) return 'noCart';
    const player = this.state.players[playerId];
    if (!player) return 'noCart';
    if (porters < 1 || porters > (this.ownGarrisonAt(from, playerId).villager ?? 0))
      return 'noPorters';
    if (player.food < CART_FOOD_LOAD) return 'noFood';
    if (from === to || !this.isCartTarget(to, playerId)) return 'noTarget';
    if (this.marchRoute(from, to, playerId) === null) {
      return terrainRejection(this.map, from, to, this.hasMountainRoad(playerId)) === 'passLocked'
        ? 'passLocked'
        : 'noRoute';
    }
    return null;
  }

  /** Seconds a cart with this many porters takes for one hop. */
  cartSeconds(from: string, to: string, porters: number): number {
    // A pass is a pass: the mountain, not the manpower, sets the pace there.
    return this.map.isPass(from, to) ? MARCH_SECONDS_VIA_PASS : cartHopSeconds(porters);
  }

  /** Seconds for a whole cart route. */
  cartRouteSeconds(from: string, route: string[], porters: number): number {
    let total = 0;
    let at = from;
    for (const step of route) {
      total += this.cartSeconds(at, step, porters);
      at = step;
    }
    return total;
  }

  /**
   * Sends a loaded cart from a granary. The porters come out of the villager
   * pool — they stop earning for the whole round trip, which is what a fast
   * cart actually costs.
   */
  dispatchCart(from: string, to: string, playerId: PlayerId, porters: number): SupplyCart | null {
    if (this.cartRejection(from, to, playerId, porters) !== null) return null;
    const route = this.marchRoute(from, to, playerId);
    if (!route || route.length === 0) return null;

    const player = this.state.players[playerId]!;
    // The porters come off the ground they set out from — they're people who
    // were standing there, not a withdrawal from an abstract pool.
    const origin = this.legionFor(from, playerId);
    origin.units.villager = (origin.units.villager ?? 0) - porters;
    player.food -= CART_FOOD_LOAD;

    const [next, ...rest] = route;
    const cart: SupplyCart = {
      id: `c${this.nextCartId++}`,
      playerId,
      homeRegionId: from,
      destination: to,
      porters,
      load: CART_FOOD_LOAD,
      returning: false,
      from,
      to: next,
      route: rest,
      totalSeconds: this.cartSeconds(from, next, porters),
      remainingSeconds: this.cartSeconds(from, next, porters),
    };
    this.state.carts.push(cart);
    return cart;
  }

  /** Carts leaving from, passing into, or arriving at a region. */
  cartsInvolving(regionId: string): SupplyCart[] {
    return this.state.carts.filter((c) => c.from === regionId || c.to === regionId);
  }

  /**
   * Unloads onto whatever is here: the legion first, then the fortress store.
   * Returns the food left aboard.
   */
  private unloadCart(cart: SupplyCart): number {
    const region = this.state.regions[cart.destination];
    let load = cart.load;

    const legion = this.legionsAt(cart.destination).find((l) => l.playerId === cart.playerId);
    if (legion) {
      const { supply, spent } = refillFrom(load, legion.units, legion.supply);
      legion.supply = supply;
      load -= spent;
    }

    if (region?.building && this.supplyDepotAt(cart.destination, cart.playerId)) {
      region.building.stock = (region.building.stock ?? 0) + load;
      load = 0;
    }

    return load;
  }

  /**
   * Ends a cart's hop. A cart can't fight, so walking into ground it couldn't
   * stand on loses it: the holder takes the load (奪取) or burns it (燒毀).
   * Stealing is the default because it's strictly better for whoever did it.
   */
  private completeCartHop(cart: SupplyCart): boolean {
    if (!this.canEnter(cart.to, cart.playerId)) {
      // Whoever is actually standing in the way takes the load; a neutral
      // militia has no larder to put it in, so it's simply lost.
      const blocking = this.legionsAt(cart.to).find(
        (l) => l.playerId !== cart.playerId && totalUnits(l.units) > 0,
      );
      const taker = blocking?.playerId;
      if (taker) this.state.players[taker]!.food += cart.load;
      // The porters are lost with the cart — that's the risk of a long haul
      // through ground you don't control.
      return true;
    }

    const next = cart.route[0];
    if (next === undefined) {
      if (!cart.returning) {
        cart.load = this.unloadCart(cart);
        // Head home. If the granary is gone or in enemy hands there's no route
        // back, and the cart (with its porters) is written off.
        const back = this.marchRoute(cart.destination, cart.homeRegionId, cart.playerId);
        if (!back || back.length === 0) return true;
        cart.returning = true;
        cart.destination = cart.homeRegionId;
        cart.route = back.slice(1);
        cart.from = cart.to;
        cart.to = back[0];
        cart.totalSeconds = this.cartSeconds(cart.from, cart.to, cart.porters);
        cart.remainingSeconds += cart.totalSeconds;
        return false;
      }
      // Home: the porters are set down where the cart ends up, and go back
      // to earning from there.
      const home = this.legionFor(cart.to, cart.playerId);
      home.units.villager = (home.units.villager ?? 0) + cart.porters;
      return true;
    }

    cart.from = cart.to;
    cart.to = next;
    cart.route = cart.route.slice(1);
    cart.totalSeconds = this.cartSeconds(cart.from, cart.to, cart.porters);
    cart.remainingSeconds += cart.totalSeconds;
    return false;
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
  private engage(
    regionId: string,
    attackerId: PlayerId,
    units: UnitCounts,
    from: string,
    supply = FULL_SUPPLY,
    onArrival?: 'assault' | 'occupy',
  ): void {
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
    // The defender is whoever is standing here, which since docs 6.6 need not
    // be the landowner — an army can hold ground it hasn't occupied. No legion
    // means it's a neutral militia garrison, which belongs to nobody.
    const holder = this.legionsAt(regionId).find(
      (l) => l.playerId !== attackerId && totalUnits(l.units) > 0,
    );
    this.state.battles.push({
      regionId,
      attackerId,
      attackerUnits: { ...units },
      attackerCarry: 0,
      attackerSupply: supply,
      attackerFrom: from,
      attackerOnArrival: onArrival,
      defenderId: holder?.playerId ?? null,
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
        // A neutral garrison has neither research nor a supply line, so it
        // always fights at flat values. A fortress adds a bonus on top of the
        // tech ladders for whoever owns the one standing here (docs 11).
        attackerAttack:
          attackMultiplier(attackerTechs) *
          supplyAttackMultiplier(battle.attackerSupply) *
          this.bastionAttack(battle.regionId, battle.attackerId),
        defenderAttack:
          attackMultiplier(defenderTechs) *
          (defenderLegion ? supplyAttackMultiplier(defenderLegion.supply) : 1) *
          (battle.defenderId ? this.bastionAttack(battle.regionId, battle.defenderId) : 1),
        attackerTaken:
          damageTakenMultiplier(attackerTechs) *
          supplyDamageTakenMultiplier(battle.attackerSupply) *
          this.bastionTaken(battle.regionId, battle.attackerId),
        defenderTaken:
          damageTakenMultiplier(defenderTechs) *
          (defenderLegion ? supplyDamageTakenMultiplier(defenderLegion.supply) : 1) *
          (battle.defenderId ? this.bastionTaken(battle.regionId, battle.defenderId) : 1),
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
      // Winning clears the ground; it does not take it. Occupying is a second,
      // optional order (docs 6.6) — you may fight through and walk on.
      const victors = this.legionFor(battle.regionId, battle.attackerId);
      victors.units = battle.attackerUnits;
      // Whatever they were sent to do, they're still under those orders — an
      // order to take the ground outlives the fight it started.
      if (battle.attackerOnArrival) victors.onArrival = battle.attackerOnArrival;
      // They keep the bar they fought on. A fresh legion would default to full,
      // which would make winning a fight a free resupply.
      victors.supply = battle.attackerSupply;
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

    // A fight started where the army already stood (an assault on a militia
    // garrison, docs 6.6) has nowhere to fall back to: breaking it off just
    // means standing down where they are.
    if (battle.attackerFrom === battle.regionId) {
      const standing = this.legionFor(battle.regionId, playerId);
      standing.units = addUnits(standing.units, battle.attackerUnits);
      standing.supply = battle.attackerSupply;
      standing.onArrival = undefined;
      this.state.battles = this.state.battles.filter((b) => b !== battle);
      return true;
    }

    const seconds = this.marchSeconds(battle.regionId, battle.attackerFrom, playerId, battle.attackerUnits);
    const column: Legion = {
      id: `l${this.nextLegionId++}`,
      playerId,
      units: { ...battle.attackerUnits },
      supply: battle.attackerSupply,
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

    // A gate here is where the road ends (docs 5.3): a column that walks up
    // to a standing fortress stops in front of it, whatever it was aiming at
    // beyond. Getting through means knocking it down first.
    if (this.fortressSeals(march.to, march.playerId)) {
      march.route = [];
      march.destination = march.to;
    }

    // Walking into ground someone else holds starts a fight rather than a
    // landing. This is also how interception works: a route is planned around
    // hostile ground, so if an enemy has moved into the column's path since it
    // set out, it walks straight into them.
    if (this.blockingForceAt(march.to, march.playerId)) {
      const column = this.state.legions.find((l) => l.id === march.legionId);
      this.engage(
        march.to,
        march.playerId,
        march.units,
        march.from,
        column?.supply ?? FULL_SUPPLY,
        column?.onArrival,
      );
      this.state.legions = this.state.legions.filter((l) => l.id !== march.legionId);
      return true;
    }

    // A fight of ours already running here takes the newcomers as
    // reinforcements (docs 6.2) rather than landing them beside it.
    const fight = this.battleAt(march.to);
    if (fight && fight.attackerId === march.playerId) {
      const column = this.state.legions.find((l) => l.id === march.legionId);
      this.engage(march.to, march.playerId, march.units, march.from, column?.supply ?? FULL_SUPPLY);
      this.state.legions = this.state.legions.filter((l) => l.id !== march.legionId);
      return true;
    }

    // Walking into empty neutral land takes it — that's the capture rule from
    // docs 3.3. setRegionOwner clears the region's units, so claim first and
    // land the army after.
    if (target.owner === null && totalUnits(this.garrisonAt(march.to)) === 0) {
      this.setRegionOwner(march.to, march.playerId);
    }

    // A trench is dug to be walked into (docs 5.3). A column that steps onto
    // one doesn't march through it — this hop is where the road ends, and it
    // has to fight its way out. That's the whole building: it doesn't stop
    // anyone entering, it stops them leaving without a fight.
    const stopped = this.state.legions.find((l) => l.id === march.legionId);
    if (stopped && this.trenchAgainst(march.to, march.playerId)) {
      march.route = [];
      march.destination = march.to;
      stopped.onArrival = 'assault';
    }

    const next = march.route[0];
    if (next === undefined) {
      const column = this.state.legions.find((l) => l.id === march.legionId);
      if (column) this.landColumn(march.to, column);
      return true;
    }

    const walking = this.state.legions.find((l) => l.id === march.legionId);
    if (walking) walking.regionId = march.to;
    march.from = march.to;
    march.to = next;
    march.route = march.route.slice(1);
    march.totalSeconds = this.marchSeconds(march.from, march.to, march.playerId, march.units);
    // Carry the overshoot into the next leg so a long march doesn't gain a
    // fraction of a second at every stop.
    march.remainingSeconds += march.totalSeconds;
    return false;
  }

  /**
   * Sets a column down in a region: it merges into whatever this player
   * already has there, supply averaging by headcount so relief actually
   * relieves, and any standing order it carried survives the merge.
   */
  private landColumn(regionId: string, column: Legion): void {
    const garrison = this.legionFor(regionId, column.playerId);
    if (column === garrison) {
      column.regionId = regionId;
      return;
    }
    const had = totalUnits(garrison.units);
    const joining = totalUnits(column.units);
    if (had + joining > 0) {
      garrison.supply = (garrison.supply * had + column.supply * joining) / (had + joining);
    }
    if (column.onArrival) garrison.onArrival = column.onArrival;
    garrison.units = addUnits(garrison.units, column.units);
    this.state.legions = this.state.legions.filter((l) => l !== column);
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
   * Why `playerId` can't occupy the ground they're standing on, or null if
   * they can (docs 6.6). Winning a fight clears a region; taking it is this
   * separate order, so an army can raid through and leave the ground alone.
   */
  occupyRejection(regionId: string, playerId: PlayerId): OccupyRejection | null {
    const region = this.state.regions[regionId];
    if (!region) return 'noArmy';
    if (region.owner === playerId) return 'alreadyYours';
    // A fight of ours here counts as being present — the troops are in the
    // battle rather than standing in a legion.
    const fight = this.battleAt(regionId);
    if (fight && (fight.attackerId === playerId || fight.defenderId === playerId))
      return 'contested';
    // Otherwise "no army of ours there" comes first: anything else would be
    // telling the player what's on ground they may not even be able to see.
    const standing = this.legionsAt(regionId).find(
      (l) => l.playerId === playerId && totalUnits(l.units) > 0,
    );
    if (!standing) return 'noArmy';
    // A standing core isn't taken, it's knocked down (docs 6.7). The ground
    // under it only changes hands once the core itself is gone — which ends
    // the match anyway.
    if (region.isCore && region.owner !== null) return 'enemyCore';
    if (this.battleAt(regionId)) return 'contested';
    if (this.contestedAt(regionId, playerId)) return 'contested';
    // Someone else's building standing here has to come down first — you
    // can't walk onto ground that is still being held from inside.
    const builder = this.buildingOwner(regionId);
    if (region.building && builder !== null && builder !== playerId) return 'building';
    return null;
  }

  /** Takes the ground this player's army is standing on. */
  occupy(regionId: string, playerId: PlayerId): boolean {
    if (this.occupyRejection(regionId, playerId) !== null) return false;
    // Ground taken off another player is in unrest for a while (docs 6.4);
    // beating a neutral militia doesn't leave a population to riot.
    const takenFromPlayer = this.state.regions[regionId].owner !== null;
    this.setRegionOwner(regionId, playerId);
    if (takenFromPlayer) this.state.regions[regionId].unrestSeconds = UNREST_SECONDS;
    return true;
  }

  /** Seconds of unrest left here, or 0 if the region is settled. */
  unrestAt(regionId: string): number {
    return this.state.regions[regionId]?.unrestSeconds ?? 0;
  }

  // ---- vehicles (docs/game-design.md 6.5) --------------------------------

  /** Whether this region is still a working site for that unit. */
  private canProduceAt(regionId: string, playerId: PlayerId, type: UnitType): boolean {
    // Upgrades finish at an academy, the same place the tiers above militia
    // are trained.
    const asked = UNITS[type].trainAt === null ? 'conscript' : type;
    return this.trainingSites(playerId, asked).includes(regionId);
  }

  /** Arsenals this player owns and could build vehicles at. */
  arsenals(playerId: PlayerId): string[] {
    return Object.entries(this.state.regions)
      .filter(([, r]) => r.owner === playerId && r.building?.type === 'arsenal')
      .map(([id]) => id);
  }

  buildVehicleRejection(
    regionId: string,
    playerId: PlayerId,
    type: UnitType,
    count = 1,
  ): VehicleRejection | null {
    const def = UNITS[type];
    if (!isVehicle(type) || def.trainCost === null) return 'notVehicle';
    if (def.requiresTech && !this.hasTech(playerId, def.requiresTech)) return 'needsTech';
    if (!this.arsenals(playerId).includes(regionId)) return 'needsArsenal';
    if (this.unrestAt(regionId) > 0) return 'unrest';
    if (count < 1) return 'cannotAfford';
    if (this.state.players[playerId].money < def.trainCost * count) return 'cannotAfford';
    if (this.populationRoom(playerId) < count) return 'noPopulationRoom';
    return null;
  }

  /**
   * Queues `count` vehicles at an arsenal. Charged up front — the queue is a
   * commitment, not a reservation — and they roll out one at a time.
   */
  queueVehicles(regionId: string, playerId: PlayerId, type: UnitType, count = 1): boolean {
    if (this.buildVehicleRejection(regionId, playerId, type, count) !== null) return false;
    const def = UNITS[type];
    const player = this.state.players[playerId];
    player.money -= def.trainCost! * count;
    const seconds = def.buildSeconds * arsenalTimeMultiplier(this.ownedTechs(playerId));
    player.production.push({
      type,
      regionId,
      remainingSeconds: seconds,
      totalSeconds: seconds,
      remaining: count,
    });
    return true;
  }

  /** Cancels a queued batch, refunding what hasn't been produced yet. */
  cancelProduction(playerId: PlayerId, index: number): boolean {
    const player = this.state.players[playerId];
    const job = player.production[index];
    if (!job) return false;
    const def = UNITS[job.type];
    if (job.fromType) {
      // An upgrade pulled its recruits off the line; give them back as they were.
      player.money += (def.upgradeCost ?? 0) * job.remaining;
      this.legionFor(job.regionId, playerId).units[job.fromType] =
        (this.ownGarrisonAt(job.regionId, playerId)[job.fromType] ?? 0) + job.remaining;
    } else {
      player.money += (def.trainCost ?? 0) * job.remaining;
    }
    player.production.splice(index, 1);
    return true;
  }

  // ---- assaulting (docs/game-design.md 6.6) ------------------------------

  /** Who a building answers to: its owner if it's a camp, else the landowner. */
  buildingOwner(regionId: string): PlayerId | null {
    const region = this.state.regions[regionId];
    if (!region?.building) return null;
    return region.building.type === 'camp' ? (region.building.owner ?? null) : region.owner;
  }

  /**
   * What an army of `playerId` standing here could attack (docs 6.6):
   *
   *  - `militia` — a neutral garrison. It doesn't stop a march, so taking the
   *    ground off it is a fight you choose to start.
   *  - `core` — another player's core (docs 6.7).
   *  - `building` — anything else they built here.
   *
   * null when there's nothing to hit.
   */
  assaultTargetAt(regionId: string, playerId: PlayerId): 'militia' | 'core' | 'building' | null {
    const region = this.state.regions[regionId];
    if (!region) return null;
    if (totalUnits(region.units) > 0) return 'militia';
    if (region.isCore && region.owner !== null && region.owner !== playerId) return 'core';
    const owner = this.buildingOwner(regionId);
    return region.building && owner !== null && owner !== playerId ? 'building' : null;
  }

  assaultRejection(regionId: string, playerId: PlayerId): AssaultRejection | null {
    const standing = this.legionsAt(regionId).find(
      (l) => l.playerId === playerId && totalUnits(l.units) > 0,
    );
    if (!standing) return 'noArmy';
    if (this.battleAt(regionId)) return 'contested';
    // Someone else's army is here: that fight starts on contact, not by order.
    if (this.blockingForceAt(regionId, playerId)) return 'contested';
    if (stackAtk(standing.units) === 0) return 'unarmed';
    if (this.assaultTargetAt(regionId, playerId) === null) return 'noTarget';
    return null;
  }

  /**
   * Orders the army standing here to attack. Against a militia garrison that
   * opens a normal battle (docs 6.2); against a structure it's a standing
   * order the tick works through.
   */
  assault(regionId: string, playerId: PlayerId): boolean {
    if (this.assaultRejection(regionId, playerId) !== null) return false;
    const legion = this.legionsAt(regionId).find(
      (l) => l.playerId === playerId && totalUnits(l.units) > 0,
    )!;

    if (this.assaultTargetAt(regionId, playerId) === 'militia') {
      // Somewhere to fall back to if they break off: ground of ours next door,
      // else where they stand — retreat() copes with staying put.
      const fallback =
        this.map.region(regionId).neighbors.find((id) => this.state.regions[id]?.owner === playerId) ??
        regionId;
      // Carry any standing order into the fight: an order to take the
      // ground is what started this, and it outlives the battle.
      this.engage(regionId, playerId, legion.units, fallback, legion.supply, legion.onArrival);
      this.state.legions = this.state.legions.filter((l) => l !== legion);
      return true;
    }

    legion.assaulting = true;
    return true;
  }

  /**
   * Tells whoever is standing here to take the ground, or to attack what's on
   * it. Same machinery as an order given with a march (docs 6.6): the tick
   * works it through, so "take it" beats the garrison first if there is one.
   */
  orderHere(regionId: string, playerId: PlayerId, order: 'assault' | 'occupy'): boolean {
    const legion = this.legionsAt(regionId).find(
      (l) => l.playerId === playerId && totalUnits(l.units) > 0,
    );
    if (!legion) return false;
    legion.onArrival = order;
    return true;
  }

  /** Calls off a standing assault order. */
  standDown(regionId: string, playerId: PlayerId): boolean {
    const legion = this.legionsAt(regionId).find((l) => l.playerId === playerId);
    if (!legion?.assaulting) return false;
    legion.assaulting = false;
    return true;
  }

  /**
   * Is there a trench here belonging to somebody else (docs 5.3)?
   *
   * Public because it's a thing the player needs to be told before they order
   * a march through it, not a surprise sprung on the column when it arrives.
   */
  trenchAgainst(regionId: string, playerId: PlayerId): boolean {
    const building = this.state.regions[regionId]?.building;
    if (building?.type !== 'trench') return false;
    const owner = this.buildingOwner(regionId);
    return owner !== null && owner !== playerId;
  }

  /** Whether this player's own fortress stands here, bastion works and all. */
  private hasBastionHere(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    return (
      region?.building?.type === 'fortress' &&
      region.owner === playerId &&
      this.hasTech(playerId, 'bastionWorks')
    );
  }

  private bastionAttack(regionId: string, playerId: PlayerId): number {
    return this.hasBastionHere(regionId, playerId) ? 1 + BASTION_BONUS : 1;
  }

  private bastionTaken(regionId: string, playerId: PlayerId): number {
    return this.hasBastionHere(regionId, playerId) ? 1 - BASTION_BONUS : 1;
  }

  // ---- sight (docs/game-design.md 9) -------------------------------------

  /** Every region this player can see right now. */
  visibleTo(playerId: PlayerId): Set<string> {
    return visibleRegions(this.map, this.state, playerId, this.hasTech(playerId, 'drones'));
  }

  /** Whether a player can see a given region. */
  canSee(regionId: string, playerId: PlayerId): boolean {
    return this.visibleTo(playerId).has(regionId);
  }

  /**
   * What `viewer` is allowed to know is standing in a region: everything if
   * they can see it, nothing if they can't, and never another player's scouts
   * until 反偵察技術 is in (docs 9.2).
   */
  garrisonSeenBy(regionId: string, viewerId: PlayerId): UnitCounts {
    if (!this.canSee(regionId, viewerId)) return {};
    const counterRecon = this.hasTech(viewerId, 'counterRecon');
    const combined: UnitCounts = { ...this.state.regions[regionId]?.units };
    for (const legion of this.legionsAt(regionId)) {
      const seen = unitsVisibleTo(legion.units, legion.playerId === viewerId, counterRecon);
      for (const [type, n] of Object.entries(seen) as [UnitType, number][]) {
        if (n > 0) combined[type] = (combined[type] ?? 0) + n;
      }
    }
    return combined;
  }

  /**
   * What `viewerId` can honestly say about another player (docs 9).
   *
   * Fog covers the scoreboard as well as the map: an opponent's purse, their
   * headcount and how much ground they hold are things you'd need eyes on to
   * know. What's left is what you can actually see — the regions of theirs in
   * sight, and their core's condition if you're looking at it.
   */
  intelOn(viewerId: PlayerId, targetId: PlayerId): { regions: number; coreHp: number | null } {
    const target = this.state.players[targetId];
    if (!target) return { regions: 0, coreHp: null };
    if (viewerId === targetId) {
      return { regions: this.ownedRegionCount(targetId), coreHp: target.coreHp };
    }
    const seen = this.visibleTo(viewerId);
    return {
      regions: this.ownedRegionIds(targetId).filter((id) => seen.has(id)).length,
      coreHp: seen.has(target.coreRegionId) ? target.coreHp : null,
    };
  }

  // ---- bombardment (docs/game-design.md 6.5) -----------------------------

  /** Is there anything of another player's here to shell? */
  private bombardTargetAt(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    if (!region) return false;
    if (totalUnits(region.units) > 0) return true;
    if (this.legionsAt(regionId).some((l) => l.playerId !== playerId && totalUnits(l.units) > 0))
      return true;
    const owner = this.buildingOwner(regionId);
    return region.building !== undefined && owner !== null && owner !== playerId;
  }

  bombardRejection(from: string, to: string, playerId: PlayerId): BombardRejection | null {
    const legion = this.legionsAt(from).find(
      (l) => l.playerId === playerId && totalUnits(l.units) > 0,
    );
    if (!legion || rangedAtk(legion.units, 1) === 0) return 'noGuns';
    // Guns in a melee are busy. So is a stack with enemies on top of it.
    if (this.battleAt(from) || this.blockingForceAt(from, playerId)) return 'contested';
    const hops = this.map.distance(from, to);
    if (from === to || hops < 1 || rangedAtk(legion.units, hops) === 0) return 'outOfRange';
    if (!this.canSee(to, playerId)) return 'noVision';
    if (!this.bombardTargetAt(to, playerId)) return 'noTarget';
    return null;
  }

  /**
   * Orders the guns here to shell a region within reach. They keep firing
   * until the target is empty, someone closes on them, or they're called off.
   */
  bombard(from: string, to: string, playerId: PlayerId): boolean {
    if (this.bombardRejection(from, to, playerId) !== null) return false;
    this.legionsAt(from).find((l) => l.playerId === playerId)!.bombarding = to;
    return true;
  }

  ceaseFire(regionId: string, playerId: PlayerId): boolean {
    const legion = this.legionsAt(regionId).find((l) => l.playerId === playerId);
    if (!legion?.bombarding) return false;
    legion.bombarding = undefined;
    return true;
  }

  // ---- the core (docs/game-design.md 6.7) --------------------------------

  /** Ground that carries a player's supply line: theirs, or under their camp. */
  private isHeldGround(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    if (!region) return false;
    // Unrest doesn't break the chain — a region in unrest is still yours.
    if (region.owner === playerId) return true;
    return region.building?.type === 'camp' && region.building.owner === playerId;
  }

  /**
   * Whether `playerId` has an unbroken line of held ground from their own core
   * to somewhere adjacent to `regionId` (docs 6.7).
   *
   * Only attacking a core needs this. Ordinary regions and buildings are
   * reached by simply marching there (6.6) — the line exists so that killing a
   * core takes a front, not one column that slipped through the back.
   */
  coreAttackConnected(regionId: string, playerId: PlayerId): boolean {
    const from = this.state.players[playerId]?.coreRegionId;
    if (!from || !this.isHeldGround(from, playerId)) return false;

    const seen = new Set([from]);
    let frontier = [from];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const at of frontier) {
        for (const neighbor of this.map.region(at).neighbors) {
          if (neighbor === regionId) return true;
          if (seen.has(neighbor) || !this.isHeldGround(neighbor, playerId)) continue;
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    return false;
  }

  /**
   * The player whose core is under attack here and by whom, if a siege is
   * actually running: the attacker's army is standing on the core's region,
   * nothing hostile is left on it, and the line of held ground holds.
   */
  coreSiegeAt(regionId: string): { defenderId: PlayerId; attackerId: PlayerId } | null {
    const region = this.state.regions[regionId];
    if (!region?.isCore) return null;
    const defender = Object.values(this.state.players).find((p) => p.coreRegionId === regionId);
    if (!defender || defender.coreHp <= 0) return null;
    if (this.battleAt(regionId)) return null;

    for (const legion of this.legionsAt(regionId)) {
      if (legion.playerId === defender.id || totalUnits(legion.units) === 0) continue;
      // Standing on a core does nothing by itself — it has to be ordered
      // (docs 6.6's separate assault), and the line has to hold (6.7).
      if (!legion.assaulting) continue;
      if (this.contestedAt(regionId, legion.playerId)) continue;
      if (!this.coreAttackConnected(regionId, legion.playerId)) continue;
      return { defenderId: defender.id, attackerId: legion.playerId };
    }
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
    return this.countUnits(playerId, (units) => totalUnits(troopsOnly(units)));
  }

  /**
   * Everyone on the map under this flag, civilians included — the number the
   * population cap actually cares about.
   */
  unitCount(playerId: PlayerId): number {
    return this.countUnits(playerId, totalUnits);
  }

  /**
   * Villagers, wherever they are (docs 4.1, 4.2): walking, standing, fighting
   * for their lives, or working inside a building. They are the only thing
   * that earns, so this is the number the whole economy hangs off.
   */
  villagerCount(playerId: PlayerId): number {
    const onFoot = this.countUnits(playerId, (units) => units.villager ?? 0);
    return onFoot + this.staffCount(playerId);
  }

  /** Villagers working inside this player's buildings. */
  staffCount(playerId: PlayerId): number {
    return this.ownedRegionIds(playerId).reduce(
      (sum, id) => sum + (this.state.regions[id].building?.staff ?? 0),
      0,
    );
  }

  /**
   * Legions cover garrisons and columns on the road alike — a marching legion
   * is still a legion. Only units committed to a battle sit outside the list,
   * so they're counted separately.
   */
  private countUnits(playerId: PlayerId, measure: (units: UnitCounts) => number): number {
    const inLegions = this.state.legions
      .filter((l) => l.playerId === playerId)
      .reduce((sum, l) => sum + measure(l.units), 0);
    const fighting = this.state.battles
      .filter((b) => b.attackerId === playerId)
      .reduce((sum, b) => sum + measure(b.attackerUnits), 0);
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
    // Porters are off the villager roll while hauling, but they are still
    // people — leaving them out would let you buy replacements for free.
    // Vehicles on order count too: they're bought and coming, so the slot is
    // spoken for. Without this they'd arrive into a full population and the
    // cap sweep would quietly delete villagers to make room for them.
    return (
      this.unitCount(playerId) +
      this.staffCount(playerId) +
      researchers +
      this.porterCount(playerId) +
      this.queuedUnits(playerId)
    );
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
    if (def.trainAt === 'academy' || def.trainAt === 'arsenal') {
      const building = def.trainAt;
      return this.ownedRegionIds(playerId).filter(
        (id) => this.state.regions[id].building?.type === building,
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
    // Wrong place first: the panel hides a row that can't be produced *here*
    // at all, and "you're at the core, not an arsenal" is the reason for that
    // — not "you haven't researched it".
    if (!this.trainingSites(playerId, type).includes(regionId)) return 'wrongSite';
    if (def.requiresTech && !this.hasTech(playerId, def.requiresTech)) return 'notTrainable';
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
    this.enqueue(playerId, {
      type,
      regionId,
      seconds: def.buildSeconds * this.productionSpeed(playerId, def.trainAt),
      count: affordable,
    });
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
    if ((this.ownGarrisonAt(regionId, playerId)[def.upgradeFrom] ?? 0) < count) return 'noSourceUnits';
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
    // The recruits come off the line for the duration — docs 6.1's "升級期間
    // 那支部隊不在前線" only means something if they actually leave it.
    legion.units[def.upgradeFrom] = (legion.units[def.upgradeFrom] ?? 0) - upgradable;
    this.pruneLegions();
    this.enqueue(playerId, {
      type,
      regionId,
      seconds: def.upgradeSeconds * this.productionSpeed(playerId, 'academy'),
      count: upgradable,
      fromType: def.upgradeFrom,
    });
    return upgradable;
  }

  setRegionOwner(regionId: string, owner: PlayerId | null): void {
    const region = this.state.regions[regionId];
    if (!region) throw new Error(`Unknown region id: ${regionId}`);
    const previousOwner = region.owner;
    region.owner = owner;
    // Troops standing here don't change sides with the ground. A neutral
    // garrison had to be beaten to take the region, and a defender's army
    // is destroyed or routed rather than defecting — without this, taking
    // land handed the winner the loser's units *and* their population.
    // The attacking army arrives via the movement system instead.
    region.units = {};
    // Legions don't change sides with the ground either. The new owner's own
    // troops stay put, though — occupying ground you're standing on shouldn't
    // dissolve the army that took it. Ones out on the road are left alone;
    // they're not standing here to be captured.
    this.state.legions = this.state.legions.filter(
      (l) =>
        l.regionId !== regionId ||
        l.playerId === owner ||
        this.state.marches.some((m) => m.legionId === l.id),
    );
    // Nothing a player built survives losing the ground: taking a region razes
    // what stood on it rather than handing it over (docs 5). So conquest wins
    // you bare land — the loser's economy is destroyed, not inherited.
    if (previousOwner !== null && previousOwner !== owner) region.building = undefined;
    // A camp is its owner's wherever it stands, so it also burns when the
    // ground goes to anyone else (docs 6.3).
    if (region.building?.type === 'camp' && region.building.owner !== owner) {
      region.building = undefined;
    }
    // A change of hands interrupts any build in progress and resets the
    // wonder hold clock — you have to hold it yourself to win with it.
    region.construction = undefined;
    region.wonderHeldSeconds = undefined;
    // Unrest belongs to whoever took the ground; occupy() sets a fresh one.
    region.unrestSeconds = undefined;
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

    // A building is worth what its crew makes it worth (docs 4.2): nothing
    // standing empty, and the old flat bonus when it's fully staffed. Housing
    // is the exception — a roof houses people whether or not anyone works
    // under it — so it keeps its flat contribution.
    const shopMult = 1 + this.outputOf(playerId, 'shop');
    const farmMult = 1 + this.outputOf(playerId, 'farm');
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
        this.villagerCount(playerId) *
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

  /**
   * Recruits villagers at VILLAGER_COST each. Returns how many were bought.
   *
   * They appear at the core and stand there (docs 4.2) — in the open, worth
   * one hit point each. Getting them somewhere useful, and inside something,
   * is the player's problem.
   */
  buyVillagers(playerId: PlayerId, count: number): number {
    const affordable = Math.min(count, this.maxAffordableVillagers(playerId));
    if (affordable <= 0) return 0;
    const player = this.state.players[playerId];
    player.money -= affordable * VILLAGER_COST;
    const home = this.legionFor(player.coreRegionId, playerId);
    home.units.villager = (home.units.villager ?? 0) + affordable;
    return affordable;
  }

  // ---- villagers at work (docs/game-design.md 4.2) -----------------------

  /** Why villagers here can't move into the building, or null if they can. */
  staffRejection(
    regionId: string,
    playerId: PlayerId,
    count = 1,
  ): 'noBuilding' | 'notStaffable' | 'notYours' | 'full' | 'noVillagers' | null {
    const region = this.state.regions[regionId];
    if (!region?.building) return 'noBuilding';
    if (!STAFFABLE.includes(region.building.type)) return 'notStaffable';
    if (region.owner !== playerId) return 'notYours';
    if ((region.building.staff ?? 0) + count > MAX_STAFF) return 'full';
    if ((this.ownGarrisonAt(regionId, playerId).villager ?? 0) < count) return 'noVillagers';
    return null;
  }

  /** Moves villagers standing here into the building. Returns how many went in. */
  staffBuilding(regionId: string, playerId: PlayerId, count = 1): number {
    const region = this.state.regions[regionId];
    if (!region?.building || this.staffRejection(regionId, playerId, 1) !== null) return 0;
    const moving = Math.min(
      count,
      MAX_STAFF - (region.building.staff ?? 0),
      this.ownGarrisonAt(regionId, playerId).villager ?? 0,
    );
    if (moving <= 0) return 0;
    const legion = this.legionFor(regionId, playerId);
    legion.units.villager = (legion.units.villager ?? 0) - moving;
    region.building.staff = (region.building.staff ?? 0) + moving;
    return moving;
  }

  /** Turns villagers back out of the building, onto the ground it stands on. */
  unstaffBuilding(regionId: string, playerId: PlayerId, count = 1): number {
    const region = this.state.regions[regionId];
    if (!region?.building || region.owner !== playerId) return 0;
    const leaving = Math.min(count, region.building.staff ?? 0);
    if (leaving <= 0) return 0;
    region.building.staff = (region.building.staff ?? 0) - leaving;
    const legion = this.legionFor(regionId, playerId);
    legion.units.villager = (legion.units.villager ?? 0) + leaving;
    return leaving;
  }

  /**
   * What a building is worth right now: nothing unstaffed, and STAFF_BONUS per
   * villager inside up to a full crew (docs 4.2). A fully staffed building is
   * worth exactly what a building used to be worth flat.
   */
  buildingOutput(regionId: string): number {
    const building = this.state.regions[regionId]?.building;
    if (!building) return 0;
    return Math.min(building.staff ?? 0, MAX_STAFF) * STAFF_BONUS;
  }

  /** Summed output of every building of a type this player holds. */
  private outputOf(playerId: PlayerId, type: BuildingType): number {
    return this.ownedRegionIds(playerId)
      .filter((id) => this.state.regions[id].building?.type === type)
      .reduce((sum, id) => sum + this.buildingOutput(id), 0);
  }

  /** Why `playerId` can't start `type` here, or null if they can. */
  buildRejection(regionId: string, type: BuildingType, playerId: PlayerId): BuildRejection | null {
    const region = this.state.regions[regionId];
    const player = this.state.players[playerId];
    if (!region || !player) return 'notOwner';
    // A camp is pitched by the army standing there, on anyone's ground
    // (docs 6.3) — that's what makes it a forward depot rather than a
    // building. Everything else needs the deed to the land.
    if (type === 'camp') {
      if (!this.legionsAt(regionId).some((l) => l.playerId === playerId)) return 'notOwner';
    } else if (region.owner !== playerId) {
      return 'notOwner';
    }
    if (region.building) return 'occupied';
    if (region.construction) return 'building';
    // Freshly taken ground builds nothing, camps included (docs 6.4).
    if (this.unrestAt(regionId) > 0) return 'unrest';

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
      builtBy: playerId,
    };
    return true;
  }

  /** Cancels an in-progress build and refunds its full cost. */
  cancelConstruction(regionId: string, playerId: PlayerId): boolean {
    const region = this.state.regions[regionId];
    if (!region || !region.construction) return false;
    // A camp answers to whoever pitched it, wherever it stands (docs 6.3).
    const mine =
      region.construction.type === 'camp'
        ? region.construction.builtBy === playerId
        : region.owner === playerId;
    if (!mine) return false;
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
    if (!region || !region.building) return false;
    const mine =
      region.building.type === 'camp'
        ? region.building.owner === playerId
        : region.owner === playerId;
    if (!mine) return false;
    if (region.isCore) return false; // the core can't be removed (docs 6.7)
    region.building = undefined;
    region.wonderHeldSeconds = undefined;
    return true;
  }

  /**
   * Winner, if the match is decided. Two paths, both from docs 12:
   *  - an opponent's core is knocked down (HP zero, docs 6.7). Losing the core
   *    *region* still counts too, which is only reachable via the debug owner
   *    buttons — a standing core can't be occupied.
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
      (p) => p.coreHp > 0 && this.state.regions[p.coreRegionId]?.owner === p.id,
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
    this.state.elapsedSeconds = pinned(this.state.elapsedSeconds + deltaSeconds);
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

    if (this.state.carts.length > 0) {
      const stillRolling: SupplyCart[] = [];
      for (const cart of this.state.carts) {
        cart.remainingSeconds -= deltaSeconds;
        let done = false;
        while (!done && cart.remainingSeconds <= 0) {
          done = this.completeCartHop(cart);
        }
        if (!done) stillRolling.push(cart);
      }
      this.state.carts = stillRolling;
    }

    // Production (docs 6.1, 6.5): one unit at a time, wherever it's made —
    // the core, an academy or an arsenal. A batch keeps its clock running
    // until the last one is done.
    for (const player of Object.values(this.state.players)) {
      if (player.production.length === 0) continue;
      const stillBuilding: typeof player.production = [];
      for (const job of player.production) {
        job.remainingSeconds -= deltaSeconds;
        while (job.remaining > 0 && job.remainingSeconds <= 0) {
          // A site that's been lost or flattened stops delivering; whatever
          // hasn't come off the line is written off with it.
          if (!this.canProduceAt(job.regionId, player.id, job.type)) {
            job.remaining = 0;
            break;
          }
          const legion = this.legionFor(job.regionId, player.id);
          legion.units = addUnits(legion.units, { [job.type]: 1 });
          job.remaining -= 1;
          if (job.remaining > 0) job.remainingSeconds += job.totalSeconds;
        }
        if (job.remaining > 0) stillBuilding.push(job);
      }
      player.production = stillBuilding;
    }

    // Bombardment (docs 6.5): guns shell a region within reach without closing
    // on it and without being shot back at. Same rate as a combat round.
    for (const legion of this.state.legions) {
      const target = legion.bombarding;
      if (target === undefined) continue;
      const marching = this.state.marches.some((m) => m.legionId === legion.id);
      if (marching || this.bombardRejection(legion.regionId, target, legion.playerId) !== null) {
        legion.bombarding = undefined;
        continue;
      }

      const techs = this.ownedTechs(legion.playerId);
      const hops = this.map.distance(legion.regionId, target);
      const shells =
        rangedAtk(legion.units, hops) *
        attackMultiplier(techs) *
        supplyAttackMultiplier(legion.supply);
      const region = this.state.regions[target];
      const damage = (shells / COMBAT_ROUND_SECONDS) * deltaSeconds;

      // Troops first — shelling an occupied region hits the occupiers, not
      // the roof over their heads.
      const defenders = this.legionsAt(target).find(
        (l) => l.playerId !== legion.playerId && totalUnits(l.units) > 0,
      );
      if (defenders) {
        defenders.units = applyDamage(defenders.units, damage).units;
        this.pruneLegions();
      } else if (totalUnits(region.units) > 0) {
        region.units = applyDamage(region.units, damage).units;
      } else if (region.building) {
        region.building.hp -= damage * siegeDamageMultiplier(techs);
        if (region.building.hp <= 0) {
          region.building = undefined;
          region.wonderHeldSeconds = undefined;
        }
      }

      // Guns stop firing at rubble: check again now, rather than leaving the
      // order live until the next tick notices.
      if (!this.bombardTargetAt(target, legion.playerId)) legion.bombarding = undefined;
    }

    // Marching orders (docs 6.6): a column told to take ground carries that
    // order through the fight it starts. Run before assaults so an order given
    // this tick is acted on in the same tick it lands.
    for (const legion of this.state.legions) {
      const order = legion.onArrival;
      if (order === undefined) continue;
      if (this.state.marches.some((m) => m.legionId === legion.id)) continue;
      const region = legion.regionId;

      if (order === 'occupy' && this.occupyRejection(region, legion.playerId) === null) {
        this.occupy(region, legion.playerId);
        legion.onArrival = undefined;
        continue;
      }
      if (this.assaultRejection(region, legion.playerId) === null) {
        this.assault(region, legion.playerId);
        // An assault order is done once given; an occupy order waits for the
        // ground to be clear and tries again.
        if (order === 'assault') legion.onArrival = undefined;
        continue;
      }
      // Nothing to fight and nothing to take — the order has lapsed. A fight
      // already in progress here is the exception: wait for it to finish.
      if (!this.battleAt(region) && this.occupyRejection(region, legion.playerId) !== 'contested') {
        legion.onArrival = undefined;
      }
    }

    // Assaults (docs 6.6, 6.7). An army under orders batters what's built here
    // at the rate a combat round would deal, spread smoothly over time so no
    // second round clock is needed. Everything that could have changed since
    // the order was given is re-checked, and a stale order just lapses.
    for (const legion of this.state.legions) {
      if (!legion.assaulting) continue;
      const regionId = legion.regionId;
      const region = this.state.regions[regionId];
      const marching = this.state.marches.some((m) => m.legionId === legion.id);
      const target = marching ? null : this.assaultTargetAt(regionId, legion.playerId);
      if (
        target === null ||
        target === 'militia' ||
        totalUnits(legion.units) === 0 ||
        this.blockingForceAt(regionId, legion.playerId) ||
        this.battleAt(regionId)
      ) {
        legion.assaulting = false;
        continue;
      }

      const techs = this.ownedTechs(legion.playerId);
      // Siege munitions only help against what's built, not against people.
      const siege = target === 'building' ? siegeDamageMultiplier(techs) : 1;
      // And what the stack is worth is measured differently against a wall
      // than against a man — militia bring half their attack (docs 6.6).
      const damage =
        ((siegeAtk(legion.units) *
          attackMultiplier(techs) *
          supplyAttackMultiplier(legion.supply) *
          siege) /
          COMBAT_ROUND_SECONDS) *
        deltaSeconds;

      if (target === 'core') {
        // The core also wants a line of held ground behind the attacker (6.7).
        if (!this.coreSiegeAt(regionId)) continue;
        const defender = Object.values(this.state.players).find(
          (p) => p.coreRegionId === regionId,
        )!;
        defender.coreHp = Math.max(0, defender.coreHp - damage);
        continue;
      }

      const building = region.building!;
      building.hp -= damage;
      if (building.hp <= 0) {
        // Down with everything in it — a depot's stores go with the depot,
        // and the crew goes with the building (docs 4.2).
        region.building = undefined;
        region.wonderHeldSeconds = undefined;
        legion.assaulting = false;
        // Knocking the building down is what takes the ground (docs 6.6):
        // there is nothing left to hold it with.
        if (region.owner !== legion.playerId) {
          const takenFromPlayer = region.owner !== null;
          this.setRegionOwner(regionId, legion.playerId);
          if (takenFromPlayer) region.unrestSeconds = UNREST_SECONDS;
        }
      }
    }

    // A crew patches its building back up while it's being knocked down
    // (docs 4.2). Slow enough that an army still takes the place, fast enough
    // that a raiding party can't nibble a staffed building to death.
    for (const region of Object.values(this.state.regions)) {
      const building = region.building;
      const staff = building?.staff ?? 0;
      if (!building || staff <= 0 || region.owner === null) continue;
      const full = buildingHp(building.type, this.ownedTechs(region.owner));
      if (building.hp >= full) continue;
      building.hp = Math.min(full, building.hp + staff * STAFF_REPAIR_PER_SECOND * deltaSeconds);
    }

    // A depot hands out what it's holding to its owner's troops standing on it
    // (docs 6.3, 7). A camp's owner is on the building; a fortress belongs to
    // whoever holds the ground.
    for (const [regionId, region] of Object.entries(this.state.regions)) {
      const building = region.building;
      const stock = building?.stock ?? 0;
      if (!building || stock <= 0) continue;
      const depotOwner = building.type === 'camp' ? building.owner : region.owner;
      if (!depotOwner || !this.supplyDepotAt(regionId, depotOwner)) continue;
      const legion = this.legionsAt(regionId).find((l) => l.playerId === depotOwner);
      if (!legion) continue;
      const { supply, spent } = refillFrom(stock, legion.units, legion.supply);
      legion.supply = supply;
      building.stock = stock - spent;
    }

    // Supply (docs 7). Troops in the field burn through it, own land holds it,
    // and only a granary or farm puts it back. The zones are computed once per
    // player rather than once per legion.
    if (this.state.legions.length > 0 || this.state.battles.length > 0) {
      const zones = new Map<PlayerId, LogisticsZones>();
      const footing = (playerId: PlayerId, regionId: string) => {
        let zone = zones.get(playerId);
        if (!zone) {
          zone = logisticsZones(this.map, this.state.regions, playerId);
          zones.set(playerId, zone);
        }
        return footingAt(zone, regionId);
      };

      for (const legion of this.state.legions) {
        legion.supply = nextSupply(legion.supply, minutes, footing(legion.playerId, legion.regionId));
      }
      // Troops committed to an attack are standing on ground they don't hold,
      // so they drain like anyone else in the field.
      for (const battle of this.state.battles) {
        battle.attackerSupply = nextSupply(
          battle.attackerSupply,
          minutes,
          footing(battle.attackerId, battle.regionId),
        );
      }
    }

    for (const region of Object.values(this.state.regions)) {
      if (region.construction) {
        region.construction.remainingSeconds -= deltaSeconds;
        if (region.construction.remainingSeconds <= 0) {
          const { type, builtBy } = region.construction;
          region.construction = undefined;
          region.building = { type, hp: buildingHp(type, this.ownedTechs(builtBy ?? region.owner ?? '')) };
          // A camp belongs to the army that pitched it, not to the ground.
          if (type === 'camp') region.building.owner = builtBy;
          if (type === 'wonder') region.wonderHeldSeconds = 0;
        }
      }
      if (region.building?.type === 'wonder' && region.owner) {
        region.wonderHeldSeconds = (region.wonderHeldSeconds ?? 0) + deltaSeconds;
      }
      // Unrest runs down (docs 6.4); at zero the region is a normal holding.
      if (region.unrestSeconds !== undefined) {
        region.unrestSeconds -= deltaSeconds;
        if (region.unrestSeconds <= 0) region.unrestSeconds = undefined;
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
      // A lowered cap sheds villagers standing in the open at the core —
      // they're the uncommitted population. People at work stay at work.
      const over = Math.floor(this.population(player.id)) - player.populationCap;
      if (over > 0) {
        const home = this.legionFor(player.coreRegionId, player.id);
        home.units.villager = Math.max(0, (home.units.villager ?? 0) - over);
      }
      // Food still accrues continuously; only gold is batched.
      player.food = Math.min(eco.foodCap, player.food + eco.foodPerMin * minutes);
    }

    // Gold payout. The loop covers a delta larger than one interval, which
    // real ticks never produce but tests and long stalls can.
    this.state.secondsUntilPayout = pinned(this.state.secondsUntilPayout - deltaSeconds);
    while (this.state.secondsUntilPayout <= 0) {
      this.state.secondsUntilPayout += PAYOUT_INTERVAL_SECONDS;
      for (const player of Object.values(this.state.players)) {
        // moneyPerMin is exactly one instalment, since the interval is a minute.
        player.money += this.economy(player.id).moneyPerMin;
      }
    }
  }
}
