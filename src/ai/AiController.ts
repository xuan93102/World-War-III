import type { BuildingType } from '../engine/buildings';
import type { GameEngine } from '../engine/GameEngine';
import type { TechId } from '../engine/tech';
import type { AiDifficulty, PlayerId } from '../engine/types';
import { UNIT_ORDER, totalUnits, type UnitCounts } from '../engine/units';

/** The cheapest `count` units out of a stack — chaff marches, elites hold. */
function take(units: UnitCounts, count: number): UnitCounts {
  const out: UnitCounts = {};
  let left = count;
  for (const type of UNIT_ORDER) {
    if (left <= 0) break;
    const have = units[type] ?? 0;
    if (have <= 0) continue;
    const taking = Math.min(have, left);
    out[type] = taking;
    left -= taking;
  }
  return out;
}

/**
 * A local AI seat (docs/game-design.md 13).
 *
 * It sits outside the engine and talks to it through the same orders a human
 * has — train, build, march, assault, occupy. There is no privileged path: if
 * the AI can do something, so can you, and vice versa. That's what keeps the
 * engine the single source of the rules, and what will let a remote AI or a
 * network peer take this seat later without the engine noticing.
 *
 * It thinks on a clock rather than every tick (docs 2). The plan it makes is
 * deliberately shallow — spend, build, expand, then push — because a deeper
 * one is worth nothing until the numbers underneath it have been playtested.
 */

/** How often each difficulty stops to think, in seconds. */
const DECISION_INTERVAL: Record<AiDifficulty, number> = {
  easy: 6,
  normal: 3,
  hard: 2,
};

interface Doctrine {
  /** Gold kept back from the villager loop for troops and buildings. */
  reserve: number;
  /**
   * Villagers to get earning before anything is held back at all. The match
   * opens with ten gold; keeping a reserve out of that buys nothing and earns
   * nothing, and the AI never gets off the ground (docs 4.1).
   */
  economyFirst: number;
  /** Troops it wants at home before sending anything out. */
  homeGuard: number;
  /** Troops a column needs before it goes looking for neutral ground. */
  expeditionSize: number;
  /** Troops it wants massed before it attacks a player. */
  offensiveSize: number;
  /** Whether it attacks players at all. */
  attacks: boolean;
  /**
   * Share of the population ceiling reserved for troops. Villagers would
   * otherwise take every slot — they're strictly better value right up until
   * someone walks in and takes the ground they stand on.
   */
  armyShare: number;
}

const DOCTRINE: Record<AiDifficulty, Doctrine> = {
  // Expands slowly and never comes for you (docs 3.2's "不主動進攻").
  easy: {
    reserve: 20,
    economyFirst: 20,
    homeGuard: 5,
    expeditionSize: 8,
    offensiveSize: Infinity,
    attacks: false,
    armyShare: 0.15,
  },
  normal: {
    reserve: 40,
    economyFirst: 30,
    homeGuard: 10,
    expeditionSize: 12,
    offensiveSize: 40,
    attacks: true,
    armyShare: 0.25,
  },
  hard: {
    reserve: 60,
    economyFirst: 40,
    homeGuard: 12,
    expeditionSize: 15,
    offensiveSize: 30,
    attacks: true,
    armyShare: 0.35,
  },
};

export class AiController {
  private sinceDecision = 0;
  readonly playerId: PlayerId;
  readonly difficulty: AiDifficulty;

  constructor(playerId: PlayerId, difficulty: AiDifficulty) {
    this.playerId = playerId;
    this.difficulty = difficulty;
  }

  /**
   * Advances the AI's own clock and lets it act when its interval comes round.
   * Safe to call every tick; it decides how often it actually thinks.
   */
  update(engine: GameEngine, deltaSeconds: number): void {
    this.sinceDecision += deltaSeconds;
    const interval = DECISION_INTERVAL[this.difficulty];
    if (this.sinceDecision < interval) return;
    this.sinceDecision = 0;
    this.decide(engine);
  }

  /** One round of thinking. Public so tests can step it without a clock. */
  decide(engine: GameEngine): void {
    const me = engine.state.players[this.playerId];
    if (!me || me.coreHp <= 0) return;
    const doctrine = DOCTRINE[this.difficulty];

    this.finishBusiness(engine);
    this.spend(engine, doctrine);
    this.build(engine);
    this.study(engine);
    this.raiseTroops(engine, doctrine);
    this.moveArmies(engine, doctrine);
  }

  // ---- standing orders ---------------------------------------------------

