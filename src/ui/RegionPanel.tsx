import { BUILDINGS, BUILDING_ORDER, CORE_HP, type BuildingType } from '../engine/buildings';
import { BuildingIcon } from './buildingIcons';
import { FOOD_PER_MIN_BY_SIZE, landSizeOf, type LandSize } from '../engine/land';
import { totalUnits, type UnitCounts, type UnitType } from '../engine/units';
import { UnitPanel } from './UnitPanel';
import { MarchPanel } from './MarchPanel';
import { SupplyCartPanel } from './SupplyCartPanel';
import { ArsenalPanel } from './ArsenalPanel';
import { BombardPanel } from './BombardPanel';
import { BattlePanel } from './BattlePanel';
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
  onOccupy: (regionId: string) => void;
  onAssault: (regionId: string) => void;
  onStandDown: (regionId: string) => void;
  onQueueVehicles: (regionId: string, type: UnitType, count: number) => void;
  onCancelProduction: (index: number) => void;
  onBombard: (from: string, to: string) => void;
  onCeaseFire: (regionId: string) => void;
  onDispatchCart: (from: string, to: string, porters: number) => void;
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

/** What the assault button would be swung at, for the line under it. */
const ASSAULT_TARGET_KEY: Record<'militia' | 'core' | 'building', TranslationKey> = {
  militia: 'assault.militia',
  core: 'assault.core',
  building: 'assault.building',
};

