import { BUILDINGS, CORE_HP } from '../engine/buildings';
import { BuildingIcon } from './buildingIcons';
import { FOOD_PER_MIN_BY_SIZE, landSizeOf, type LandSize } from '../engine/land';
import { UNITS, UNIT_ORDER, totalUnits } from '../engine/units';
import { useSettings } from '../settings/useSettings';
import type { TranslationKey } from '../settings/translations';
import type { GameEngine } from '../engine/GameEngine';
import type { PlayerState } from '../engine/types';

interface SpectatePanelProps {
  engine: GameEngine;
  players: PlayerState[];
  selectedRegionId: string | null;
}

const LAND_SIZE_KEY: Record<LandSize, TranslationKey> = {
  small: 'land.size.small',
  medium: 'land.size.medium',
  large: 'land.size.large',
  huge: 'land.size.huge',
};

/**
 * The region readout for a match nobody is playing (docs 13).
 *
 * Watching two machines fight wants the opposite of the playing panel: no
 * orders at all, and no fog either — the point is to see what both sides are
 * doing, so everything on the ground is stated plainly.
 */
export function SpectatePanel({ engine, players, selectedRegionId }: SpectatePanelProps) {
  const { t } = useSettings();

  if (!selectedRegionId) {
    return <div className="region-panel region-panel-empty">{t('spectate.selectHint')}</div>;
  }

  const region = engine.map.region(selectedRegionId);
  const state = engine.state.regions[selectedRegionId];
  const owner = state.owner ? players.find((p) => p.id === state.owner) : null;
  const coreOwner = state.isCore ? players.find((p) => p.coreRegionId === selectedRegionId) : undefined;
  const legions = engine.legionsAt(selectedRegionId).filter((l) => totalUnits(l.units) > 0);
  const battle = engine.state.battles.find((b) => b.regionId === selectedRegionId);
  const militia = state.owner === null ? totalUnits(engine.garrisonAt(selectedRegionId)) : 0;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const color = (id: string) => players.find((p) => p.id === id)?.color;

  return (
    <div className="region-panel">
      <h3>{region.name}</h3>
      <p className="region-owner">
        {t('game.owner')}：{owner ? owner.name : t('game.neutral')}
        {state.isCore ? `（${t('game.core')}）` : ''}
      </p>

      <dl className="region-stats">
        <div>
          <dt>{t('land.size')}</dt>
          <dd>{t(LAND_SIZE_KEY[landSizeOf(region.landArea)])}</dd>
        </div>
        <div>
          <dt>{t('game.food')}</dt>
          <dd>
            +{FOOD_PER_MIN_BY_SIZE[landSizeOf(region.landArea)]}
            {t('game.perMin')}
          </dd>
        </div>
        {state.owner === null && (
          <div>
            <dt>{t('land.garrison')}</dt>
            <dd className={militia > 0 ? 'is-defended' : 'is-undefended'}>
              {militia > 0 ? `${t('land.militia')} ×${militia}` : t('land.undefended')}
            </dd>
          </div>
        )}
      </dl>

      {engine.unrestAt(selectedRegionId) > 0 && (
        <section className="unrest-section">
          <span className="unrest-label">
            {t('unrest.label')}・{Math.ceil(engine.unrestAt(selectedRegionId))}s
          </span>
        </section>
      )}

      {coreOwner && (
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
        </section>
      )}

      {state.construction ? (
        <section className="build-section">
          <div className="field-label">{t('building.section')}</div>
          <div className="build-status-name">
            <BuildingIcon type={state.construction.type} />
            {t(BUILDINGS[state.construction.type].nameKey)}・{t('building.building')}・
            {Math.ceil(state.construction.remainingSeconds)}s
          </div>
        </section>
      ) : state.building ? (
        <section className="build-section">
          <div className="field-label">{t('building.section')}</div>
          <div className="build-status-name">
            <BuildingIcon type={state.building.type} />
            {t(BUILDINGS[state.building.type].nameKey)}
          </div>
          <div className="build-status-meta">
            {t('building.hp')} {Math.ceil(state.building.hp)}
          </div>
        </section>
      ) : null}

      {battle && (
        <section className="battle-section">
          <div className="field-label">{t('battle.section')}</div>
          <p className="hint-text">
            {name(battle.attackerId)} → {battle.defenderId ? name(battle.defenderId) : t('land.militia')}
            ・{t('battle.rounds').replace('{n}', String(battle.roundsFought))}
          </p>
        </section>
      )}

      {/* Who is standing here, side by side — the thing you actually watch for. */}
      <section className="spectate-forces">
        <div className="field-label">{t('spectate.forces')}</div>
        {legions.length === 0 ? (
          <p className="hint-text">{t('spectate.empty')}</p>
        ) : (
          legions.map((l) => (
            <div key={l.id} className="spectate-force">
              <div className="spectate-force-head" style={{ color: color(l.playerId) }}>
                {name(l.playerId)}
                <em className="spectate-supply">
                  {t('supply.label')} {Math.round(l.supply * 100)}%
                </em>
              </div>
              <div className="spectate-force-units">
                {UNIT_ORDER.filter((type) => (l.units[type] ?? 0) > 0).map((type) => (
                  <span key={type}>
                    {t(UNITS[type].nameKey)} ×{l.units[type]}
                  </span>
                ))}
              </div>
              {l.assaulting && <p className="hint-text">{t('assault.underway')}</p>}
              {l.onArrival === 'occupy' && <p className="hint-text">{t('orders.occupyNote')}</p>}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
