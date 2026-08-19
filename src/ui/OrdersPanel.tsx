import { useState } from 'react';
import { UNITS, UNIT_ORDER, totalUnits, type UnitCounts, type UnitType } from '../engine/units';
import { useSettings } from '../settings/useSettings';
import type { GameEngine } from '../engine/GameEngine';

interface OrdersPanelProps {
  engine: GameEngine;
  /** The region being ordered *about* — orders belong to the target. */
  regionId: string;
  playerId: string;
  onOrder: (
    from: string,
    to: string,
    units: UnitCounts,
    onArrival?: 'assault' | 'occupy',
  ) => void;
  onOccupyHere: (regionId: string) => void;
  onAssaultHere: (regionId: string) => void;
}

/** How many sources to offer before the list stops being a list. */
const SOURCE_LIMIT = 6;

/**
 * Orders for the region you're looking at (docs 6.6).
 *
 * You pick the place, then say what should happen to it — march here, take it,
 * or attack what's standing on it. Which of your armies carries it out is a
 * detail underneath that, not the first question you have to answer, so the
 * source list is sorted by who could arrive soonest.
 */
export function OrdersPanel({
  engine,
  regionId,
  playerId,
  onOrder,
  onOccupyHere,
  onAssaultHere,
}: OrdersPanelProps) {
  const { t } = useSettings();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [counts, setCounts] = useState<UnitCounts>({});

  const here = engine.ownGarrisonAt(regionId, playerId);
  const troopsHere = totalUnits(here) > 0;

  // Everywhere of ours with troops that could reach this place, nearest first.
  const sources = engine
    .ownedRegionIds(playerId)
    .concat(
      engine.state.legions
        .filter((l) => l.playerId === playerId && totalUnits(l.units) > 0)
        .map((l) => l.regionId),
    )
    .filter((id, index, all) => all.indexOf(id) === index && id !== regionId)
    .filter((id) => totalUnits(engine.ownGarrisonAt(id, playerId)) > 0)
    .map((id) => ({ id, route: engine.marchRoute(id, regionId, playerId) }))
    .filter((s): s is { id: string; route: string[] } => s.route !== null)
    .map((s) => ({ ...s, seconds: engine.routeSeconds(s.id, s.route, playerId) }))
    .sort((a, b) => a.seconds - b.seconds || a.id.localeCompare(b.id))
    .slice(0, SOURCE_LIMIT);

  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const available = source ? engine.ownGarrisonAt(source.id, playerId) : {};
  const chosen = totalUnits(counts);

  // What may be done to this place, whether or not troops are here yet.
  const isMine = engine.state.regions[regionId].owner === playerId;
  const buildingOwner = engine.buildingOwner(regionId);
  const canOccupy =
    !isMine &&
    !(engine.state.regions[regionId].isCore && engine.state.regions[regionId].owner !== null) &&
    engine.coreAttackConnected(regionId, playerId);
  const canAssault =
    !isMine &&
    // Under fog you don't know what's built there, so the button can't say.
    engine.canSee(regionId, playerId) &&
    engine.state.regions[regionId].owner !== null &&
    (engine.state.regions[regionId].isCore ||
      (engine.state.regions[regionId].building !== undefined && buildingOwner !== playerId));

  // Nothing of ours anywhere on the map: there's no order to give.
  if (engine.troopCount(playerId) === 0) return null;

  const setCount = (type: UnitType, next: number) => {
    const capped = Math.max(0, Math.min(available[type] ?? 0, next));
    setCounts((prev) => {
      const out = { ...prev };
      if (capped > 0) out[type] = capped;
      else delete out[type];
      return out;
    });
  };

  /** Sends the chosen column, or gives the order to whoever is already here. */
  const order = (onArrival?: 'assault' | 'occupy') => {
    if (troopsHere && chosen === 0) {
      if (onArrival === 'occupy') onOccupyHere(regionId);
      else if (onArrival === 'assault') onAssaultHere(regionId);
      return;
    }
    if (!source || chosen === 0) return;
    onOrder(source.id, regionId, counts, onArrival);
    setCounts({});
  };

  return (
    <section className="orders-section">
      <div className="field-label">{t('orders.section')}</div>

      {sources.length === 0 && !troopsHere && (
        <p className="hint-text">{t('orders.noRoute')}</p>
      )}

      {sources.length > 0 && (
        <>
          <div className="march-targets">
            {sources.map((s) => (
              <button
                key={s.id}
                className={`march-target${source?.id === s.id ? ' is-selected' : ''}`}
                onClick={() => {
                  setSourceId(s.id);
                  setCounts({});
                }}
              >
                <span className="march-target-name">{engine.map.region(s.id).name}</span>
                <span className="march-target-time">{Math.round(s.seconds)}s</span>
              </button>
            ))}
          </div>

          <div className="march-picker">
            {UNIT_ORDER.filter((type) => (available[type] ?? 0) > 0).map((type) => {
              const have = available[type] ?? 0;
              const take = counts[type] ?? 0;
              return (
                <div key={type} className="march-row">
                  <span className="march-row-name">
                    {t(UNITS[type].nameKey)}
                    <em className="march-row-have">×{have}</em>
                  </span>
                  <span className="march-stepper">
                    <button
                      className="btn btn-sm"
                      disabled={take <= 0}
                      onClick={() => setCount(type, take - 1)}
                    >
                      −
                    </button>
                    <span className="march-count">{take}</span>
                    <button
                      className="btn btn-sm"
                      disabled={take >= have}
                      onClick={() => setCount(type, take + 1)}
                    >
                      +
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={take >= have}
                      onClick={() => setCount(type, have)}
                    >
                      {t('march.all')}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="march-orders">
        <button
          className="btn btn-primary btn-sm"
          disabled={!source || chosen === 0}
          onClick={() => order()}
        >
          {source && chosen > 0
            ? `${t('orders.marchHere')}（${Math.round(source.seconds)}s）`
            : t('orders.pickTroops')}
        </button>
        <button
          className="btn btn-sm"
          disabled={!canOccupy || (chosen === 0 && !troopsHere)}
          title={t(canOccupy ? 'orders.occupyNote' : 'orders.occupyBlocked')}
          onClick={() => order('occupy')}
        >
          {t('occupy.action')}
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={!canAssault || (chosen === 0 && !troopsHere)}
          title={t(canAssault ? 'orders.assaultNote' : 'orders.assaultBlocked')}
          onClick={() => order('assault')}
        >
          {t('assault.action')}
        </button>
      </div>

      <p className="hint-text">{t('orders.hint')}</p>
    </section>
  );
}