const REJECTION_KEY: Record<Exclude<BuildRejection, 'notOwner'>, TranslationKey> = {
  occupied: 'building.occupied',
  building: 'building.occupied',
  notImplemented: 'building.occupied', // replaced by the def's own reason below
  cannotAfford: 'building.cannotAfford',
  limitReached: 'building.limitReached',
  unrest: 'unrest.noBuild',
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
  onOccupy,
  onAssault,
  onStandDown,
  onQueueVehicles,
  onCancelProduction,
  onBombard,
  onCeaseFire,
  onDispatchCart,
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

  const region = engine.map.region(selectedRegionId);
  const regionState = engine.state.regions[selectedRegionId];
  const owner = regionState.owner ? players.find((p) => p.id === regionState.owner) : null;
  const isMine = regionState.owner === humanPlayerId;
  const garrison = totalUnits(engine.garrisonSeenBy(selectedRegionId, humanPlayerId));
  const seen = engine.canSee(selectedRegionId, humanPlayerId);
  // A camp only needs an army standing here, so the build menu has to appear on
  // ground that isn't yours.
  const canCamp = engine.buildRejection(selectedRegionId, 'camp', humanPlayerId) !== 'notOwner';
  const occupyRejection = engine.occupyRejection(selectedRegionId, humanPlayerId);
  const unrest = isMine ? engine.unrestAt(selectedRegionId) : 0;
  const assaultRejection = engine.assaultRejection(selectedRegionId, humanPlayerId);
  const assaultTarget = engine.assaultTargetAt(selectedRegionId, humanPlayerId);
  const assaulting = engine
    .legionsAt(selectedRegionId)
    .some((l) => l.playerId === humanPlayerId && l.assaulting);
  const coreOwner = regionState.isCore ? players.find((p) => p.coreRegionId === selectedRegionId) : undefined;
  const siege = engine.coreSiegeAt(selectedRegionId)?.attackerId === humanPlayerId;

  return (
    <div className="region-panel">
      <h3>{region.name}</h3>
      {/* Fog (docs 9): an unscouted region shows its name and nothing else. */}
      {!seen ? (
        <>
          <p className="region-owner">{t('fog.unknown')}</p>
          <p className="hint-text">{t('fog.note')}</p>
        </>
      ) : (
        <p className="region-owner">
          {t('game.owner')}：{owner ? owner.name : t('game.neutral')}
          {regionState.isCore ? `（${t('game.core')}）` : ''}
        </p>
      )}

      {seen && (
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
      )}

      {seen && regionState.owner === null && (
        <p className="hint-text">{t('land.captureHint')}</p>
      )}

      {/* Ground just taken off a player: yours, but no use for a while
          (docs 6.4). */}
      {unrest > 0 && (
        <section className="unrest-section">
          <span className="unrest-label">
            {t('unrest.label')}・{Math.ceil(unrest)}s
          </span>
          <p className="hint-text">{t('unrest.note')}</p>
        </section>
      )}

      {/* The core itself (docs 6.7): it has hit points, it can't be taken, and
          grinding it down needs a line of held ground reaching it. */}
      {seen && regionState.isCore && coreOwner && (
        <section className="core-section">
          <span className="core-head">
            <span className="field-label">{t('core.hp')}</span>
            <span className="core-hp-value">
              {Math.ceil(coreOwner.coreHp)}/{CORE_HP}
            </span>
          </span>
          <div className="core-track">
            <div
              className="core-fill"
              style={{ width: `${Math.max(0, coreOwner.coreHp / CORE_HP) * 100}%` }}
            />
          </div>
          {coreOwner.id !== humanPlayerId && (
            <p className="hint-text">
              {siege
                ? t('core.sieging')
                : engine.coreAttackConnected(selectedRegionId, humanPlayerId)
                  ? t('core.needArmy')
                  : t('core.needLine')}
            </p>
          )}
        </section>
      )}

      {/* The three things an army standing here can be told to do (docs 6.6):
          march (in the panel below), assault, occupy. Marching is movement
          only now, so attacking is an order rather than a side effect. */}
      {assaultRejection !== 'noArmy' && assaultRejection !== 'noTarget' && (
        <section className="assault-section">
          <button
            className="btn btn-sm btn-danger"
            disabled={assaultRejection !== null || assaulting}
            onClick={() => onAssault(selectedRegionId)}
          >
            {t('assault.action')}
          </button>
          {assaulting ? (
            <button className="btn btn-sm" onClick={() => onStandDown(selectedRegionId)}>
              {t('assault.standDown')}
            </button>
          ) : null}
          <p className="hint-text">
            {assaultRejection === 'unarmed'
              ? t('assault.unarmed')
              : assaultRejection === 'contested'
                ? t('assault.contested')
              : assaulting
                ? t('assault.underway')
                : t(ASSAULT_TARGET_KEY[assaultTarget ?? 'militia'])}
          </p>
        </section>
      )}

      {/* Taking ground is its own order (docs 6.6): fighting through a region
          doesn't claim it, so the army standing here is offered the choice. */}
      {occupyRejection !== 'noArmy' &&
        occupyRejection !== 'alreadyYours' &&
        occupyRejection !== 'enemyCore' && (
          <section className="occupy-section">
            <button
              className="btn btn-sm btn-primary"
              disabled={occupyRejection !== null}
              onClick={() => onOccupy(selectedRegionId)}
            >
              {t('occupy.action')}
            </button>
            <p className="hint-text">
              {t(occupyRejection === 'contested' ? 'occupy.contested' : 'occupy.hint')}
            </p>
          </section>
        )}

      <UnitPanel
        engine={engine}
        regionId={selectedRegionId}
        playerId={humanPlayerId}
        onTrain={onTrain}
        onUpgrade={onUpgrade}
        onCancelProduction={onCancelProduction}
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

      <BombardPanel
        engine={engine}
        regionId={selectedRegionId}
        playerId={humanPlayerId}
        onBombard={onBombard}
        onCeaseFire={onCeaseFire}
      />

      <ArsenalPanel
        engine={engine}
        regionId={selectedRegionId}
        playerId={humanPlayerId}
        onQueue={onQueueVehicles}
        onCancel={onCancelProduction}
      />

      <SupplyCartPanel
        engine={engine}
        regionId={selectedRegionId}
        playerId={humanPlayerId}
        onDispatch={onDispatchCart}
      />

      {/* Your own ground gets the whole menu; ground you merely have troops on
          gets the one thing an army can put up there — a camp (docs 6.3). */}
      {(isMine || canCamp) && (
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
              {(isMine ? BUILDING_ORDER : (['camp'] as BuildingType[])).map((type) => {
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
              {!isMine && <p className="hint-text">{t('camp.note')}</p>}
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
