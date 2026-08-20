import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../settings/useSettings';
import { Connection, type ConnectionState } from '../../match/connection';
import type { PlayerSetup } from '../../engine/GameEngine';
import type { Seat } from '../../match/seats';
import { getMap, DEFAULT_MAP_ID } from '../../engine/maps';
import { validOpponentCores } from '../../engine/startingPositions';

export interface PvpMatch {
  setups: PlayerSetup[];
  seats: Seat[];
  role: 'host' | 'guest';
  connection: Connection;
  opponentId: string;
}

interface PvpLobbyProps {
  playerColor: string;
  opponentColor: string;
  hostName: string;
  guestName: string;
  onBegin: (match: PvpMatch) => void;
  onBack: () => void;
}

const HOST_ID = 'p1';
const GUEST_ID = 'p2';

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Finding each other (docs/game-design.md 15.4).
 *
 * One side opens a room and reads the code out; the other types it in. The
 * host draws the starting positions and tells the guest what the match is —
 * there's no shared setup screen yet, so the side that opened the room is the
 * side that decides.
 */
export function PvpLobby({
  playerColor,
  opponentColor,
  hostName,
  guestName,
  onBegin,
  onBack,
}: PvpLobbyProps) {
  const { t } = useSettings();
  const [state, setState] = useState<ConnectionState | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const connectionRef = useRef<Connection | null>(null);
  const startedRef = useRef(false);

  // Whoever is still sitting in the lobby when the screen goes away should
  // not be left holding an open socket.
  useEffect(() => {
    return () => {
      if (!startedRef.current) connectionRef.current?.close();
    };
  }, []);

  const open = (opening: 'host' | { code: string }) => {
    connectionRef.current?.close();
    const connection = new Connection(opening);
    connectionRef.current = connection;
    connection.onState = (next) => {
      setState(next);
      if (next.at !== 'together' || startedRef.current) return;
      startedRef.current = true;

      if (opening === 'host') {
        // The host draws the board and posts it over.
        const map = getMap(DEFAULT_MAP_ID);
        const pickable = map.regions
          .filter((r) => validOpponentCores(map, r.id).length > 0)
          .map((r) => r.id);
        const hostCore = pick(pickable);
        const guestCore = pick(validOpponentCores(map, hostCore));
        const setups: PlayerSetup[] = [
          { id: HOST_ID, name: hostName, color: playerColor, coreRegionId: hostCore },
          { id: GUEST_ID, name: guestName, color: opponentColor, coreRegionId: guestCore },
        ];
        const seats: Seat[] = [
          { by: 'human', playerId: HOST_ID },
          { by: 'remote', playerId: GUEST_ID },
        ];
        connection.send({ t: 'start', setups, seats, you: GUEST_ID });
        onBegin({ setups, seats, role: 'host', connection, opponentId: GUEST_ID });
      }
    };

    // The guest plays nothing until the host says what the match is.
    connection.onMessage = (data) => {
      const message = data as { t?: unknown; setups?: PlayerSetup[]; you?: string };
      if (message.t !== 'start' || !Array.isArray(message.setups)) return;
      const seats: Seat[] = [
        { by: 'remote', playerId: HOST_ID },
        { by: 'human', playerId: GUEST_ID },
      ];
      onBegin({
        setups: message.setups,
        seats,
        role: 'guest',
        connection,
        opponentId: HOST_ID,
      });
    };
  };

  const code = state && 'code' in state ? state.code : '';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked without a secure context; the code is on
      // screen anyway, so this is not worth reporting.
    }
  };

  const failure =
    state?.at === 'failed'
      ? t(
          state.why === 'noRoom'
            ? 'pvp.noRoom'
            : state.why === 'roomFull'
              ? 'pvp.roomFull'
              : 'pvp.noRelay',
        )
      : null;

  return (
    <div className="screen screen-centered">
      <h2 className="screen-title">{t('pvp.title')}</h2>

      {failure && <p className="notice">{failure}</p>}

      <div className="panel">
        <div className="field-label">{t('pvp.roomCode')}</div>
        {code && state?.at !== 'failed' ? (
          <>
            <div className="room-code-row">
              <code className="room-code">{code}</code>
              <button className="btn btn-sm" onClick={copyCode}>
                {copied ? t('pvp.copied') : t('pvp.copy')}
              </button>
            </div>
            <div className="waiting-row">
              <span className="spinner" aria-hidden="true" />
              {t('pvp.waiting')}
            </div>
          </>
        ) : (
          <>
            <p className="hint-text">{t('pvp.hostHint')}</p>
            <button
              className="btn btn-primary"
              disabled={state?.at === 'connecting'}
              onClick={() => open('host')}
            >
              {t('pvp.host')}
            </button>
          </>
        )}
      </div>

      <div className="panel">
        <label className="field-label" htmlFor="join-code">
          {t('pvp.joinLabel')}
        </label>
        <div className="room-code-row">
          <input
            id="join-code"
            className="text-input"
            placeholder={t('pvp.joinPlaceholder')}
            value={joinCode}
            maxLength={6}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          />
          <button
            className="btn btn-sm"
            disabled={joinCode.length !== 6}
            onClick={() => open({ code: joinCode })}
          >
            {t('pvp.join')}
          </button>
        </div>
      </div>

      <button className="btn btn-ghost" onClick={onBack}>
        {t('menu.back')}
      </button>
    </div>
  );
}
