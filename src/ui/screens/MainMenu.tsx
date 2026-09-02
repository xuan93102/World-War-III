import { useSettings } from '../../settings/useSettings';
import { GlobeSilhouette } from '../GlobeSilhouette';

interface MainMenuProps {
  onStart: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onReplays: () => void;
}

export function MainMenu({ onStart, onSettings, onHelp, onReplays }: MainMenuProps) {
  const { t } = useSettings();
  return (
    <div className="screen screen-centered screen-hero">
      <GlobeSilhouette />
      <div className="title-block">
        <h1 className="game-title">{t('game.title')}</h1>
        <p className="game-tagline">{t('menu.tagline')}</p>
      </div>
      <div className="menu-buttons">
        <button className="btn btn-primary btn-lg" onClick={onStart}>
          {t('menu.start')}
        </button>
        <button className="btn btn-lg" onClick={onSettings}>
          {t('menu.settings')}
        </button>
        <button className="btn btn-lg" onClick={onReplays}>
          {t('menu.replays')}
        </button>
        <button className="btn btn-lg" onClick={onHelp}>
          {t('menu.help')}
        </button>
      </div>
    </div>
  );
}
