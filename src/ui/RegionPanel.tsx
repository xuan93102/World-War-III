import { BUILDINGS, BUILDING_ORDER, type BuildingType } from '../engine/buildings';
import { BuildingIcon } from './buildingIcons';
import { FOOD_PER_MIN_BY_SIZE, landSizeOf, type LandSize } from '../engine/land';
import { totalUnits, type UnitCounts, type UnitType } from '../engine/units';
import { UnitPanel } from './UnitPanel';
import { MarchPanel } from './MarchPanel';
import { BattlePanel } from './BattlePanel';
import { getRegion } from '../engine/regions';
import { useSettings } from '../settings/useSettings';
import type { TranslationKey } from '../settings/translations';
import type { BuildRejection, GameEngine } from '../engine/GameEngine';
import type { PlayerState } from '../engine/types';

interface RegionPanelProps {
  engine: GameEngine;
  players: PlayerState[];
  humanPlayerId: string;
  selectedRegionId: string | null;
  onClaim: (regionId: string, owner: string | null) => void;
  onBuild: (regionId: string, type: BuildingType) => void;
  onTrain: (regionId: string, type: UnitType, count: number) => void;
  onUpgrade: (regionId: string, type: UnitType, count: number) => void;
  onMarch: (from: string, to: string, units: UnitCounts) => void;
  marchTarget: string | null;
  pickingMarch: boolean;
  onPickMarch: (picking: boolean) => void;
  onRetreat: (regionId: string) => void;
  onCancelBuild: (regionId: string) => void;
  onDemolish: (regionId: string) => void;
}

const LAND_SIZE_KEY: Record<LandSize, TranslationKey> = {
  small: 'land.size.small',
  medium: 'land.size.medium',
  large: 'land.size.large',
  huge: 'land.size.huge',
};

const REJECTION_KEY: Record<Exclude<BuildRejection, 'notOwner'>, TranslationKey> = {
  occupied: 'building.occupied',
  building: 'building.occupied',
  notImplemented: 'building.occupied', // replaced by the def's own reason below
  cannotAfford: 'building.cannotAfford',
  limitReached: 'building.limitReached',
};

