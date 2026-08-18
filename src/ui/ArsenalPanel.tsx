import { useState } from 'react';
import { UNITS, VEHICLE_TYPES, type UnitType } from '../engine/units';
import { useSettings } from '../settings/useSettings';
import type { TranslationKey } from '../settings/translations';
import type { GameEngine, VehicleRejection } from '../engine/GameEngine';

interface ArsenalPanelProps {
  engine: GameEngine;
  regionId: string;
  playerId: string;
  onQueue: (regionId: string, type: UnitType, count: number) => void;
  onCancel: (index: number) => void;
}

const REJECTION_KEY: Partial<Record<VehicleRejection, TranslationKey>> = {
  needsTech: 'vehicle.reject.needsTech',
  cannotAfford: 'vehicle.reject.cannotAfford',
  noPopulationRoom: 'vehicle.reject.noPopulationRoom',
  unrest: 'unrest.noBuild',
};

/**
 * The arsenal's slipway (docs/game-design.md 6.5). Vehicles take minutes each,
 * so unlike training this is a queue you watch rather than a button that pays
 * out at once.
 */
export function ArsenalPanel({ engine, regionId, playerId, onQueue, onCancel }: ArsenalPanelProps) {
  const { t } = useSettings();
  const [count, setCount] = useState(1);

  const isArsenal = engine.arsenals(playerId).includes(regionId);
  const jobs = engine.state.players[playerId].production
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => job.regionId === regionId);
  if (!isArsenal && jobs.length === 0) return null;

  return (
    <section className="arsenal-section">
      <div className="field-label">{t('vehicle.section')}</div>

      {jobs.map(({ job, index }) => (
        <div key={index} className="arsenal-job">
          <span className="arsenal-job-name">
            {t(UNITS[job.type].nameKey)}・{t('vehicle.building')}
          </span>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${100 * (1 - job.remainingSeconds / job.totalSeconds)}%` }}
            />
          </div>
          <span className="arsenal-job-meta">
            {t('vehicle.remaining').replace('{n}', String(job.remaining))}・
            {Math.ceil(job.remainingSeconds)}s
          </span>
          <button className="btn btn-sm" onClick={() => onCancel(index)}>
            {t('vehicle.cancel')}
          </button>
        </div>
      ))}

      {isArsenal && (
        <>
          <div className="arsenal-count">
            <span className="field-label">{t('vehicle.queue')}</span>
            <span className="march-stepper">
              <button className="btn btn-sm" disabled={count <= 1} onClick={() => setCount(count - 1)}>
                −
              </button>
              <span className="march-count">{count}</span>
              <button className="btn btn-sm" onClick={() => setCount(count + 1)}>
                +
              </button>
            </span>
          </div>

          {VEHICLE_TYPES.map((type) => {
            const def = UNITS[type];
            const rejection = engine.buildVehicleRejection(regionId, playerId, type, count);
            const key = rejection ? REJECTION_KEY[rejection] : undefined;
            return (
              <div key={type} className="unit-row">
                <span className="unit-row-name">
                  {t(def.nameKey)}
                  <em className="unit-row-stats">
                    {t('unit.atk')} {def.atk} · {t('unit.hp')} {def.hp} · {t('unit.range')}{' '}
                    {def.range} · {t('unit.speed')} {def.speed}×
                  </em>
                </span>
                <button
                  className="btn btn-sm"
                  disabled={rejection !== null}
                  title={key ? t(key) : undefined}
                  onClick={() => onQueue(regionId, type, count)}
                >
                  {t('vehicle.queue')} ({def.trainCost! * count}・{def.buildSeconds}s)
                </button>
              </div>
            );
          })}
          <p className="hint-text">{t('vehicle.note')}</p>
        </>
      )}
    </section>
  );
}
