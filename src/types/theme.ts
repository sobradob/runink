export interface ThemeColors {
  background: string;
  water: string;
  land: string;
  parks: string;
  buildings: string;
  roads: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  rail: string;
  text: string;
  textSecondary: string;
}

export interface RunPathColors {
  core: string;
  glow: string;
  compilation: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  runPath: RunPathColors;
}
