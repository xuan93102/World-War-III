import { useEffect } from 'react';
import { BUILDINGS, BUILDING_ORDER } from '../../engine/buildings';
import { getMap, DEFAULT_MAP_ID } from '../../engine/maps';
import { UNITS, type UnitType } from '../../engine/units';
import { useSettings } from '../../settings/useSettings';
import type { TranslationKey } from '../../settings/translations';
import { BuildingIcon } from '../buildingIcons';

interface HelpScreenProps {
  onBack: () => void;
}

const UNIT_ORDER: UnitType[] = ['militia', 'conscript', 'volunteer', 'marine'];

/** A short stretch of mountain road, at the two states it can be in. */
function RoadSwatch({ locked }: { locked: boolean }) {
  const deck = locked ? '#767c85' : '#e08a3d';
  const edge = locked ? '#41464d' : '#9c5a20';
  return (
    <svg className="help-swatch" viewBox="0 0 34 16" width={34} height={16} aria-hidden="true">
      <line x1="3" y1="10.5" x2="31" y2="7.5" stroke={edge} strokeWidth={7} strokeLinecap="round" />
      <line x1="3" y1="8" x2="31" y2="5" stroke={deck} strokeWidth={7} strokeLinecap="round" />
      <line
        x1="3"
        y1="8"
        x2="31"
        y2="5"
        stroke="#12161c"
        strokeWidth={7}
        strokeLinecap="round"
        strokeOpacity={0.22}
        strokeDasharray="6 6"
      />
    </svg>
  );
}

/** Two peaks of the range, drawn the same way the map draws them. */
function RidgeSwatch() {
  return (
    <svg className="help-swatch" viewBox="0 0 34 16" width={34} height={16} aria-hidden="true">
      <path d="M4 15 L11 3 L11 15 Z" fill="#a5825c" />
      <path d="M18 15 L11 3 L11 15 Z" fill="#5f482f" />
      <path d="M18 15 L24 6 L24 15 Z" fill="#a5825c" />
      <path d="M30 15 L24 6 L24 15 Z" fill="#5f482f" />
    </svg>
  );
}

function LegendRow({ icon, textKey }: { icon: React.ReactNode; textKey: TranslationKey }) {
  const { t } = useSettings();
  return (
    <div className="help-legend-row">
      <span className="help-legend-icon">{icon}</span>
      <span className="help-legend-text">{t(textKey)}</span>
    </div>
  );
}

