import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../settings/useSettings';
import { Connection, type ConnectionState } from '../../match/connection';
import type { PlayerSetup } from '../../engine/GameEngine';
import type { Seat } from '../../match/seats';
import type { SetupState } from '../../match/protocol';
import { getMap, DEFAULT_MAP_ID } from '../../engine/maps';
import { validOpponentCores } from '../../engine/startingPositions';
import { PvpSetup } from './PvpSetup';

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

/** Somewhere on this map that can host a match at all. */
function anyStart(mapId: string): string {
  const map = getMap(mapId);
  return pick(map.regions.filter((r) => validOpponentCores(map, r.id).length > 0).map((r) => r.id));
}

/**
 * Finding each other, and agreeing what to play (docs/game-design.md 15.6).
 *
 * One side opens a room and reads the code out; the other types it in. After
 * that both are looking at the same setup, and the match starts when both say
 * they're ready.
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
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const connectionRef = useRef<Connection | null>(null);
  const setupRef = useRef<SetupState | null>(null);
  const startedRef = useRef(false);

  // Whoever is still sitting in the lobby when the screen goes away should
  // not be left holding an open socket.
  useEffect(() => {
    return () => {
      if (!startedRef.current) connectionRef.current?.close();
    };
  }, []);

  /** The host's copy is the real one; every change is posted over. */
  const publish = (next: SetupState) => {
    setupRef.current = next;
    setSetup(next);
    connectionRef.current?.send({ t: 'setup', state: next });
    if (next.hostReady && next.guestReady && next.guestCore && !startedRef.current) {
      startedRef.current = true;
      const setups: PlayerSetup[] = [
        { id: HOST_ID, name: hostName, color: playerColor, coreRegionId: next.hostCore },
        { id: GUEST_ID, name: guestName, color: opponentColor, coreRegionId: next.guestCore },
      ];
      const seats: Seat[] = [
        { by: 'human', playerId: HOST_ID },
        { by: 'remote', playerId: GUEST_ID },
      ];
      connectionRef.current?.send({ t: 'start', setups, seats, you: GUEST_ID });
      onBegin({ setups, seats, role: 'host', connection: connectionRef.current!, opponentId: GUEST_ID });
    }
  };

  /**
   * What the guest asked for, checked before it is believed. Everything here
   * arrived from somebody else's browser: a region that doesn't exist, one too
   * close to the host, or a map nobody is playing on are all things to say no
   * to rather than crash on.
   */
  const hostHandles = (data: unknown) => {
    const current = setupRef.current;
    if (!current || typeof data !== 'object' || data === null) return;
    const message = data as { t?: unknown; core?: unknown; ready?: unknown };

    if (message.t === 'pick' && typeof message.core === 'string') {
      const map = getMap(current.mapId);
      const legal = validOpponentCores(map, current.hostCore).includes(message.core);
      // Once they've said they're ready, moving is a change of terms.
      if (legal && !current.guestReady) publish({ ...current, guestCore: message.core });
      return;
    }
    if (message.t === 'ready' && typeof message.ready === 'boolean') {
      if (message.ready && !current.guestCore) return;
      publish({ ...current, guestReady: message.ready });
    }
  };

  const open = (opening: 'host' | { code: string }) => {
    connectionRef.current?.close();
    const connection = new Connection(opening);
    connectionRef.current = connection;

    connection.onState = (next) => {
      setState(next);
      if (next.at !== 'together' || setupRef.current) return;
      if (opening === 'host') {
        setRole('host');
        publish({
          mapId: DEFAULT_MAP_ID,
          hostCore: anyStart(DEFAULT_MAP_ID),
          guestCore: null,
          hostReady: false,
          guestReady: false,
        });
      }
    };

    connection.onMessage = (data) => {
      if (opening === 'host') return hostHandles(data);

      // The guest is told what the setup is, and then what the match is.
      const message = data as {
        t?: unknown;
        state?: SetupState;
        setups?: PlayerSetup[];
      };
      if (message.t === 'setup' && message.state) {
        setRole('guest');
        setupRef.current = message.state;
        setSetup(message.state);
        return;
      }
      if (message.t === 'start' && Array.isArray(message.setups) && !startedRef.current) {
        startedRef.current = true;
        onBegin({
          setups: message.setups,
          seats: [
            { by: 'remote', playerId: HOST_ID },
            { by: 'human', playerId: GUEST_ID },
          ],
          role: 'guest',
          connection,
          opponentId: HOST_ID,
        });
      }
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

  // Once both are in the room, the lobby becomes the setup they share.
  if (setup && role) {
    const leave = () => {
      connectionRef.current?.close();
      onBack();
    };
    return (
      <PvpSetup
        role={role}
        state={setup}
        playerColor={role === 'host' ? playerColor : opponentColor}
        opponentColor={role === 'host' ? opponentColor : playerColor}
        onPick={(regionId) => {
          const current = setupRef.current!;
          if (role === 'host') {
            // Moving the host may strand the guest's choice, so it goes with it.
            const stillFar =
              current.guestCore !== null &&
              validOpponentCores(getMap(current.mapId), regionId).includes(current.guestCore);
            publish({
              ...current,
              hostCore: regionId,
              guestCore: stillFar ? current.guestCore : null,
              guestReady: stillFar && current.guestReady,
            });
          } else {
            connectionRef.current?.send({ t: 'pick', core: regionId });
          }
        }}
        onPickMap={(mapId) => {
          const current = setupRef.current!;
          if (role !== 'host' || mapId === current.mapId) return;
          // Another map is another board: nobody's flag is planted on it yet.
          publish({
            mapId,
            hostCore: anyStart(mapId),
            guestCore: null,
            hostReady: false,
            guestReady: false,
          });
        }}
        onReady={(ready) => {
          const current = setupRef.current!;
          if (role === 'host') publish({ ...current, hostReady: ready });
          else connectionRef.current?.send({ t: 'ready', ready });
        }}
        onLeave={leave}
      />
    );
  }

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
