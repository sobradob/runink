import type { Theme } from '@/types/theme';
import themesData from '@/data/themes.json';

const themes: Theme[] = themesData as Theme[];

export function getAllThemes(): Theme[] {
  return themes;
}

export function getThemeById(id: string): Theme {
  const theme = themes.find((t) => t.id === id);
  if (!theme) return themes[0];
  return theme;
}

export function getDefaultTheme(): Theme {
  return themes[0]; // noir
}
