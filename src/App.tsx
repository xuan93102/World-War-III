import { useState } from 'react';
import './App.css';
import type { PlayerSetup } from './engine/GameEngine';
import type { AiDifficulty } from './engine/types';
import type { Seat } from './match/seats';
import type { Connection } from './match/connection';
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

const PLAYER_COLOR = '#4f8ef7';
const OPPONENT_COLOR = '#e0524a';
const HUMAN_ID = 'p1';

interface MatchConfig {
  setups: PlayerSetup[];
  canPause: boolean;
  /** Who drives each side (docs 15.4). No human seat means we're watching. */
  seats: Seat[];
  /** Present when somebody in this match is on another machine. */
  net?: { role: 'host' | 'guest'; connection: Connection; opponentId: string };
  /** Present when watching a match back rather than playing one (docs 16). */
  replay?: Replay;
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
  const beginPvp = ({ setups, seats, role, connection, opponentId }: PvpMatch) => {
    setMatch({
      // Nobody can stop a clock the other end is also watching.
      canPause: false,
      seats,
      setups,
      net: { role, connection, opponentId },
    });
    setMatchKey((k) => k + 1);
    setScreen('game');
  };

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
          onQuit={() => {
            match.net?.connection.close();
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
