import { useCallback, useEffect, useMemo, useState } from 'react';
import { TRANSLATIONS, type TranslationKey } from './translations';
import { DEFAULT_SETTINGS, FONT_SCALE_VALUES, MAP_TILT, THEMES, type Settings } from './types';
import { SettingsContext } from './useSettings';

const STORAGE_KEY = 'ww3.settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge over defaults so a stored blob from an older version (or one with
    // a value we no longer support) can't leave the app in a broken state.
    return {
      language: parsed.language && parsed.language in TRANSLATIONS ? parsed.language : DEFAULT_SETTINGS.language,
      theme: parsed.theme && parsed.theme in THEMES ? parsed.theme : DEFAULT_SETTINGS.theme,
      fontScale:
        parsed.fontScale && parsed.fontScale in FONT_SCALE_VALUES
          ? parsed.fontScale
          : DEFAULT_SETTINGS.fontScale,
      mapMode: parsed.mapMode && parsed.mapMode in MAP_TILT ? parsed.mapMode : DEFAULT_SETTINGS.mapMode,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage can be unavailable (private mode, quota) — settings just
      // won't persist across reloads, which shouldn't break the session.
    }
  }, [settings]);

  // Theme + font scale are pushed to CSS custom properties on :root so plain
  // CSS can consume them, instead of every component reading the context.
  useEffect(() => {
    const colors = THEMES[settings.theme];
    const root = document.documentElement;
    root.style.setProperty('--bg', colors.bg);
    root.style.setProperty('--surface', colors.surface);
    root.style.setProperty('--border', colors.border);
    root.style.setProperty('--text', colors.text);
    root.style.setProperty('--text-dim', colors.textDim);
    root.style.setProperty('--map-bg', colors.mapBg);
    root.style.setProperty('--font-scale', String(FONT_SCALE_VALUES[settings.fontScale]));
    root.lang = settings.language;
  }, [settings.theme, settings.fontScale, settings.language]);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetSettings = useCallback(() => setSettingsState(DEFAULT_SETTINGS), []);

  const t = useCallback(
    (key: TranslationKey) => TRANSLATIONS[settings.language][key] ?? key,
    [settings.language],
  );

  const value = useMemo(
    () => ({ settings, setSettings, resetSettings, t }),
    [settings, setSettings, resetSettings, t],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
