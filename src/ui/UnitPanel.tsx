import { UNITS, UNIT_ORDER, totalUnits, type UnitType } from '../engine/units';
import { useSettings } from '../settings/useSettings';
import type { GameEngine } from '../engine/GameEngine';

interface UnitPanelProps {
  engine: GameEngine;
  regionId: string;
  playerId: string;
  onTrain: (regionId: string, type: UnitType, count: number) => void;
  onUpgrade: (regionId: string, type: UnitType, count: number) => void;
}

export function UnitPanel({ engine, regionId, playerId, onTrain, onUpgrade }: UnitPanelProps) {
  const { t } = useSettings();
  const region = engine.state.regions[regionId];
  const stationed = region.units;
  const isMine = region.owner === playerId;

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
                    {t('unit.train')} ({def.trainCost})
                  </button>
                )}
                {upgradable && (
                  <button
                    className="btn btn-sm"
                    disabled={upgradeRejection !== null}
                    onClick={() => onUpgrade(regionId, type, 1)}
                    title={upgradeRejection === 'noSourceUnits' ? t('unit.noSourceUnits') : undefined}
                  >
                    {t('unit.upgrade')} ({def.upgradeCost})
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
