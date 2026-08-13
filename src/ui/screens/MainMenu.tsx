import { useSettings } from '../../settings/useSettings';

interface MainMenuProps {
  onStart: () => void;
  onSettings: () => void;
  onHelp: () => void;
}

export function MainMenu({ onStart, onSettings, onHelp }: MainMenuProps) {
  const { t } = useSettings();
  return (
    <div className="screen screen-centered">
      <div className="title-block">
        <h1 className="game-title">{t('game.title')}</h1>
      </div>
      <div className="menu-buttons">
        <button className="btn btn-primary btn-lg" onClick={onStart}>
          {t('menu.start')}
        </button>
        <button className="btn btn-lg" onClick={onSettings}>
          {t('menu.settings')}
        </button>
        <button className="btn btn-lg" onClick={onHelp}>
          {t('menu.help')}
        </button>
      </div>
    </div>
  );
}
