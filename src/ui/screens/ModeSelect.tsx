import { useSettings } from '../../settings/useSettings';

interface ModeSelectProps {
  onPvp: () => void;
  onPve: () => void;
  onBack: () => void;
}

export function ModeSelect({ onPvp, onPve, onBack }: ModeSelectProps) {
  const { t } = useSettings();
  return (
    <div className="screen screen-centered">
      <h2 className="screen-title">{t('mode.title')}</h2>
      <div className="card-list">
        <button className="card-option" onClick={onPve}>
          <span className="card-option-title">{t('mode.pve')}</span>
          <span className="card-option-desc">{t('mode.pveDesc')}</span>
        </button>
        <button className="card-option" onClick={onPvp}>
          <span className="card-option-title">{t('mode.pvp')}</span>
          <span className="card-option-desc">{t('mode.pvpDesc')}</span>
        </button>
      </div>
      <button className="btn btn-ghost" onClick={onBack}>
        {t('menu.back')}
      </button>
    </div>
  );
}
