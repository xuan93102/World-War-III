import { useMemo } from 'react';
import { MAPS, getMap } from '../../engine/maps';
import { MIN_CORE_DISTANCE, validOpponentCores } from '../../engine/startingPositions';
import { useSettings } from '../../settings/useSettings';
import { MapPicker } from '../MapPicker';
import { ChatBox } from '../ChatBox';
import type { ChatLog } from '../../match/chat';
import type { SetupState } from '../../match/protocol';

interface PvpSetupProps {
  /** Which end of the wire we are; the host is the one who may change things. */
  role: 'host' | 'guest';
  state: SetupState;
  playerColor: string;
  opponentColor: string;
  /** What the host just did to the board, for the end that did not do it. */
  notice: string | null;
  chat: ChatLog;
  onSay: (text: string) => void;
  onSwapColors: () => void;
  onSwapPositions: () => void;
  /** Where we would like to start. */
  onPick: (regionId: string) => void;
  onPickMap: (mapId: string) => void;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
}

/**
 * Agreeing what to play (docs/game-design.md 15.6).
 *
 * Both ends render this from the same state, so both are looking at the same
 * board while they choose. The one thing each side decides alone is where
 * *they* start — nobody wants an opponent choosing that for them — and the
 * only rule between them is that the two cores must be far enough apart. The
 * host owns the map, on the grounds that somebody has to.
 */
export function PvpSetup({
  role,
  state,
  playerColor,
  opponentColor,
  notice,
  chat,
  onSay,
  onSwapColors,
  onSwapPositions,
  onPick,
  onPickMap,
  onReady,
  onLeave,
}: PvpSetupProps) {
  const { t } = useSettings();
  const map = getMap(state.mapId);

  const mine = role === 'host' ? state.hostCore : state.guestCore;
  const theirs = role === 'host' ? state.guestCore : state.hostCore;
  const iAmReady = role === 'host' ? state.hostReady : state.guestReady;
  const theyAreReady = role === 'host' ? state.guestReady : state.hostReady;

  // Somewhere is pickable if it could host a match at all, and — once the
  // other side has planted their flag — if it is far enough from theirs.
  const pickable = useMemo(() => {
    const canHostAMatch = new Set(
      map.regions.filter((r) => validOpponentCores(map, r.id).length > 0).map((r) => r.id),
    );
    if (!theirs) return canHostAMatch;
    const farEnough = new Set(validOpponentCores(map, theirs));
    return new Set([...canHostAMatch].filter((id) => farEnough.has(id)));
  }, [map, theirs]);

  const disabled = useMemo(
    () => new Set(map.regions.map((r) => r.id).filter((id) => !pickable.has(id))),
    [map, pickable],
  );

  const bothPicked = state.hostCore !== null && state.guestCore !== null;

  return (
    <div className="screen screen-centered">
      <h2 className="screen-title">{t('pvp.setupTitle')}</h2>

      {notice && <p className="notice">{notice}</p>}

      <div className="panel panel-wide">
        <div className="field-label">{t('pvp.pickYours')}</div>
        <p className="hint-text">
          {t('pvp.minDistance').replace('{n}', String(MIN_CORE_DISTANCE))}
        </p>
        <MapPicker
          map={map}
          selectedId={mine}
          opponentId={theirs}
          disabledIds={disabled}
          onSelect={(id) => {
            // Changing your mind after saying you're ready would start a match
            // the other side agreed to on different terms.
            if (!iAmReady && pickable.has(id)) onPick(id);
          }}
          playerColor={playerColor}
          opponentColor={opponentColor}
        />
        <div className="picker-footer">
          <span>
            <span className="swatch" style={{ background: playerColor }} />
            {t('pvp.you')}：{mine ? map.region(mine).name : t('pvp.notChosen')}
            {'　'}
            <span className="swatch" style={{ background: opponentColor }} />
            {t('pvp.them')}：{theirs ? map.region(theirs).name : t('pvp.notChosen')}
          </span>
          {/* The host owns the terms, the same way it owns the map. The guest
              agrees to them by saying it is ready, or does not. */}
          {role === 'host' && (
            <span className="swap-actions">
              <button className="btn btn-sm" onClick={onSwapColors} disabled={iAmReady}>
                {t('pvp.swapColors')}
              </button>
              <button
                className="btn btn-sm"
                onClick={onSwapPositions}
                disabled={iAmReady || !bothPicked}
              >
                {t('pvp.swapPositions')}
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="field-label">{t('pve.map')}</div>
        <div className="card-list">
          {MAPS.map((m) => (
            <button
              key={m.id}
              className={`card-option${state.mapId === m.id ? ' is-selected' : ''}`}
              disabled={role !== 'host' || iAmReady}
              onClick={() => onPickMap(m.id)}
              aria-pressed={state.mapId === m.id}
            >
              <span className="card-option-title">{t(m.nameKey)}</span>
              <span className="card-option-desc">
                {role === 'host' ? t(m.descKey) : t('pvp.hostPicksMap')}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="waiting-row">
          {theyAreReady ? (
            t('pvp.theyAreReady')
          ) : (
            <>
              <span className="spinner" aria-hidden="true" />
              {t('pvp.waitingForThem')}
            </>
          )}
        </div>
        <button
          className={`btn ${iAmReady ? '' : 'btn-primary'}`}
          disabled={!bothPicked}
          onClick={() => onReady(!iAmReady)}
        >
          {iAmReady ? t('pvp.notReady') : t('pvp.ready')}
        </button>
        {!bothPicked && <p className="hint-text">{t('pvp.bothMustPick')}</p>}
      </div>

      <div className="panel">
        <div className="field-label">{t('chat.title')}</div>
        <ChatBox log={chat} onSend={onSay} />
      </div>

      <button className="btn btn-ghost" onClick={onLeave}>
        {t('menu.back')}
      </button>
    </div>
  );
}
