import { useMemo, useState } from 'react';
import { REGIONS, getRegion } from '../../engine/regions';
import { MIN_CORE_DISTANCE, validOpponentCores } from '../../engine/startingPositions';
import { useSettings } from '../../settings/useSettings';
import type { TranslationKey } from '../../settings/translations';
import type { AiDifficulty } from '../../engine/types';
import { MapPicker } from '../MapPicker';

interface PveSetupProps {
  playerColor: string;
  opponentColor: string;
  onBegin: (options: {
    mapId: string;
    difficulty: AiDifficulty;
    playerCore: string;
    opponentCore: string;
  }) => void;
  onBack: () => void;
}

const MAPS: { id: string; nameKey: TranslationKey; descKey: TranslationKey }[] = [
  { id: 'taiwan', nameKey: 'pve.map.taiwan', descKey: 'pve.map.taiwanDesc' },
];

const DIFFICULTIES: { id: AiDifficulty; nameKey: TranslationKey; descKey: TranslationKey }[] = [
  { id: 'easy', nameKey: 'pve.difficulty.easy', descKey: 'pve.difficulty.easyDesc' },
  { id: 'normal', nameKey: 'pve.difficulty.normal', descKey: 'pve.difficulty.normalDesc' },
  { id: 'hard', nameKey: 'pve.difficulty.hard', descKey: 'pve.difficulty.hardDesc' },
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Regions with no legal opponent placement can't be chosen at all — they'd
// leave nowhere to put the AI. (東勢和平石岡 is the one such region: it sits
// at the middle of the mountain-pass network, so nothing is far enough away.)
const UNPICKABLE = new Set(REGIONS.filter((r) => validOpponentCores(r.id).length === 0).map((r) => r.id));
const PICKABLE = REGIONS.filter((r) => !UNPICKABLE.has(r.id)).map((r) => r.id);

export function PveSetup({ playerColor, opponentColor, onBegin, onBack }: PveSetupProps) {
  const { t } = useSettings();
  const [mapId, setMapId] = useState(MAPS[0].id);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');
  const [playerCore, setPlayerCore] = useState<string>(() => pick(PICKABLE));

  // Re-rolled whenever the player's pick changes, so the shown opponent
  // position is always the one the match will actually start with.
  const opponentCore = useMemo(() => {
    const candidates = validOpponentCores(playerCore);
    return candidates.length > 0 ? pick(candidates) : null;
  }, [playerCore]);

  const selectRandom = () => setPlayerCore(pick(PICKABLE));

  return (
    <div className="screen screen-centered">
      <h2 className="screen-title">{t('pve.title')}</h2>

      <div className="panel panel-wide">
        <div className="field-label">{t('pve.startRegion')}</div>
        <p className="hint-text">{t('pve.startRegionHint')}</p>
        <MapPicker
          selectedId={playerCore}
          opponentId={opponentCore}
          disabledIds={UNPICKABLE}
          onSelect={(id) => {
            if (!UNPICKABLE.has(id)) setPlayerCore(id);
          }}
          playerColor={playerColor}
          opponentColor={opponentColor}
        />
        <div className="picker-footer">
          <span>
            <span className="swatch" style={{ background: playerColor }} />
            {t('pve.selected')}：{getRegion(playerCore).name}
            {opponentCore && (
              <>
                {'　'}
                <span className="swatch" style={{ background: opponentColor }} />
                {t('game.ai')}：{getRegion(opponentCore).name}
              </>
            )}
          </span>
          <button className="btn btn-sm" onClick={selectRandom}>
            {t('pve.startRegionRandom')}
          </button>
        </div>
        <p className="hint-text">
          {t('pve.minDistanceNote').replace('{n}', String(MIN_CORE_DISTANCE))}
        </p>
      </div>

      <div className="panel">
        <div className="field-label">{t('pve.map')}</div>
        <div className="card-list">
          {MAPS.map((m) => (
            <button
              key={m.id}
              className={`card-option${mapId === m.id ? ' is-selected' : ''}`}
              onClick={() => setMapId(m.id)}
              aria-pressed={mapId === m.id}
            >
              <span className="card-option-title">{t(m.nameKey)}</span>
              <span className="card-option-desc">{t(m.descKey)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="field-label">{t('pve.difficulty')}</div>
        <div className="card-list">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              className={`card-option${difficulty === d.id ? ' is-selected' : ''}`}
              onClick={() => setDifficulty(d.id)}
              aria-pressed={difficulty === d.id}
            >
              <span className="card-option-title">{t(d.nameKey)}</span>
              <span className="card-option-desc">{t(d.descKey)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="button-row">
        <button className="btn btn-ghost" onClick={onBack}>
          {t('menu.back')}
        </button>
        <button
          className="btn btn-primary"
          disabled={!opponentCore}
          onClick={() =>
            opponentCore && onBegin({ mapId, difficulty, playerCore, opponentCore })
          }
        >
          {t('pve.begin')}
        </button>
      </div>
    </div>
  );
}
