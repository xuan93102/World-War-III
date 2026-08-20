import type { BuildingType } from './buildings';
import type { GameEngine } from './GameEngine';
import type { TechId } from './tech';
import type { PlayerId } from './types';
import type { UnitCounts, UnitType } from './units';

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
