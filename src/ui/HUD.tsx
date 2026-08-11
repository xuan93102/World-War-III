import { useSettings } from '../settings/useSettings';
import type { PlayerEconomy } from '../engine/GameEngine';
import type { PlayerState } from '../engine/types';

interface HUDProps {
  players: PlayerState[];
  ownedCounts: Record<string, number>;
  economies: Record<string, PlayerEconomy>;
  /** Total headcount (villagers + troops) per player. */
  populations: Record<string, number>;
}

function rate(value: number): string {
  return `+${value.toFixed(1)}`;
}

export function HUD({ players, ownedCounts, economies, populations }: HUDProps) {
  const { t } = useSettings();
  return (
    <div className="hud">
      {players.map((p) => {
        const eco = economies[p.id];
        return (
          <div key={p.id} className="hud-player" style={{ borderColor: p.color }}>
            <div className="hud-player-name" style={{ color: p.color }}>
              {p.name}
            </div>
            <div className="hud-stats">
              <span>
                {t('game.regions')} {ownedCounts[p.id] ?? 0}
              </span>
              <span>
                {t('game.population')} {populations[p.id] ?? 0}/{eco?.populationCap ?? p.populationCap}
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
