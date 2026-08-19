import { useState } from 'react';
import './App.css';
import type { PlayerSetup } from './engine/GameEngine';
import type { AiDifficulty } from './engine/types';
import { SettingsProvider } from './settings/SettingsContext';
import { useSettings } from './settings/useSettings';
import { GameScreen } from './ui/screens/GameScreen';
import { HelpScreen } from './ui/screens/HelpScreen';
import { MainMenu } from './ui/screens/MainMenu';
import { ModeSelect } from './ui/screens/ModeSelect';
import { PveSetup } from './ui/screens/PveSetup';
import { PvpLobby } from './ui/screens/PvpLobby';
import { SettingsScreen } from './ui/screens/SettingsScreen';

type Screen = 'menu' | 'mode' | 'pvp' | 'pve' | 'spectate' | 'settings' | 'help' | 'game';

const PLAYER_COLOR = '#4f8ef7';
const OPPONENT_COLOR = '#e0524a';
const HUMAN_ID = 'p1';

interface MatchConfig {
  setups: PlayerSetup[];
  canPause: boolean;
  /** null when nobody is playing — both seats are machines and we watch. */
  humanPlayerId: string | null;
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
      humanPlayerId: HUMAN_ID,
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
      humanPlayerId: null,
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

  switch (screen) {
    case 'menu':
      return (
        <MainMenu
          onStart={() => setScreen('mode')}
          onSettings={() => setScreen('settings')}
          onHelp={() => setScreen('help')}
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
      return <PvpLobby onBack={() => setScreen('mode')} />;
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
    case 'help':
      return <HelpScreen onBack={() => setScreen('menu')} />;
    case 'game':
      return match ? (
        <GameScreen
          key={matchKey}
          setups={match.setups}
          humanPlayerId={match.humanPlayerId}
          canPause={match.canPause}
          onQuit={() => setScreen('menu')}
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