  /**
   * Anything already in front of an army: clear the ground it's standing on,
   * and take what it has cleared. Done first so a column that arrived last
   * cycle acts before a new one is sent anywhere.
   */
  private finishBusiness(engine: GameEngine): void {
    for (const legion of this.myLegions(engine)) {
      const region = legion.regionId;
      if (engine.occupyRejection(region, this.playerId) === null) {
        engine.occupy(region, this.playerId);
        continue;
      }
      // Militia in the way, or something of theirs still standing here.
      if (engine.assaultRejection(region, this.playerId) === null) {
        engine.assault(region, this.playerId);
      }
    }
  }

  // ---- economy -----------------------------------------------------------

  /** Villagers are the whole economy (docs 4.1), so spare gold becomes them. */
  private spend(engine: GameEngine, doctrine: Doctrine): void {
    const me = engine.state.players[this.playerId];
    // Nothing is held back until the loop is turning — the opening ten gold
    // has to become ten villagers or there is no second minute.
    const reserve = me.villagers >= doctrine.economyFirst ? doctrine.reserve : 0;
    const spare = me.money - reserve;
    if (spare <= 0) return;

    // Leave the army its share of the ceiling. Without this the villager loop
    // eats every slot and the AI ends up rich, capped and defenceless.
    const room = engine.populationRoom(this.playerId) - this.armyRoom(engine, doctrine);
    if (room <= 0) return;
    engine.buyVillagers(this.playerId, Math.min(Math.floor(spare), room));
  }

  /**
   * One building per cycle, on the emptiest useful ground. Shops and farms
   * first because they compound; housing raises the ceiling those run into.
   */
  private build(engine: GameEngine): void {
    // A wish list rather than a priority order: without the counts it would
    // put a farm on every field it owns before it ever built a second kind of
    // thing. The lab earns its early place — the homestead line is the only
    // way past the population ceiling.
    const wanted: { type: BuildingType; upTo: number }[] = [
      { type: 'farm', upTo: 1 },
      { type: 'shop', upTo: 2 },
      { type: 'housing', upTo: 3 },
      { type: 'research', upTo: 1 },
      { type: 'academy', upTo: 1 },
      { type: 'school', upTo: 1 },
      { type: 'shop', upTo: 4 },
      { type: 'granary', upTo: 1 },
      { type: 'farm', upTo: 3 },
    ];
    const sites = engine
      .ownedRegionIds(this.playerId)
      .filter((id) => !engine.state.regions[id].building && !engine.state.regions[id].construction);
    if (sites.length === 0) return;

    const counts = engine.buildingCounts(this.playerId);
    const building = (type: BuildingType) =>
      (counts[type] ?? 0) +
      engine
        .ownedRegionIds(this.playerId)
        .filter((id) => engine.state.regions[id].construction?.type === type).length;

    for (const { type, upTo } of wanted) {
      if (building(type) >= upTo) continue;
      for (const site of sites) {
        if (engine.buildRejection(site, type, this.playerId) === null) {
          engine.startConstruction(site, type, this.playerId);
          return;
        }
      }
    }
  }

  /**
   * Turns a surplus into research (docs 10, 11).
   *
   * The order is the order the constraints bite in: the population ceiling
   * caps income *and* army size at once, so it comes first; multipliers next;
   * then the things that win fights. Without this the AI hits the cap around
   * 200 population and sits on a growing pile of gold with nothing to do.
   */
  private study(engine: GameEngine): void {
    const wanted: TechId[] = [
      'homesteadAct',
      'townExpansion',
      'urbanisation',
      'tradeLaw',
      'intensiveFarming',
      'financialCentre',
      'consumerIndustry',
      'rifles',
      'bodyArmour',
      'autoRifles',
      'compositeArmour',
      'roadNetwork',
    ];

    for (const tech of wanted) {
      if (engine.researchRejection(this.playerId, tech) === null) {
        engine.startResearch(this.playerId, tech);
        return;
      }
    }

    // Nothing researchable at this core level: raise it, which opens the next
    // tier (and is itself a use for a surplus).
    if (engine.coreUpgradeRejection(this.playerId) === null) {
      engine.startCoreUpgrade(this.playerId);
      return;
    }

    // Researchers shorten everything that comes after.
    if (engine.researcherRejection(this.playerId) === null) {
      engine.trainResearcher(this.playerId);
    }
  }

  /** How many population slots are still owed to the army. */
  private armyRoom(engine: GameEngine, doctrine: Doctrine): number {
    const target = Math.floor(engine.economy(this.playerId).populationCap * doctrine.armyShare);
    return Math.max(0, target - engine.troopCount(this.playerId));
  }

