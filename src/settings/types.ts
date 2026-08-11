export type Language = 'zh-TW' | 'zh-CN' | 'en';
export type Theme = 'dark' | 'darkBlue' | 'light';
export type FontScale = 'small' | 'medium' | 'large';

export interface Settings {
  language: Language;
  theme: Theme;
  fontScale: FontScale;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'zh-TW',
  theme: 'dark',
  fontScale: 'medium',
};

export const FONT_SCALE_VALUES: Record<FontScale, number> = {
  small: 0.875,
  medium: 1,
  large: 1.2,
};

export interface ThemeColors {
  bg: string;
  surface: string;
  border: string;
  text: string;
  textDim: string;
  mapBg: string;
  neutralRegion: string;
  regionStroke: string;
}

export const THEMES: Record<Theme, ThemeColors> = {
  dark: {
    bg: '#101010',
    surface: '#1c1c1c',
    border: '#333',
    text: '#eee',
    textDim: '#888',
    mapBg: '#101010',
    neutralRegion: '#3a3a3a',
    regionStroke: '#8a8a8a',
  },
  darkBlue: {
    bg: '#0d1420',
    surface: '#16202f',
    border: '#28364a',
    text: '#e6edf5',
    textDim: '#7d8da0',
    mapBg: '#0d1420',
    neutralRegion: '#2c3a4e',
    regionStroke: '#7d8da0',
  },
  light: {
    bg: '#eceff3',
    surface: '#ffffff',
    border: '#c9d0d9',
    text: '#1b2129',
    textDim: '#5f6b7a',
    mapBg: '#dfe4ea',
    neutralRegion: '#b8c1cc',
    regionStroke: '#6b7684',
  },
};
