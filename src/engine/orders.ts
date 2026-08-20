import { BUILDINGS, type BuildingType } from './buildings';
import type { GameEngine } from './GameEngine';
import { TECHS, type TechId } from './tech';
import type { PlayerId } from './types';
import { UNITS, type UnitCounts, type UnitType } from './units';

/**
 * Everything a player can tell the game to do, as data (docs 15.2).
 *
 * These are the same twenty actions the region panel has always issued; the
 * only change is that they're now values rather than method calls. That
 * matters for three things at once: an order can be sent over a wire, an
 * order can be written to a log and replayed, and there is exactly one place
 * in the code where "a player did something" happens.
 *
 * Note what is *not* in here: who gave the order. A remote client says what
 * it wants done, never on whose behalf — the host supplies the player id from
 * the connection the order arrived on. An order that carried its own player
 * id would be an invitation to spend someone else's gold.
 */
export type Order =
  | { type: 'buyVillagers'; count: number }
  | { type: 'build'; regionId: string; building: BuildingType }
  | { type: 'cancelBuild'; regionId: string }
  | { type: 'demolish'; regionId: string }
  | { type: 'train'; regionId: string; unit: UnitType; count: number }
  | { type: 'upgrade'; regionId: string; unit: UnitType; count: number }
  | { type: 'queueVehicles'; regionId: string; unit: UnitType; count: number }
  | { type: 'cancelProduction'; index: number }
  | { type: 'march'; from: string; to: string; units: UnitCounts; onArrival?: 'assault' | 'occupy' }
  | { type: 'orderHere'; regionId: string; order: 'assault' | 'occupy' }
  | { type: 'standDown'; regionId: string }
  | { type: 'retreat'; regionId: string }
  | { type: 'bombard'; from: string; to: string }
  | { type: 'ceaseFire'; regionId: string }
  | { type: 'dispatchCart'; from: string; to: string; porters: number }
  | { type: 'staff'; regionId: string; count: number }
  | { type: 'unstaff'; regionId: string; count: number }
  | { type: 'research'; techId: TechId }
  | { type: 'upgradeCore' }
  | { type: 'trainResearcher' };

/**
 * Carries out one order on behalf of one player.
 *
 * Every branch is a single engine call, and every one of those already
 * decides for itself whether the order is legal — an order that can't be
 * carried out simply isn't, which is what makes this safe to point at
 * anything, including a stranger's browser.
 */
export function applyOrder(engine: GameEngine, playerId: PlayerId, order: Order): void {
  switch (order.type) {
    case 'buyVillagers':
      engine.buyVillagers(playerId, order.count);
      return;
    case 'build':
      engine.startConstruction(order.regionId, order.building, playerId);
      return;
    case 'cancelBuild':
      engine.cancelConstruction(order.regionId, playerId);
      return;
    case 'demolish':
      engine.demolish(order.regionId, playerId);
      return;
    case 'train':
      engine.trainUnits(order.regionId, playerId, order.unit, order.count);
      return;
    case 'upgrade':
      engine.upgradeUnits(order.regionId, playerId, order.unit, order.count);
      return;
    case 'queueVehicles':
      engine.queueVehicles(order.regionId, playerId, order.unit, order.count);
      return;
    case 'cancelProduction':
      engine.cancelProduction(playerId, order.index);
      return;
    case 'march':
      engine.startMarch(order.from, order.to, playerId, order.units, order.onArrival);
      return;
    case 'orderHere':
      engine.orderHere(order.regionId, playerId, order.order);
      return;
    case 'standDown':
      engine.standDown(order.regionId, playerId);
      return;
    case 'retreat':
      engine.retreat(order.regionId, playerId);
      return;
    case 'bombard':
      engine.bombard(order.from, order.to, playerId);
      return;
    case 'ceaseFire':
      engine.ceaseFire(order.regionId, playerId);
      return;
    case 'dispatchCart':
      engine.dispatchCart(order.from, order.to, playerId, order.porters);
      return;
    case 'staff':
      engine.staffBuilding(order.regionId, playerId, order.count);
      return;
    case 'unstaff':
      engine.unstaffBuilding(order.regionId, playerId, order.count);
      return;
    case 'research':
      engine.startResearch(playerId, order.techId);
      return;
    case 'upgradeCore':
      engine.startCoreUpgrade(playerId);
      return;
    case 'trainResearcher':
      engine.trainResearcher(playerId);
      return;
  }
  // Every order type is handled above; this is here so adding one to the
  // union without handling it fails to compile rather than failing quietly.
  const unhandled: never = order;
  throw new Error(`Unhandled order: ${JSON.stringify(unhandled)}`);
}

