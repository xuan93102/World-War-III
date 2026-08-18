import { UNITS, UNIT_ORDER, isVehicle, totalUnits, type UnitType } from '../engine/units';
import { SupplyBar } from './SupplyBar';
import { useSettings } from '../settings/useSettings';
import type { GameEngine } from '../engine/GameEngine';

interface UnitPanelProps {
  engine: GameEngine;
  regionId: string;
  playerId: string;
  onCancelProduction: (index: number) => void;
  onTrain: (regionId: string, type: UnitType, count: number) => void;
  onUpgrade: (regionId: string, type: UnitType, count: number) => void;
}

export function UnitPanel({
  engine,
  regionId,
  playerId,
  onTrain,
  onUpgrade,
  onCancelProduction,
}: UnitPanelProps) {
  const { t } = useSettings();
  const region = engine.state.regions[regionId];
  // Only what this player is allowed to know is standing here (docs 9).
  const stationed = engine.garrisonSeenBy(regionId, playerId);
  const isMine = region.owner === playerId;
  // Supply belongs to the legion, so it only shows on ground you hold.
  const legion = engine.legionsAt(regionId).find((l) => l.playerId === playerId);

  return (
    <section className="unit-section">
      <div className="field-label">{t('unit.section')}</div>

      <div className="unit-stationed">
        {totalUnits(stationed) === 0 ? (
          <span className="unit-empty">{t('unit.none')}</span>
        ) : (
          UNIT_ORDER.filter((type) => (stationed[type] ?? 0) > 0).map((type) => (
            <span key={type} className="unit-chip">
              {t(UNITS[type].nameKey)} ×{stationed[type]}
            </span>
          ))
        )}
      </div>

      {legion && totalUnits(legion.units) > 0 && <SupplyBar supply={legion.supply} />}

      {/* Recruits on the way (docs 6.1): nothing appears the instant it's
          paid for, and an upgrade takes its unit off the line meanwhile. */}
      {engine.state.players[playerId].production
        .map((job, index) => ({ job, index }))
        .filter(({ job }) => job.regionId === regionId && !isVehicle(job.type))
        .map(({ job, index }) => (
          <div key={index} className="arsenal-job">
            <span className="arsenal-job-name">
              {t(UNITS[job.type].nameKey)}・{t('train.inProgress')}
            </span>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${100 * (1 - job.remainingSeconds / job.totalSeconds)}%` }}
              />
            </div>
            <span className="arsenal-job-meta">
              {t('train.remaining').replace('{n}', String(job.remaining))}・
              {Math.ceil(job.remainingSeconds)}s
            </span>
            <button className="btn btn-sm" onClick={() => onCancelProduction(index)}>
              {t('vehicle.cancel')}
            </button>
          </div>
        ))}

      {/* Troops that have left here, or are on their way in. They're on the
          road and count for neither region's garrison, so without this the
          origin just reads "no garrison" the instant an army sets off. */}
      {engine.marchesInvolving(regionId).map((march) => {
        const outbound = march.from === regionId;
        return (
          <div key={march.id} className="unit-transit">
            <span className="unit-transit-label">
              {t(outbound ? 'march.outgoing' : 'march.incoming')}
            </span>
            <span className="unit-transit-body">
              {UNIT_ORDER.filter((type) => (march.units[type] ?? 0) > 0)
                .map((type) => `${t(UNITS[type].nameKey)} ×${march.units[type]}`)
                .join('、')}
              {outbound ? ' → ' : ' ← '}
              {engine.map.region(outbound ? march.to : march.from).name}
            </span>
            <span className="unit-transit-eta">
              {t('march.eta').replace('{n}', String(Math.ceil(march.remainingSeconds)))}
            </span>
          </div>
        );
      })}

      {isMine && (
        <div className="unit-actions">
          {UNIT_ORDER.map((type) => {
            const def = UNITS[type];
            const canTrainHere = def.trainCost !== null;
            const trainRejection = canTrainHere
              ? engine.trainRejection(regionId, playerId, type, 1)
              : null;
            const upgradeRejection = def.upgradeFrom
              ? engine.upgradeRejection(regionId, playerId, type, 1)
              : null;

            // A tier is only worth listing here if this region is the right
            // place for it — otherwise the panel fills with rows that can
            // never be actioned from this region.
            const trainable = canTrainHere && trainRejection !== 'wrongSite';
            const upgradable = def.upgradeFrom !== null && upgradeRejection !== 'needsAcademy';
            if (!trainable && !upgradable) return null;

            return (
              <div key={type} className="unit-row">
                <span className="unit-row-name">
                  {t(UNITS[type].nameKey)}
                  <em className="unit-row-stats">
                    {t('unit.atk')} {def.atk} · {t('unit.hp')} {def.hp}
                  </em>
                </span>
                {trainable && (
                  <button
                    className="btn btn-sm"
                    disabled={trainRejection !== null}
                    onClick={() => onTrain(regionId, type, 1)}
                    title={trainRejection === 'noPopulationRoom' ? t('unit.noPopulationRoom') : undefined}
                  >
                    {t('unit.train')} ({def.trainCost}・{def.buildSeconds}s)
                  </button>
                )}
                {upgradable && (
                  <button
                    className="btn btn-sm"
                    disabled={upgradeRejection !== null}
                    onClick={() => onUpgrade(regionId, type, 1)}
                    title={upgradeRejection === 'noSourceUnits' ? t('unit.noSourceUnits') : undefined}
                  >
                    {t('unit.upgrade')} ({def.upgradeCost}・{def.upgradeSeconds}s)
                  </button>
                )}
              </div>
            );
          })}
          <p className="hint-text">{t('unit.populationNote')}</p>
        </div>
      )}
    </section>
  );
}
