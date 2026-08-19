import { CORE_HP } from '../engine/buildings';
import { useSettings } from '../settings/useSettings';
import type { PlayerEconomy } from '../engine/GameEngine';
import type { PlayerState } from '../engine/types';

interface HUDProps {
  players: PlayerState[];
  /**
   * Whose scoreboard this is — everyone else is seen through the fog. null
   * when nobody is playing, which shows every seat in full (docs 13).
   */
  viewerId: string | null;
  /** What the viewer can honestly say about each player (docs 9). */
  intel: Record<string, { regions: number; coreHp: number | null }>;
  economies: Record<string, PlayerEconomy>;
  /** Total headcount (villagers + troops) per player. */
  populations: Record<string, number>;
}

function rate(value: number): string {
  return `+${value.toFixed(1)}`;
}

export function HUD({ players, viewerId, intel, economies, populations }: HUDProps) {
  const { t } = useSettings();
  const unknown = t('hud.unknown');
  return (
    <div className="hud">
      {players.map((p) => {
        const mine = viewerId === null || p.id === viewerId;
        const eco = economies[p.id];
        const seen = intel[p.id] ?? { regions: 0, coreHp: null };
        return (
          <div key={p.id} className="hud-player" style={{ borderColor: p.color }}>
            <div className="hud-player-name" style={{ color: p.color }}>
              {p.name}
            </div>
            <div className="hud-stats">
              {/* Someone else's territory is only what you can see of it, so it
                  reads as a floor rather than a count (docs 9). */}
              <span title={mine ? undefined : t('hud.seenOnly')}>
                {t('game.regions')} {mine ? seen.regions : `${seen.regions}+`}
              </span>
              {/* The core's own HP (docs 6.7): at zero the match is over. */}
              <span className={seen.coreHp !== null && seen.coreHp < CORE_HP ? 'is-hurt' : undefined}>
                {t('game.core')}{' '}
                {seen.coreHp === null ? unknown : `${Math.ceil(seen.coreHp)}/${CORE_HP}`}
              </span>
              {mine ? (
                <>
                  <span>
                    {t('game.population')} {populations[p.id] ?? 0}/
                    {eco?.populationCap ?? p.populationCap}
                  </span>
                  <span>
                    {t('game.money')} {Math.floor(p.money)}
                    {eco && <em className="rate">{rate(eco.moneyPerMin)}</em>}
                  </span>
                  <span>
                    {t('game.food')} {Math.floor(p.food)}
                    {eco && `/${eco.foodCap}`}
                    {eco && <em className="rate">{rate(eco.foodPerMin)}</em>}
                  </span>
                </>
              ) : (
                // No amount of looking at a map tells you what's in someone
                // else's treasury.
                <span className="hud-hidden" title={t('hud.hiddenNote')}>
                  {t('game.population')} {unknown}　{t('game.money')} {unknown}　{t('game.food')}{' '}
                  {unknown}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
