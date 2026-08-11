import { useSettings } from '../../settings/useSettings';

interface HelpScreenProps {
  onBack: () => void;
}

export function HelpScreen({ onBack }: HelpScreenProps) {
  const { t } = useSettings();
  return (
    <div className="screen screen-centered">
      <h2 className="screen-title">{t('help.title')}</h2>

      <div className="panel">
        <div className="field-label">{t('help.map')}</div>
        <ul className="help-list">
          <li>{t('help.mapPan')}</li>
          <li>{t('help.mapZoom')}</li>
          <li>{t('help.mapRotate')}</li>
          <li>{t('help.mapReset')}</li>
          <li>{t('help.mapLabels')}</li>
        </ul>
      </div>

      <div className="panel">
        <div className="field-label">{t('help.rules')}</div>
        <ul className="help-list">
          <li>{t('help.rulesCore')}</li>
          <li>{t('help.rulesResource')}</li>
          <li>{t('help.rulesMountain')}</li>
        </ul>
      </div>

      <p className="notice">{t('help.wip')}</p>

      <button className="btn btn-ghost" onClick={onBack}>
        {t('menu.back')}
      </button>
    </div>
  );
}
