export type StartupThemeStyleId = "default" | "classic" | "glass";
export type StartupThemeColorId = "light" | "dark" | "warm" | "forest" | "aurora" | "sunset" | "ocean";

export type StartupThemeSnapshot = {
  readonly styleId: StartupThemeStyleId;
  readonly colorId: StartupThemeColorId;
  readonly backgroundColor: string;
  readonly shellColor: string;
  readonly borderColor: string;
  readonly textColor: string;
  readonly mainWindow: {
    readonly width: number;
    readonly height: number;
  };
};

export const STARTUP_THEME_STYLE_STORAGE_KEY = "agentarbor:style";
export const STARTUP_THEME_COLOR_STORAGE_KEY = "agentarbor:color";
export const DEFAULT_STARTUP_THEME_STYLE_ID: StartupThemeStyleId = "default";
export const DEFAULT_STARTUP_THEME_COLOR_ID: StartupThemeColorId = "light";

const STARTUP_STYLE_DEFAULT_COLORS: Record<StartupThemeStyleId, StartupThemeColorId> = {
  default: "light",
  classic: "warm",
  glass: "aurora",
};

export const STARTUP_MAIN_WINDOW_WIDTH = 1440;
export const STARTUP_MAIN_WINDOW_HEIGHT = 960;

const STARTUP_THEME_COLORS: Record<
  StartupThemeColorId,
  Omit<StartupThemeSnapshot, "styleId" | "colorId" | "mainWindow">
> = {
  light: {
    backgroundColor: "#f5f7fa",
    shellColor: "#ffffff",
    borderColor: "#b8c5d6",
    textColor: "#18212f",
  },
  dark: {
    backgroundColor: "#0f131a",
    shellColor: "#151a22",
    borderColor: "#3a4656",
    textColor: "#e7edf7",
  },
  warm: {
    backgroundColor: "#f1eee7",
    shellColor: "#faf7f0",
    borderColor: "#cdbfae",
    textColor: "#342923",
  },
  forest: {
    backgroundColor: "#eef2ec",
    shellColor: "#fbfcf8",
    borderColor: "#b9c7b7",
    textColor: "#203027",
  },
  aurora: {
    backgroundColor: "#edf7ff",
    shellColor: "#f7fbff",
    borderColor: "#b7cee5",
    textColor: "#172033",
  },
  sunset: {
    backgroundColor: "#fff1e8",
    shellColor: "#fff8f2",
    borderColor: "#e2bfa9",
    textColor: "#2c211c",
  },
  ocean: {
    backgroundColor: "#eaf8fb",
    shellColor: "#f5fcfd",
    borderColor: "#aacdd6",
    textColor: "#132833",
  },
};

export function normalizeStartupTheme(
  styleId: string | undefined,
  colorId: string | undefined
): Pick<StartupThemeSnapshot, "styleId" | "colorId"> {
  const normalizedStyleId = isStartupThemeStyleId(styleId) ? styleId : DEFAULT_STARTUP_THEME_STYLE_ID;
  const normalizedColorId = isStartupThemeColorId(colorId) && isStartupThemeColorForStyle(colorId, normalizedStyleId)
    ? colorId
    : STARTUP_STYLE_DEFAULT_COLORS[normalizedStyleId];
  return {
    styleId: normalizedStyleId,
    colorId: normalizedColorId,
  };
}

export function createStartupThemeSnapshot(
  styleId: string | undefined,
  colorId: string | undefined
): StartupThemeSnapshot {
  const normalized = normalizeStartupTheme(styleId, colorId);
  return {
    ...normalized,
    ...STARTUP_THEME_COLORS[normalized.colorId],
    mainWindow: {
      width: STARTUP_MAIN_WINDOW_WIDTH,
      height: STARTUP_MAIN_WINDOW_HEIGHT,
    },
  };
}

function isStartupThemeStyleId(value: string | undefined): value is StartupThemeStyleId {
  return value === "default" || value === "classic" || value === "glass";
}

function isStartupThemeColorId(value: string | undefined): value is StartupThemeColorId {
  return (
    value === "light" ||
    value === "dark" ||
    value === "warm" ||
    value === "forest" ||
    value === "aurora" ||
    value === "sunset" ||
    value === "ocean"
  );
}

function isStartupThemeColorForStyle(colorId: StartupThemeColorId, styleId: StartupThemeStyleId): boolean {
  if (styleId === "default") return colorId === "light" || colorId === "dark";
  if (styleId === "classic") return colorId === "warm" || colorId === "forest";
  return colorId === "aurora" || colorId === "sunset" || colorId === "ocean";
}
