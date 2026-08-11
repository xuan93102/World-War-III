import { useSettings } from '../settings/useSettings';
import type { GameEngine } from '../engine/GameEngine';

interface VillagerBarProps {
  engine: GameEngine;
  playerId: string;
  onBuy: (count: number) => void;
}

/**
 * Recruiting is a nation-wide action rather than a per-region one, so it
 * lives in the top bar instead of the region panel.
 */
export function VillagerBar({ engine, playerId, onBuy }: VillagerBarProps) {
  const { t } = useSettings();
  const player = engine.state.players[playerId];
  const eco = engine.economy(playerId);
  const max = engine.maxAffordableVillagers(playerId);

  return (
    <div className="villager-bar">
      <span className="villager-count">
        {/* Villagers, not total population: once soldiers exist they'll be
            population too, but only villagers earn gold. */}
        {t('game.villagers')} {Math.floor(player.villagers)}
        <em className="villager-sub">
          {t('game.population')} {engine.population(playerId)}/{eco.populationCap}
        </em>
      </span>
      <div className="villager-buttons">
        <button className="btn btn-sm" disabled={max < 1} onClick={() => onBuy(1)}>
          +1
        </button>
        <button className="btn btn-sm" disabled={max < 10} onClick={() => onBuy(10)}>
          +10
        </button>
        <button className="btn btn-sm btn-primary" disabled={max < 1} onClick={() => onBuy(max)}>
          {t('game.buyMax')}
          {max > 0 && ` (${max})`}
        </button>
      </div>
    </div>
  );
}