  /** Keeps troops coming while there's room and gold for them. */
  private raiseTroops(engine: GameEngine, doctrine: Doctrine): void {
    const me = engine.state.players[this.playerId];
    if (engine.populationRoom(this.playerId) <= 0) return;
    if (this.armyRoom(engine, doctrine) <= 0) return;
    // Never spend the last of the purse on soldiers: the villager loop is what
    // pays for the next ones.
    if (me.money < doctrine.reserve / 2) return;

    // An academy is worth using if there is one; militia otherwise.
    for (const type of ['conscript', 'militia'] as const) {
      const sites = engine.trainingSites(this.playerId, type);
      for (const site of sites) {
        if (engine.trainRejection(site, this.playerId, type, 1) === null) {
          engine.trainUnits(site, this.playerId, type, 1);
          return;
        }
      }
    }
  }

  // ---- armies ------------------------------------------------------------

  private myLegions(engine: GameEngine) {
    const marching = new Set(engine.state.marches.map((m) => m.legionId));
    return engine.state.legions.filter(
      (l) => l.playerId === this.playerId && !marching.has(l.id) && totalUnits(l.units) > 0,
    );
  }

  /**
   * Sends whatever is spare. Expansion comes first — neutral ground is cheaper
   * than a war — and only what's left over goes at the enemy.
   */
  private moveArmies(engine: GameEngine, doctrine: Doctrine): void {
    const me = engine.state.players[this.playerId];
    const home = me.coreRegionId;
    const legions = this.myLegions(engine);
    // Once the population is capped the army can't grow, so waiting for a
    // bigger one is waiting forever. Whatever is fielded *is* the offensive.
    const capped = engine.populationRoom(this.playerId) <= 0;
    const biggest = legions.reduce(
      (best, l) => (totalUnits(l.units) > totalUnits(best?.units ?? {}) ? l : best),
      legions[0],
    );

    for (const legion of legions) {
      const strength = totalUnits(legion.units);
      // The core keeps a garrison back; everywhere else, anything idle moves.
      const spare = legion.regionId === home ? strength - doctrine.homeGuard : strength;
      if (spare <= 0) continue;

      // Sitting on ground that's still contested? finishBusiness has it.
      if (engine.assaultRejection(legion.regionId, this.playerId) === null) continue;

      const expedition = capped ? Math.min(doctrine.expeditionSize, spare) : doctrine.expeditionSize;
      const offensive = capped ? Math.min(doctrine.offensiveSize, spare) : doctrine.offensiveSize;

      const neutral = spare >= expedition ? this.nearestNeutral(engine, legion.regionId) : null;
      const enemy =
        doctrine.attacks && spare >= offensive
          ? this.nearestEnemy(engine, legion.regionId)
          : null;
      // A column big enough to fight takes whichever is nearer; a small one
      // only ever goes for free ground. Without the comparison the AI would
      // never attack while a single neutral region was left on the map.
      let target: string | null =
        neutral && enemy
          ? engine.map.distance(legion.regionId, enemy) <=
            engine.map.distance(legion.regionId, neutral)
            ? enemy
            : neutral
          : (enemy ?? neutral);

      // Too small to do anything on its own: go and join the main body rather
      // than stand around. Scattered thirds never add up to a push.
      if (!target && biggest && biggest !== legion && legion.regionId !== home) {
        target = biggest.regionId;
      }
      if (!target || target === legion.regionId) continue;

      engine.startMarch(legion.regionId, target, this.playerId, take(legion.units, spare));
    }
  }

  /** The closest unclaimed region it could actually reach. */
  private nearestNeutral(engine: GameEngine, from: string): string | null {
    return this.nearest(engine, from, (id) => engine.state.regions[id].owner === null);
  }

  /** The closest region held by someone else — their core included. */
  private nearestEnemy(engine: GameEngine, from: string): string | null {
    return this.nearest(engine, from, (id) => {
      const owner = engine.state.regions[id].owner;
      return owner !== null && owner !== this.playerId && engine.canSee(id, this.playerId);
    });
  }

  private nearest(engine: GameEngine, from: string, want: (id: string) => boolean): string | null {
    let best: string | null = null;
    let bestDistance = Infinity;
    // Ordered by id so two runs of the same position make the same choice —
    // an AI that flip-flops between equidistant targets never arrives.
    for (const region of engine.map.regions) {
      if (!want(region.id)) continue;
      const distance = engine.map.distance(from, region.id);
      if (distance >= bestDistance || distance < 1) continue;
      if (engine.marchRoute(from, region.id, this.playerId) === null) continue;
      best = region.id;
      bestDistance = distance;
    }
    return best;
  }
}
