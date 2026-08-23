import { useEffect, useRef, useState } from 'react';
import './App.css';
import type { GameEngine, PlayerSetup } from './engine/GameEngine';
import type { AiDifficulty } from './engine/types';
import type { Seat } from './match/seats';
import { Connection } from './match/connection';
import { forgetMatch, resumableMatch } from './match/resume';
import { ChatLog } from './match/chat';
import { SettingsProvider } from './settings/SettingsContext';
import { useSettings } from './settings/useSettings';
import { GameScreen } from './ui/screens/GameScreen';
import { HelpScreen } from './ui/screens/HelpScreen';
import { MainMenu } from './ui/screens/MainMenu';
import { ModeSelect } from './ui/screens/ModeSelect';
import { PveSetup } from './ui/screens/PveSetup';
import { PvpLobby, type PvpMatch } from './ui/screens/PvpLobby';
import { ReplayList } from './ui/screens/ReplayList';
import { Replay, type Recording } from './match/recording';
import { SettingsScreen } from './ui/screens/SettingsScreen';

type Screen = 'menu' | 'mode' | 'pvp' | 'pve' | 'spectate' | 'settings' | 'help' | 'replays' | 'game';

/**
 * How hard a seat plays once a machine inherits it. A seat that was already a
 * machine keeps its own setting; one that was a person has none to keep, and
 * the middle is the least surprising thing to hand them.
 */
const seatDifficulty = (seat: Seat): AiDifficulty =>
  seat.by === 'ai' ? seat.difficulty : 'normal';

const PLAYER_COLOR = '#4f8ef7';
const OPPONENT_COLOR = '#e0524a';
const HUMAN_ID = 'p1';

interface MatchConfig {
  setups: PlayerSetup[];
  canPause: boolean;
  /** Who drives each side (docs 15.4). No human seat means we're watching. */
  seats: Seat[];
  /** Present when somebody in this match is on another machine. */
  net?: { role: 'host' | 'guest'; connection: Connection; opponentId: string; chat: ChatLog };
  /** Present when watching a match back rather than playing one (docs 16). */
  replay?: Replay;
  /**
   * Present when this match was already under way: a page that reloaded in
   * the middle of it (docs 15.8), or a replay somebody took over (docs 16).
   * Only the first carries on being recorded.
   */
  resumed?: { engine: GameEngine; steps: number; recording?: Recording };
}