export function RegionPanel({
  engine,
  players,
  humanPlayerId,
  selectedRegionId,
  onClaim,
  onBuild,
  onTrain,
  onUpgrade,
  onMarch,
  marchTarget,
  pickingMarch,
  onPickMarch,
  onRetreat,
  onCancelBuild,
  onDemolish,
}: RegionPanelProps) {
  const { t } = useSettings();

  if (!selectedRegionId) {
    return <div className="region-panel region-panel-empty">{t('game.selectHint')}</div>;
  }

  const region = getRegion(selectedRegionId);
  const regionState = engine.state.regions[selectedRegionId];
  const owner = regionState.owner ? players.find((p) => p.id === regionState.owner) : null;
  const isMine = regionState.owner === humanPlayerId;
  const garrison = totalUnits(regionState.units);

  return (
    <div className="region-panel">
      <h3>{region.name}</h3>
      <p className="region-owner">
        {t('game.owner')}：{owner ? owner.name : t('game.neutral')}
        {regionState.isCore ? `（${t('game.core')}）` : ''}
      </p>

      <dl className="region-stats">
        <div>
          <dt>{t('land.size')}</dt>
          <dd>{t(LAND_SIZE_KEY[landSizeOf(region.landArea)])}</dd>
        </div>
        <div>
          <dt>{t('game.food')}</dt>
          <dd>+{FOOD_PER_MIN_BY_SIZE[landSizeOf(region.landArea)]}{t('game.perMin')}</dd>
        </div>
        {regionState.owner === null && (
          <div>
            <dt>{t('land.garrison')}</dt>
            <dd className={garrison > 0 ? 'is-defended' : 'is-undefended'}>
              {garrison > 0 ? `${t('land.militia')} ×${garrison}` : t('land.undefended')}
            </dd>
          </div>
        )}
      </dl>

      {regionState.owner === null && (
        <p className="hint-text">{t('land.captureHint')}</p>
      )}

      <UnitPanel
        engine={engine}
        regionId={selectedRegionId}
        playerId={humanPlayerId}
        onTrain={onTrain}
        onUpgrade={onUpgrade}
      />

      <BattlePanel
        engine={engine}
        regionId={selectedRegionId}
        playerId={humanPlayerId}
        players={players}
        onRetreat={onRetreat}
      />

      <MarchPanel
        engine={engine}
        regionId={selectedRegionId}
        playerId={humanPlayerId}
        marchTarget={marchTarget}
        pickingMarch={pickingMarch}
        onPickMarch={onPickMarch}
        onMarch={onMarch}
      />

      {isMine && (
        <section className="build-section">
          <div className="field-label">{t('building.section')}</div>

          {regionState.construction ? (
            <div className="build-status">
              <div className="build-status-name">
                <BuildingIcon type={regionState.construction.type} />
                {t(BUILDINGS[regionState.construction.type].nameKey)}・{t('building.building')}
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${
                      100 *
                      (1 - regionState.construction.remainingSeconds / regionState.construction.totalSeconds)
                    }%`,
                  }}
                />
              </div>
              <div className="build-status-meta">
                {Math.ceil(regionState.construction.remainingSeconds)}s
              </div>
              <button className="btn btn-sm" onClick={() => onCancelBuild(selectedRegionId)}>
                {t('building.cancel')}
              </button>
            </div>
          ) : regionState.building ? (
            <div className="build-status">
              <div className="build-status-name">
                <BuildingIcon type={regionState.building.type} />
                {t(BUILDINGS[regionState.building.type].nameKey)}
              </div>
              <div className="build-status-meta">
                {t(BUILDINGS[regionState.building.type].descKey)}
              </div>
              <div className="build-status-meta">
                {t('building.hp')} {regionState.building.hp}
              </div>
              {!regionState.isCore && (
                <button className="btn btn-sm" onClick={() => onDemolish(selectedRegionId)}>
                  {t('building.demolish')}
                </button>
              )}
            </div>
          ) : (
            <div className="build-menu">
              {BUILDING_ORDER.map((type) => {
                const def = BUILDINGS[type];
                const rejection = engine.buildRejection(selectedRegionId, type, humanPlayerId);
                const lockedReason =
                  rejection === 'notImplemented'
                    ? def.lockedReasonKey
                    : rejection && rejection !== 'notOwner'
                      ? REJECTION_KEY[rejection]
                      : undefined;
                return (
                  <button
                    key={type}
                    className="build-option"
                    disabled={rejection !== null}
                    onClick={() => onBuild(selectedRegionId, type)}
                    title={def.implemented ? t(def.descKey) : lockedReason ? t(lockedReason) : undefined}
                  >
                    <span className="build-option-head">
                      <BuildingIcon type={type} size={20} />
                      <span className="build-option-name">{t(def.nameKey)}</span>
                      <span className="build-option-cost">
                        {def.costMoney > 0 && `${t('game.money')} ${def.costMoney}`}
                        {def.costFood > 0 && `　${t('game.food')} ${def.costFood}`}
                      </span>
                    </span>
                    <span className="build-option-desc">
                      {lockedReason ? t(lockedReason) : t(def.descKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="debug-section">
        <div className="field-label">debug</div>
        <div className="region-panel-actions">
          {players.map((p) => (
            <button key={p.id} style={{ borderColor: p.color }} onClick={() => onClaim(selectedRegionId, p.id)}>
              {t('game.setOwner')}{p.name}
            </button>
          ))}
          <button onClick={() => onClaim(selectedRegionId, null)}>{t('game.setNeutral')}</button>
        </div>
      </section>
    </div>
  );
}
