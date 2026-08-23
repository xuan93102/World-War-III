import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../settings/useSettings';
import { Connection, type ConnectionState } from '../../match/connection';
import type { PlayerSetup } from '../../engine/GameEngine';
import type { Seat } from '../../match/seats';
import type { SetupState } from '../../match/protocol';
import { getMap, DEFAULT_MAP_ID } from '../../engine/maps';
import { validOpponentCores } from '../../engine/startingPositions';
import { asChatText, ChatLog } from '../../match/chat';
import { PvpSetup } from './PvpSetup';

export interface PvpMatch {
  setups: PlayerSetup[];
  seats: Seat[];
  role: 'host' | 'guest';
  connection: Connection;
  opponentId: string;
  /** What the two of them have been saying, carried into the match (docs 15.9). */
  chat: ChatLog;
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
  // Why the board just changed under them. The host owns the map and may move
  // its own core, and either can strand a choice the guest had already made —
  // which is a rude thing to have happen with no word about it.
  const [notice, setNotice] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const connectionRef = useRef<Connection | null>(null);
  const setupRef = useRef<SetupState | null>(null);
  const startedRef = useRef(false);
  const chatRef = useRef<ChatLog | null>(null);
  if (!chatRef.current) {
    chatRef.current = new ChatLog();
    chatRef.current.onChange = () => forceRender((n) => n + 1);
  }
  const chat = chatRef.current;

  const say = (text: string) => {
    const clean = asChatText(text);
    if (!clean) return;
    connectionRef.current?.send({ t: 'chat', text: clean });
    chat.add('me', clean);
  };

  /** A line from the other end, whichever end that is. */
  const heard = (data: unknown): boolean => {
    const message = data as { t?: unknown; text?: unknown };
    if (message?.t !== 'chat') return false;
    const clean = asChatText(message.text);
    if (clean) chat.add('them', clean);
    return true;
  };

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
        { id: HOST_ID, name: hostName, color: colorOf('host', next), coreRegionId: next.hostCore },
        {
          id: GUEST_ID,
          name: guestName,
          color: colorOf('guest', next),
          coreRegionId: next.guestCore,
        },
      ];
      const seats: Seat[] = [
        { by: 'human', playerId: HOST_ID },
        { by: 'remote', playerId: GUEST_ID },
      ];
      connectionRef.current?.send({ t: 'start', setups, seats, you: GUEST_ID });
      onBegin({
        setups,
        seats,
        role: 'host',
        connection: connectionRef.current!,
        opponentId: GUEST_ID,
        chat,
      });
    }
  };

  /** Whose colour is whose, once they have had the chance to trade. */
  const colorOf = (side: 'host' | 'guest', of: SetupState) =>
    (side === 'host') === !of.swapped ? playerColor : opponentColor;

  /**
   * What the guest asked for, checked before it is believed. Everything here
   * arrived from somebody else's browser: a region that doesn't exist, one too
   * close to the host, or a map nobody is playing on are all things to say no
   * to rather than crash on.
   */
  const hostHandles = (data: unknown) => {
    if (heard(data)) return;
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
          swapped: false,
        });
      }
    };

    connection.onMessage = (data) => {
      if (opening === 'host') return hostHandles(data);
      if (heard(data)) return;

      // The guest is told what the setup is, and then what the match is.
      const message = data as {
        t?: unknown;
        state?: SetupState;
        setups?: PlayerSetup[];
      };
      if (message.t === 'setup' && message.state) {
        setRole('guest');
        // Say what the host just did to the board, rather than letting the
        // screen change under them and leaving them to work it out.
        const before = setupRef.current;
        if (before) {
          if (before.mapId !== message.state.mapId) setNotice(t('pvp.hostChangedMap'));
          else if (before.guestCore && !message.state.guestCore) {
            setNotice(t('pvp.hostMovedOnYou'));
          } else if (before.swapped !== message.state.swapped) setNotice(t('pvp.colorsSwapped'));
          else if (before.guestCore !== message.state.guestCore && message.state.guestCore) {
            setNotice(t('pvp.positionsSwapped'));
          } else setNotice(null);
        }
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
          chat,
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
        playerColor={colorOf(role, setup)}
        opponentColor={colorOf(role === 'host' ? 'guest' : 'host', setup)}
        notice={notice}
        chat={chat}
        onSay={say}
        onSwapColors={() => {
          const current = setupRef.current!;
          // Nothing in the match turns on it, so nobody has to agree again.
          publish({ ...current, swapped: !current.swapped });
        }}
        onSwapPositions={() => {
          const current = setupRef.current!;
          if (!current.guestCore) return;
          // Trading starts is a change of terms, so both say yes again.
          publish({
            ...current,
            hostCore: current.guestCore,
            guestCore: current.hostCore,
            hostReady: false,
            guestReady: false,
          });
        }}
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
            swapped: current.swapped,
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
