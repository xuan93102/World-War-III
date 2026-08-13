import { useState } from 'react';
import { getRegion } from '../engine/regions';
import { UNITS, UNIT_ORDER, totalUnits, type UnitCounts, type UnitType } from '../engine/units';
import { useSettings } from '../settings/useSettings';
import type { TranslationKey } from '../settings/translations';
import type { GameEngine } from '../engine/GameEngine';
import type { MarchRejection } from '../engine/movement';

interface MarchPanelProps {
  engine: GameEngine;
  regionId: string;
  playerId: string;
  /** Destination chosen by clicking the map, while picking is active. */
  marchTarget: string | null;
  pickingMarch: boolean;
  onPickMarch: (picking: boolean) => void;
  onMarch: (from: string, to: string, units: UnitCounts) => void;
}

/** Only the reasons worth explaining — the rest can't be shown to the user. */
const REJECTION_KEY: Partial<Record<MarchRejection, TranslationKey>> = {
  passLocked: 'march.reject.passLocked',
  noRoute: 'march.reject.noRoute',
};

export function MarchPanel({
  engine,
  regionId,
  playerId,
  marchTarget,
  pickingMarch,
  onPickMarch,
  onMarch,
}: MarchPanelProps) {
  const { t } = useSettings();
  const [nearby, setNearby] = useState<string | null>(null);
  const [counts, setCounts] = useState<UnitCounts>({});

  const region = engine.state.regions[regionId];
  const stationed = region.units;
  const available = UNIT_ORDER.filter((type) => (stationed[type] ?? 0) > 0);

  if (region.owner !== playerId) return null;

  // While picking on the map the map's choice wins; otherwise it's whichever
  // neighbouring chip was tapped.
  const target = pickingMarch ? marchTarget : nearby;
  const route = target ? engine.marchRoute(regionId, target, playerId) : null;

  const setCount = (type: UnitType, next: number) => {
    const capped = Math.max(0, Math.min(stationed[type] ?? 0, next));
    setCounts((prev) => {
      const out = { ...prev };
      if (capped > 0) out[type] = capped;
      else delete out[type];
      return out;
    });
  };

  const chosen = totalUnits(counts);
  const rejection = target ? engine.marchRejection(regionId, target, playerId, counts) : null;
  const canGo = target !== null && chosen > 0 && rejection === null;
  const totalSeconds = route ? engine.routeSeconds(regionId, route) : 0;

  return (
    <section className="march-section">
      <div className="field-label">{t('march.section')}</div>

      {available.length === 0 ? (
        <p className="hint-text">{t('march.noTroops')}</p>
      ) : (
        <>
          <div className="march-targets">
            {getRegion(regionId).neighbors.map((id) => {
              // Judge the destination on its own terms, not on the current
              // (possibly empty) selection, so the list reads the same before
              // you've picked any troops.
              const reason = engine.marchRejection(regionId, id, playerId, { militia: 1 });
              const blocked = reason !== null && reason !== 'noUnits';
              const key = reason ? REJECTION_KEY[reason] : undefined;
              // Marching onto ground someone else holds is a legal order — it
              // starts a fight. Flag it so nobody attacks by accident.
              const isAttack = !blocked && !engine.canMarchInPeace(id, playerId);
              return (
                <button
                  key={id}
                  className={`march-target${target === id ? ' is-selected' : ''}${isAttack ? ' is-attack' : ''}`}
                  disabled={blocked}
                  title={key ? t(key) : undefined}
                  onClick={() => {
                    onPickMarch(false);
                    setNearby(id);
                  }}
                >
                  <span className="march-target-name">{getRegion(id).name}</span>
                  {isAttack && <span className="march-target-attack">{t('march.attack')}</span>}
                  <span className="march-target-time">{engine.marchSeconds(regionId, id)}s</span>
                </button>
              );
            })}
          </div>

          <div className="march-picker">
            {available.map((type) => {
              const have = stationed[type] ?? 0;
              const take = counts[type] ?? 0;
              return (
                <div key={type} className="march-row">
                  <span className="march-row-name">
                    {t(UNITS[type].nameKey)}
                    <em className="march-row-have">×{have}</em>
                  </span>
                  <span className="march-stepper">
                    <button className="btn btn-sm" disabled={take <= 0} onClick={() => setCount(type, take - 1)}>
                      −
                    </button>
                    <span className="march-count">{take}</span>
                    <button className="btn btn-sm" disabled={take >= have} onClick={() => setCount(type, take + 1)}>
                      +
                    </button>
                    <button className="btn btn-sm" disabled={take >= have} onClick={() => setCount(type, have)}>
                      {t('march.all')}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Anywhere reachable, not just next door — the route is walked hop
              by hop, so a far target is a long column, not a teleport. */}
          <button
            className={`btn btn-sm${pickingMarch ? ' btn-primary' : ''}`}
            onClick={() => {
              onPickMarch(!pickingMarch);
              setNearby(null);
            }}
          >
            {pickingMarch ? t('march.pickingOnMap') : t('march.pickFar')}
          </button>

          {target && route && (
            <p className="march-route">
              {t('march.routeSummary')
                .replace('{to}', getRegion(target).name)
                .replace('{hops}', String(route.length))
                .replace('{n}', String(totalSeconds))}
            </p>
          )}
          {target && !route && (
            <p className="hint-text">
              {t(rejection === 'passLocked' ? 'march.reject.passLocked' : 'march.reject.noRoute')}
            </p>
          )}

          <button
            className="btn btn-primary btn-sm"
            disabled={!canGo}
            onClick={() => {
              if (!target) return;
              onMarch(regionId, target, counts);
              setCounts({});
              setNearby(null);
            }}
          >
            {target && route
              ? `${t('march.depart')}・${getRegion(target).name}（${totalSeconds}s）`
              : t('march.pickTarget')}
          </button>
          <p className="hint-text">{t('march.hint')}</p>
        </>
      )}
    </section>
  );
}