// ---- reading an order off the wire -----------------------------------------

/**
 * Turns something a stranger sent into an Order, or into nothing.
 *
 * Everything past this point is trusted to be *shaped* right, and nothing
 * past this point is trusted to be *legal* — that stays with the engine's own
 * rejections. The split matters because the two failures are different: an
 * illegal order is a player trying something that won't work, and a malformed
 * one is not a player at all.
 *
 * What actually makes this necessary, rather than merely tidy: the engine
 * looks units, buildings and techs up in tables by name, so an order naming a
 * tech that doesn't exist throws rather than being refused. A host that
 * applied unparsed orders could be stopped dead by one bad message. Nonsense
 * *numbers* are already safe — negative counts, absurd counts and negative
 * unit stacks are all refused by the engine — but they're checked here too,
 * because a validator that only guards the crash is one edit away from
 * guarding nothing.
 */
export function parseOrder(value: unknown): Order | null {
  if (!isRecord(value)) return null;

  switch (value.type) {
    case 'buyVillagers': {
      const n = asCount(value.count);
      return n === null ? null : { type: 'buyVillagers', count: n };
    }
    case 'build': {
      const regionId = asId(value.regionId);
      const building = asKeyOf(BUILDINGS, value.building);
      return regionId && building ? { type: 'build', regionId, building } : null;
    }
    case 'cancelBuild':
    case 'demolish':
    case 'standDown':
    case 'retreat':
    case 'ceaseFire': {
      const regionId = asId(value.regionId);
      return regionId ? { type: value.type, regionId } : null;
    }
    case 'train':
    case 'upgrade':
    case 'queueVehicles': {
      const regionId = asId(value.regionId);
      const unit = asKeyOf(UNITS, value.unit);
      const n = asCount(value.count);
      return regionId && unit && n !== null ? { type: value.type, regionId, unit, count: n } : null;
    }
    case 'cancelProduction': {
      const index = asCount(value.index);
      return index === null ? null : { type: 'cancelProduction', index };
    }
    case 'march': {
      const from = asId(value.from);
      const to = asId(value.to);
      const units = asUnits(value.units);
      const onArrival = value.onArrival;
      if (!from || !to || !units) return null;
      if (onArrival !== undefined && onArrival !== 'assault' && onArrival !== 'occupy') return null;
      return { type: 'march', from, to, units, onArrival };
    }
    case 'orderHere': {
      const regionId = asId(value.regionId);
      const order = value.order;
      if (!regionId || (order !== 'assault' && order !== 'occupy')) return null;
      return { type: 'orderHere', regionId, order };
    }
    case 'bombard': {
      const from = asId(value.from);
      const to = asId(value.to);
      return from && to ? { type: 'bombard', from, to } : null;
    }
    case 'dispatchCart': {
      const from = asId(value.from);
      const to = asId(value.to);
      const porters = asCount(value.porters);
      return from && to && porters !== null ? { type: 'dispatchCart', from, to, porters } : null;
    }
    case 'staff':
    case 'unstaff': {
      const regionId = asId(value.regionId);
      const n = asCount(value.count);
      return regionId && n !== null ? { type: value.type, regionId, count: n } : null;
    }
    case 'research': {
      const techId = asKeyOf(TECHS, value.techId);
      return techId ? { type: 'research', techId } : null;
    }
    case 'upgradeCore':
      return { type: 'upgradeCore' };
    case 'trainResearcher':
      return { type: 'trainResearcher' };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A region id is only ever a short string here; the engine checks it exists. */
function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
}

/** Counts are whole and never negative. The engine clamps them from there. */
function asCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

/** A name that must be in one of the game's tables, or the engine will throw. */
function asKeyOf<T extends object>(table: T, value: unknown): keyof T | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value)
    ? (value as keyof T)
    : null;
}

function asUnits(value: unknown): UnitCounts | null {
  if (!isRecord(value)) return null;
  const units: UnitCounts = {};
  for (const [type, n] of Object.entries(value)) {
    const unit = asKeyOf(UNITS, type);
    const count = asCount(n);
    if (!unit || count === null) return null;
    if (count > 0) units[unit] = count;
  }
  return units;
}
