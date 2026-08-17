import { UNITS, UNIT_ORDER, stackAtk, totalUnits, type UnitCounts } from '../engine/units';
import { garrisonAt } from '../engine/regions';
import { useSettings } from '../settings/useSettings';
import type { GameEngine } from '../engine/GameEngine';
import type { PlayerState } from '../engine/types';

interface BattlePanelProps {
  engine: GameEngine;
  regionId: string;
  playerId: string;
  players: PlayerState[];
  onRetreat: (regionId: string) => void;
}

export function BattlePanel({ engine, regionId, playerId, players, onRetreat }: BattlePanelProps) {
  const { t } = useSettings();
  const battle = engine.battleAt(regionId);
  if (!battle) return null;

  const nameOf = (id: string | null) =>
    id === null ? t('game.neutral') : (players.find((p) => p.id === id)?.name ?? id);

  const side = (
    label: string,
    who: string,
    units: UnitCounts,
    mine: boolean,
  ) => (
    <div className={`battle-side${mine ? ' is-mine' : ''}`}>
      <span className="battle-side-label">
        {label}・{who}
      </span>
      <span className="battle-side-units">
        {UNIT_ORDER.filter((type) => (units[type] ?? 0) > 0).map((type) => (
          <span key={type} className="unit-chip">
            {t(UNITS[type].nameKey)} ×{units[type]}
          </span>
        ))}
        {totalUnits(units) === 0 && <span className="unit-empty">{t('unit.none')}</span>}
      </span>
      <span className="battle-side-stats">
        {t('unit.atk')} {stackAtk(units)}
      </span>
    </div>
  );

  const rejection = engine.retreatRejection(regionId, playerId);
  const isAttacker = battle.attackerId === playerId;

  return (
    <section className="battle-section">
      <div className="field-label">{t('battle.section')}</div>

      {side(
        t('battle.attacker'),
        nameOf(battle.attackerId),
        battle.attackerUnits,
        battle.attackerId === playerId,
      )}
      {side(
        t('battle.defender'),
        nameOf(battle.defenderId),
        garrisonAt(engine.state, regionId),
        battle.defenderId === playerId,
      )}

      <div className="battle-meta">
        <span>{t('battle.rounds').replace('{n}', String(battle.roundsFought))}</span>
        <span>
          {t('battle.nextRound').replace('{n}', String(Math.ceil(battle.secondsUntilRound)))}
        </span>
      </div>

      {isAttacker && (
        <>
          <button
            className="btn btn-sm btn-danger"
            disabled={rejection !== null}
            onClick={() => onRetreat(regionId)}
          >
            {t('battle.retreat')}
          </button>
          {rejection === 'tooSoon' && <p className="hint-text">{t('battle.retreatTooSoon')}</p>}
          {rejection === 'cutOff' && <p className="hint-text">{t('battle.retreatCutOff')}</p>}
        </>
      )}

      <p className="hint-text">{t('battle.hint')}</p>
    </section>
  );
}