export function HelpScreen({ onBack }: HelpScreenProps) {
  const { t } = useSettings();
  // The help page already describes this map's mountains and passes, so it
  // shows this map's wonder as the landmark it will actually be built as.
  const map = getMap(DEFAULT_MAP_ID);

  // The key everybody presses when they want out of something. Cheap to
  // support and it costs a reader nothing to try.
  useEffect(() => {
    const leave = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [onBack]);

  return (
    <div className="screen help-screen">
      {/* The way out comes first and stays put. Buried at the bottom of a
          screen this long, it could not be found without scrolling to look
          for it — which is the one thing somebody who wants to leave should
          not have to do. */}
      <div className="screen-header">
        <button className="btn" onClick={onBack}>
          ← {t('menu.back')}
        </button>
        <h2 className="screen-title">{t('help.title')}</h2>
      </div>

      <div className="help-grid">
      <div className="panel">
        <div className="field-label">{t('help.map')}</div>
        <ul className="help-list">
          <li>{t('help.mapPan')}</li>
          <li>{t('help.mapZoom')}</li>
          <li>{t('help.mapRotate')}</li>
          <li>{t('help.mapReset')}</li>
          <li>{t('help.mapLabels')}</li>
        </ul>
        <p className="hint-text">{t('help.mapMode')}</p>
      </div>

      <div className="panel">
        <div className="field-label">{t('help.legend')}</div>
        <div className="help-legend">
          <LegendRow icon={<BuildingIcon type="core" size={26} />} textKey="help.legendCore" />
          <LegendRow icon={<BuildingIcon type="academy" size={26} />} textKey="help.legendBuilding" />
          <LegendRow
            icon={
              <svg className="help-swatch" viewBox="0 0 24 24" width={26} height={26} aria-hidden="true">
                <rect
                  x="0.8"
                  y="0.8"
                  width="22.4"
                  height="22.4"
                  rx="6"
                  fill="#d9534f"
                  fillOpacity={0.35}
                  stroke="#12161c"
                  strokeWidth="1.6"
                  strokeDasharray="3 2.2"
                />
              </svg>
            }
            textKey="help.legendConstruction"
          />
          <LegendRow icon={<span className="help-garrison">⚔8</span>} textKey="help.legendGarrison" />
          <LegendRow
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24">
                <circle cx="8" cy="12" r="5" fill="#4f8ef7" stroke="#12161c" strokeWidth="1.4" />
                <rect
                  x="14.5"
                  y="9"
                  width="6"
                  height="6"
                  rx="1.4"
                  fill="#4f8ef7"
                  stroke="#12161c"
                  strokeWidth="1.4"
                />
              </svg>
            }
            textKey="help.legendRoad"
          />
          <LegendRow icon={<RoadSwatch locked />} textKey="help.legendPassLocked" />
          <LegendRow icon={<RoadSwatch locked={false} />} textKey="help.legendPassUnlocked" />
          <LegendRow icon={<RidgeSwatch />} textKey="help.legendRidge" />
        </div>
      </div>

      <div className="panel">
        <div className="field-label">{t('help.rules')}</div>
        <ul className="help-list">
          <li>{t('help.rulesCore')}</li>
          <li>{t('help.rulesResource')}</li>
          <li>{t('help.rulesLand')}</li>
          <li>{t('help.rulesCapture')}</li>
          <li>{t('help.rulesMountain')}</li>
          <li>{t('help.rulesWonder')}</li>
        </ul>
      </div>

      <div className="panel help-buildings help-grid-full">
        <div className="field-label">{t('help.buildings')}</div>
        <p className="hint-text">{t('help.buildingsNote')}</p>
        <div className="help-entries">
          {BUILDING_ORDER.map((type) => {
            const def = BUILDINGS[type];
            return (
              <div className="help-entry" key={type}>
                <BuildingIcon type={type === 'wonder' ? map.wonder : type} size={26} />
                <div className="help-entry-body">
                  <div className="help-entry-head">
                    <span className="help-entry-name">{t(def.nameKey)}</span>
                    <span className="help-entry-meta">
                      {def.implemented ? (
                        <>
                          {def.costMoney > 0 && `${t('game.money')} ${def.costMoney}`}
                          {def.costFood > 0 && `　${t('game.food')} ${def.costFood}`}
                        </>
                      ) : (
                        t('help.locked')
                      )}
                    </span>
                  </div>
                  <div className="help-entry-desc">{t(def.descKey)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel help-units help-grid-full">
        <div className="field-label">{t('help.units')}</div>
        <p className="hint-text">{t('help.unitsNote')}</p>
        <div className="help-entries">
          {UNIT_ORDER.map((type) => {
            const def = UNITS[type];
            const source = def.upgradeFrom
              ? t('help.unitUpgradeFrom').replace('{n}', t(`unit.${def.upgradeFrom}` as TranslationKey))
              : def.trainAt === 'core'
                ? t('help.unitTrainCore')
                : def.trainAt === 'arsenal'
                  ? // Vehicles say what makes them different: range and pace.
                    `${t('unit.buildAtArsenal')}・${def.buildSeconds}s　${t('unit.range')} ${def.range}　${t('unit.speed')} ${def.speed}×`
                  : t('help.unitTrainAcademy');
            const cost = def.trainCost ?? def.upgradeCost;
            return (
              <div className="help-entry" key={type}>
                <div className="help-entry-body">
                  <div className="help-entry-head">
                    <span className="help-entry-name">{t(`unit.${type}` as TranslationKey)}</span>
                    <span className="help-entry-meta">
                      {t('unit.atk')} {def.atk}　{t('unit.hp')} {def.hp}
                      {cost !== null && `　${t('game.money')} ${cost}`}
                    </span>
                  </div>
                  <div className="help-entry-desc">{source}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      </div>
    </div>
  );
}
