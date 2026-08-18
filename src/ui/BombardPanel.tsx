import { rangedAtk } from '../engine/units';
import { useSettings } from '../settings/useSettings';
import type { GameEngine } from '../engine/GameEngine';

interface BombardPanelProps {
  engine: GameEngine;
  regionId: string;
  playerId: string;
  onBombard: (from: string, to: string) => void;
  onCeaseFire: (regionId: string) => void;
}

/**
 * Indirect fire (docs/game-design.md 6.5). Only shows up where there are guns
 * to fire: everything in range is listed, because reaching a target without
 * moving onto it is the whole point of having them.
 */
export function BombardPanel({
  engine,
  regionId,
  playerId,
  onBombard,
  onCeaseFire,
}: BombardPanelProps) {
  const { t } = useSettings();
  const legion = engine.legionsAt(regionId).find((l) => l.playerId === playerId);
  if (!legion || rangedAtk(legion.units, 1) === 0) return null;

  const targets = engine.map.regions
    .map((r) => r.id)
    .filter((id) => engine.bombardRejection(regionId, id, playerId) === null);

  return (
    <section className="bombard-section">
      <div className="field-label">{t('bombard.action')}</div>

      {legion.bombarding ? (
        <>
          <p className="hint-text">
            {t('bombard.underway').replace('{n}', engine.map.region(legion.bombarding).name)}
          </p>
          <button className="btn btn-sm" onClick={() => onCeaseFire(regionId)}>
            {t('bombard.stop')}
          </button>
        </>
      ) : targets.length === 0 ? (
        <p className="hint-text">{t('bombard.reject.noTarget')}</p>
      ) : (
        <div className="bombard-targets">
          {targets.map((id) => (
            <button key={id} className="bombard-target" onClick={() => onBombard(regionId, id)}>
              <span>{engine.map.region(id).name}</span>
              <span className="bombard-target-range">
                {engine.map.distance(regionId, id)}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="hint-text">{t('bombard.note')}</p>
    </section>
  );
}
