import { useSettings } from '../../settings/useSettings';
import type { TranslationKey } from '../../settings/translations';
import type { FontScale, Language, MapMode, Theme } from '../../settings/types';

interface SettingsScreenProps {
  onBack: () => void;
}

const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en', label: 'English' },
];

const THEME_OPTIONS: { id: Theme; labelKey: TranslationKey }[] = [
  { id: 'dark', labelKey: 'settings.theme.dark' },
  { id: 'darkBlue', labelKey: 'settings.theme.darkBlue' },
  { id: 'light', labelKey: 'settings.theme.light' },
];

const MAP_MODE_OPTIONS: { id: MapMode; labelKey: TranslationKey }[] = [
  { id: '2d', labelKey: 'settings.mapMode.2d' },
  { id: '3d', labelKey: 'settings.mapMode.3d' },
];

const FONT_OPTIONS: { id: FontScale; labelKey: TranslationKey }[] = [
  { id: 'small', labelKey: 'settings.fontScale.small' },
  { id: 'medium', labelKey: 'settings.fontScale.medium' },
  { id: 'large', labelKey: 'settings.fontScale.large' },
];

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const { settings, setSettings, resetSettings, t } = useSettings();

  return (
    <div className="screen screen-centered">
      <h2 className="screen-title">{t('settings.title')}</h2>

      <div className="panel">
        <div className="field-label">{t('settings.language')}</div>
        <div className="segmented">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              className={settings.language === l.id ? 'is-selected' : undefined}
              aria-pressed={settings.language === l.id}
              onClick={() => setSettings({ language: l.id })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="field-label">{t('settings.theme')}</div>
        <div className="segmented">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={settings.theme === o.id ? 'is-selected' : undefined}
              aria-pressed={settings.theme === o.id}
              onClick={() => setSettings({ theme: o.id })}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="field-label">{t('settings.mapMode')}</div>
        <div className="segmented">
          {MAP_MODE_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={settings.mapMode === o.id ? 'is-selected' : undefined}
              aria-pressed={settings.mapMode === o.id}
              onClick={() => setSettings({ mapMode: o.id })}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
        <p className="hint-text">{t('settings.mapMode.hint')}</p>
      </div>

      <div className="panel">
        <div className="field-label">{t('settings.fontScale')}</div>
        <div className="segmented">
          {FONT_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={settings.fontScale === o.id ? 'is-selected' : undefined}
              aria-pressed={settings.fontScale === o.id}
              onClick={() => setSettings({ fontScale: o.id })}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="button-row">
        <button className="btn btn-ghost" onClick={onBack}>
          {t('menu.back')}
        </button>
        <button className="btn" onClick={resetSettings}>
          {t('settings.reset')}
        </button>
      </div>
    </div>
  );
}