function AppShell() {
  const { t } = useSettings();
  const [screen, setScreen] = useState<Screen>('menu');
  const [match, setMatch] = useState<MatchConfig | null>(null);
  // Bumped on each new match so <GameScreen> remounts with a fresh engine.
  const [matchKey, setMatchKey] = useState(0);

  interface SetupResult {
    mapId: string;
    difficulty: AiDifficulty;
    opponentDifficulty: AiDifficulty;
    playerCore: string;
    opponentCore: string;
  }

  const beginPve = ({ difficulty, playerCore, opponentCore }: SetupResult) => {
    setMatch({
      canPause: true,
      seats: [
        { by: 'human', playerId: HUMAN_ID },
        { by: 'ai', playerId: 'p2', difficulty },
      ],
      setups: [
        { id: HUMAN_ID, name: t('game.playerA'), color: PLAYER_COLOR, coreRegionId: playerCore },
        {
          id: 'p2',
          name: t('game.ai'),
          color: OPPONENT_COLOR,
          coreRegionId: opponentCore,
          aiDifficulty: difficulty,
        },
      ],
    });
    setMatchKey((k) => k + 1);
    setScreen('game');
  };

  // Both seats machine-run (docs 13). Nothing else about the match changes —
  // the controllers take the same orders a human would.
  const beginSpectate = ({
    difficulty,
    opponentDifficulty,
    playerCore,
    opponentCore,
  }: SetupResult) => {
    setMatch({
      canPause: true,
      seats: [
        { by: 'ai', playerId: HUMAN_ID, difficulty },
        { by: 'ai', playerId: 'p2', difficulty: opponentDifficulty },
      ],
      setups: [
        {
          id: HUMAN_ID,
          name: t('spectate.blue'),
          color: PLAYER_COLOR,
          coreRegionId: playerCore,
          aiDifficulty: difficulty,
        },
        {
          id: 'p2',
          name: t('spectate.red'),
          color: OPPONENT_COLOR,
          coreRegionId: opponentCore,
          aiDifficulty: opponentDifficulty,
        },
      ],
    });
    setMatchKey((k) => k + 1);
    setScreen('game');
  };

  // A networked match: the lobby has already agreed the board and who is
  // who, so there is nothing left to decide here.
  const beginPvp = ({ setups, seats, role, connection, opponentId, chat }: PvpMatch) => {
    setMatch({
      // Nobody can stop a clock the other end is also watching.
      canPause: false,
      seats,
      setups,
      net: { role, connection, opponentId, chat },
    });
    setMatchKey((k) => k + 1);
    setScreen('game');
  };

  /**
   * Walking back into a match this tab was in before it was reloaded
   * (docs 15.8).
   *
   * The host rebuilds the world by replaying what everybody did — the same
   * operation as watching a replay, stopped at the end and carried on from
   * instead of watched. The guest rebuilds nothing: it never held the match,
   * so it rejoins the room and the next snapshot tells it everything.
   *
   * Neither asks first. The alternative is a dialogue about whether to
   * continue while the other player stands in a field waiting.
   */
  /**
   * Taking the controls of a match that already happened (docs 16).
   *
   * The world is already there — the replay has been stepped to wherever the
   * player stopped it — so this is only a question of who is driving from
   * here. Whoever they take over becomes theirs, and every other seat becomes
   * a machine: the people who played the original are not here, and the point
   * of stopping at this moment is usually to find out whether it could have
   * gone differently.
   */
  const takeOver = (replay: Replay) => {
    const mine =
      replay.recording.seats.find((seat) => seat.by === 'human')?.playerId ??
      replay.recording.setups[0].id;
    setMatch({
      canPause: true,
      setups: replay.recording.setups,
      seats: replay.recording.seats.map((seat) =>
        seat.playerId === mine
          ? { by: 'human', playerId: mine }
          : { by: 'ai', playerId: seat.playerId, difficulty: seatDifficulty(seat) },
      ),
      resumed: { engine: replay.engine, steps: replay.step },
    });
    setMatchKey((k) => k + 1);
  };

  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const saved = resumableMatch();
    if (!saved) return;

    const connection =
      saved.role === 'host' && saved.token
        ? new Connection({ code: saved.code, token: saved.token })
        : new Connection({ code: saved.code });

    let resumed: MatchConfig['resumed'];
    if (saved.role === 'host' && saved.recording) {
      const replay = new Replay(saved.recording);
      resumed = { engine: replay.runToEnd(), steps: replay.step, recording: saved.recording };
    }

    setMatch({
      canPause: false,
      seats: saved.seats,
      setups: saved.setups,
      // The conversation does not survive a reload. It was never written
      // down, and putting somebody else's words in storage to be recovered
      // later is a different decision from remembering where you were.
      net: { role: saved.role, connection, opponentId: saved.opponentId, chat: new ChatLog() },
      resumed,
    });
    setMatchKey((k) => k + 1);
    setScreen('game');
  }, []);

  switch (screen) {
    case 'menu':
      return (
        <MainMenu
          onStart={() => setScreen('mode')}
          onSettings={() => setScreen('settings')}
          onHelp={() => setScreen('help')}
          onReplays={() => setScreen('replays')}
        />
      );
    case 'mode':
      return (
        <ModeSelect
          onPvp={() => setScreen('pvp')}
          onPve={() => setScreen('pve')}
          onSpectate={() => setScreen('spectate')}
          onBack={() => setScreen('menu')}
        />
      );
    case 'pvp':
      return (
        <PvpLobby
          playerColor={PLAYER_COLOR}
          opponentColor={OPPONENT_COLOR}
          hostName={t('pvp.hostSide')}
          guestName={t('pvp.guestSide')}
          onBegin={beginPvp}
          onBack={() => setScreen('mode')}
        />
      );
    case 'pve':
      return (
        <PveSetup
          playerColor={PLAYER_COLOR}
          opponentColor={OPPONENT_COLOR}
          onBegin={beginPve}
          onBack={() => setScreen('mode')}
        />
      );
    case 'spectate':
      return (
        <PveSetup
          spectate
          playerColor={PLAYER_COLOR}
          opponentColor={OPPONENT_COLOR}
          onBegin={beginSpectate}
          onBack={() => setScreen('mode')}
        />
      );
    case 'settings':
      return <SettingsScreen onBack={() => setScreen('menu')} />;
    case 'replays':
      return (
        <ReplayList
          onWatch={(recording: Recording) => {
            const replay = new Replay(recording);
            setMatch({
              canPause: true,
              // Nobody here is playing: a replay is watched, and the spectate
              // view is exactly the view for that (docs 13.2).
              seats: recording.seats.map((seat) =>
                seat.by === 'human' ? { by: 'remote', playerId: seat.playerId } : seat,
              ),
              setups: recording.setups,
              replay,
            });
            setMatchKey((k) => k + 1);
            setScreen('game');
          }}
          onBack={() => setScreen('menu')}
        />
      );
    case 'help':
      return <HelpScreen onBack={() => setScreen('menu')} />;
    case 'game':
      return match ? (
        <GameScreen
          key={matchKey}
          setups={match.setups}
          seats={match.seats}
          canPause={match.canPause}
          net={match.net}
          replay={match.replay}
          resumed={match.resumed}
          onTakeOver={match.replay ? () => takeOver(match.replay!) : undefined}
          onQuit={() => {
            match.net?.connection.close();
            // Walking out is not something to be walked back into.
            forgetMatch();
            setScreen('menu');
          }}
          onPlayAgain={() => setMatchKey((k) => k + 1)}
        />
      ) : null;
  }
}

export default function App() {
  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
}
