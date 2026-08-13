import {
  CORE_UPGRADE,
  MAX_CORE_LEVEL,
  MAX_RESEARCHERS,
  TECHS,
  TECH_ORDER,
  researcherCost,
  type TechDef,
} from '../engine/tech';
import { useSettings } from '../settings/useSettings';
import type { TranslationKey } from '../settings/translations';
import type { GameEngine, ResearchRejection } from '../engine/GameEngine';
import { Modal } from './Modal';

interface TechPanelProps {
  engine: GameEngine;
  playerId: string;
  onClose: () => void;
  onChanged: () => void;
}

/** Only the reasons worth spelling out; the rest are obvious from the row. */
const REJECTION_KEY: Partial<Record<ResearchRejection, TranslationKey>> = {
  needsLab: 'tech.needsLab',
  slotsFull: 'tech.slotsFull',
  cannotAfford: 'tech.cannotAfford',
};

export function TechPanel({ engine, playerId, onClose, onChanged }: TechPanelProps) {
  const { t } = useSettings();
  const player = engine.state.players[playerId];

  const byLevel = ([1, 2, 3] as const).map((level) => ({
    level,
    techs: TECH_ORDER.map((id) => TECHS[id]).filter((d) => d.coreLevel === level),
  }));

  const coreRejection = engine.coreUpgradeRejection(playerId);
  const nextLevel = Math.min(player.coreLevel + 1, MAX_CORE_LEVEL) as 2 | 3;
  const upgradeCost = CORE_UPGRADE[nextLevel];
  const researcherRejection = engine.researcherRejection(playerId);

  const row = (def: TechDef) => {
    const rejection = engine.researchRejection(playerId, def.id);
    const active = player.research.find((r) => r.techId === def.id);
    const done = player.techs.includes(def.id);
    // A tech whose system isn't built shows its own reason; everything else
    // shows why it can't start right now.
    const reasonKey = rejection === 'notImplemented' ? def.lockedReasonKey : REJECTION_KEY[rejection ?? 'done'];

    return (
      <div className={`tech-row${done ? ' is-done' : ''}`} key={def.id}>
        <div className="tech-row-main">
          <div className="tech-row-head">
            <span className="tech-row-name">{t(def.nameKey)}</span>
            <span className="tech-row-cost">
              {done ? t('tech.researched') : `${t('game.money')} ${def.costMoney}・${def.seconds}s`}
            </span>
          </div>
          <div className="tech-row-desc">{t(def.descKey)}</div>
          {def.requires.length > 0 && (
            <div className="tech-row-req">
              {t('tech.requires').replace(
                '{n}',
                def.requires.map((id) => t(TECHS[id].nameKey)).join('、'),
              )}
            </div>
          )}
          {active && (
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${100 * (1 - active.remainingSeconds / active.totalSeconds)}%` }}
              />
            </div>
          )}
          {!done && !active && reasonKey && <div className="tech-row-req">{t(reasonKey)}</div>}
        </div>
        {!done &&
          (active ? (
            <span className="tech-row-status">
              {t('tech.researching')} {Math.ceil(active.remainingSeconds)}s
            </span>
          ) : (
            <button
              className="btn btn-sm"
              disabled={rejection !== null}
              onClick={() => {
                engine.startResearch(playerId, def.id);
                onChanged();
              }}
            >
              {t('tech.research')}
            </button>
          ))}
      </div>
    );
  };

  return (
    <Modal
      title={t('tech.section')}
      onDismiss={onClose}
      actions={
        <button className="btn" onClick={onClose}>
          {t('menu.back')}
        </button>
      }
    >
      <div className="tech-header">
        <div className="tech-stat">
          <span className="field-label">{t('tech.coreLevel')}</span>
          <strong>{player.coreLevel}</strong>
          {player.coreUpgrade ? (
            <span className="tech-row-status">
              {t('tech.upgradingCore')} {Math.ceil(player.coreUpgrade.remainingSeconds)}s
            </span>
          ) : coreRejection === 'maxed' ? (
            <span className="tech-row-req">{t('tech.coreMaxed')}</span>
          ) : (
            <button
              className="btn btn-sm"
              disabled={coreRejection !== null}
              onClick={() => {
                engine.startCoreUpgrade(playerId);
                onChanged();
              }}
            >
              {t('tech.upgradeCore')}（{t('game.money')} {upgradeCost.costMoney}・
              {t('game.food')} {upgradeCost.costFood}・{upgradeCost.seconds}s）
            </button>
          )}
        </div>

        <div className="tech-stat">
          <span className="field-label">{t('tech.researchers')}</span>
          <strong>
            {player.researchers}/{MAX_RESEARCHERS}
          </strong>
          {player.researcherTraining ? (
            <span className="tech-row-status">
              {t('tech.trainingResearcher')} {Math.ceil(player.researcherTraining.remainingSeconds)}s
            </span>
          ) : researcherRejection === 'full' ? (
            <span className="tech-row-req">{t('tech.researchersFull')}</span>
          ) : (
            <button
              className="btn btn-sm"
              disabled={researcherRejection !== null}
              onClick={() => {
                engine.trainResearcher(playerId);
                onChanged();
              }}
            >
              {t('tech.trainResearcher')}（{t('game.money')} {researcherCost(player.researchers)}）
            </button>
          )}
        </div>
      </div>
      <p className="hint-text">{t('tech.researchersNote')}</p>

      {byLevel.map(({ level, techs }) => (
        <section className="tech-tier" key={level}>
          <div className="field-label">
            {t('tech.coreLevel')} {level}
            {player.coreLevel < level && `・${t('tech.needsCoreLevel').replace('{n}', String(level))}`}
          </div>
          {techs.map(row)}
        </section>
      ))}
    </Modal>
  );
}
