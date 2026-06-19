/**
 * Panel theme system.
 *
 * Themes have two independent axes:
 * - style: the structural visual language
 * - color: the palette available inside that style
 */

export type StyleDefinition = {
  readonly id: ThemeStyleId;
  readonly label: string;
  readonly defaultColorId: ThemeColorId;
};

export type ThemeStyleId = "default" | "classic" | "glass";
export type ThemeColorId = "light" | "dark" | "warm" | "forest" | "aurora" | "sunset" | "ocean";

export const STYLE_REGISTRY: readonly StyleDefinition[] = [
  {
    id: "default",
    label: "经典",
    defaultColorId: "light",
  },
  {
    id: "classic",
    label: "纸页",
    defaultColorId: "warm",
  },
  {
    id: "glass",
    label: "液态玻璃",
    defaultColorId: "aurora",
  },
];

export type ColorSwatch = {
  readonly label: string;
  readonly value: string;
};

export type ColorSchemeDefinition = {
  readonly id: ThemeColorId;
  readonly styleId: ThemeStyleId;
  readonly label: string;
  readonly swatches: readonly ColorSwatch[];
};

export const COLOR_REGISTRY: readonly ColorSchemeDefinition[] = [
  /* Default palettes */
  {
    id: "light",
    styleId: "default",
    label: "浅色",
    swatches: [
      { label: "背景", value: "#f7f8fa" },
      { label: "主色", value: "#2563eb" },
      { label: "辅色", value: "#14b8a6" },
    ],
  },
  {
    id: "dark",
    styleId: "default",
    label: "深色",
    swatches: [
      { label: "背景", value: "#101318" },
      { label: "主色", value: "#60a5fa" },
      { label: "辅色", value: "#2dd4bf" },
    ],
  },
  /* Classic palettes */
  {
    id: "warm",
    styleId: "classic",
    label: "晨纸",
    swatches: [
      { label: "背景", value: "#f1eee7" },
      { label: "主色", value: "#b85f2a" },
      { label: "辅色", value: "#1f7469" },
    ],
  },
  {
    id: "forest",
    styleId: "classic",
    label: "青苔",
    swatches: [
      { label: "背景", value: "#eef2ec" },
      { label: "主色", value: "#216f5d" },
      { label: "辅色", value: "#a06b2c" },
    ],
  },
  /* Glass palettes */
  {
    id: "aurora",
    styleId: "glass",
    label: "极幕",
    swatches: [
      { label: "背景", value: "#edf7ff" },
      { label: "主色", value: "#775cff" },
      { label: "辅色", value: "#12b8ae" },
    ],
  },
  {
    id: "sunset",
    styleId: "glass",
    label: "暮霞",
    swatches: [
      { label: "背景", value: "#fff1e8" },
      { label: "主色", value: "#d86431" },
      { label: "辅色", value: "#d45c8d" },
    ],
  },
  {
    id: "ocean",
    styleId: "glass",
    label: "海窗",
    swatches: [
      { label: "背景", value: "#eaf8fb" },
      { label: "主色", value: "#1198ad" },
      { label: "辅色", value: "#5a77e6" },
    ],
  },
];

export const DEFAULT_STYLE_ID: ThemeStyleId = "default";
export const DEFAULT_COLOR_ID: ThemeColorId = "light";
export const STORAGE_STYLE_KEY = "agentarbor:style";
export const STORAGE_COLOR_KEY = "agentarbor:color";
const THEME_SWITCHING_CLASS = "theme-switching";
const THEME_SWITCHING_DURATION_MS = 260;

let themeSwitchingTimer: number | undefined;

function shouldUseThemeSwitchMotion(): boolean {
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Return color schemes available for a given style. */
export function getColorSchemesForStyle(styleId: string): readonly ColorSchemeDefinition[] {
  return COLOR_REGISTRY.filter((c) => c.styleId === styleId);
}

/** Return the default color id for a given style. */
export function getDefaultColorForStyle(styleId: string): ThemeColorId {
  const style = STYLE_REGISTRY.find((candidate) => candidate.id === styleId);
  if (style !== undefined) return style.defaultColorId;
  return DEFAULT_COLOR_ID;
}

/** Validate that a style id exists. */
export function isValidStyle(styleId: string): styleId is ThemeStyleId {
  return STYLE_REGISTRY.some((s) => s.id === styleId);
}

/** Validate that a color id exists (optionally scoped to a style). */
export function isValidColor(colorId: string, styleId?: string): colorId is ThemeColorId {
  return COLOR_REGISTRY.some(
    (c) => c.id === colorId && (styleId === undefined || c.styleId === styleId),
  );
}

export type AppliedTheme = {
  readonly styleId: ThemeStyleId;
  readonly colorId: ThemeColorId;
};

export function normalizeTheme(styleId: string | undefined, colorId: string | undefined): AppliedTheme {
  const normalizedStyleId = styleId !== undefined && isValidStyle(styleId) ? styleId : DEFAULT_STYLE_ID;
  const normalizedColorId = colorId !== undefined && isValidColor(colorId, normalizedStyleId)
    ? colorId
    : getDefaultColorForStyle(normalizedStyleId);
  return {
    styleId: normalizedStyleId,
    colorId: normalizedColorId,
  };
}

/** Apply style by setting [data-style] on <html>. */
export function applyStyle(styleId: string): AppliedTheme {
  const currentColorId = typeof document === "undefined"
    ? undefined
    : document.documentElement.getAttribute("data-color") ?? undefined;
  return applyTheme(styleId, currentColorId);
}

/** Apply color by setting [data-color] on <html>. */
export function applyColor(colorId: string): AppliedTheme {
  const currentStyleId = typeof document === "undefined"
    ? undefined
    : document.documentElement.getAttribute("data-style") ?? undefined;
  return applyTheme(currentStyleId, colorId);
}

/** Apply both style and color at once. */
export function applyTheme(styleId: string | undefined, colorId: string | undefined): AppliedTheme {
  const theme = normalizeTheme(styleId, colorId);
  if (typeof document === "undefined") return theme;

  const root = document.documentElement;
  const previousStyleId = root.getAttribute("data-style");
  const previousColorId = root.getAttribute("data-color");
  const hasAppliedTheme = previousStyleId !== null && previousColorId !== null;
  const isChanged = previousStyleId !== theme.styleId || previousColorId !== theme.colorId;
  const shouldTransition = hasAppliedTheme && isChanged && shouldUseThemeSwitchMotion();

  if (themeSwitchingTimer !== undefined) {
    window.clearTimeout(themeSwitchingTimer);
    themeSwitchingTimer = undefined;
  }

  if (shouldTransition) {
    root.classList.add(THEME_SWITCHING_CLASS);
  } else {
    root.classList.remove(THEME_SWITCHING_CLASS);
  }

  root.setAttribute("data-style", theme.styleId);
  root.setAttribute("data-color", theme.colorId);

  if (shouldTransition) {
    themeSwitchingTimer = window.setTimeout(() => {
      root.classList.remove(THEME_SWITCHING_CLASS);
      themeSwitchingTimer = undefined;
    }, THEME_SWITCHING_DURATION_MS);
  }

  return theme;
}

/** Read saved style id from localStorage. */
export function getSavedStyleId(): ThemeStyleId | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const value = localStorage.getItem(STORAGE_STYLE_KEY);
    if (value !== null && isValidStyle(value)) return value;
  } catch {
    // localStorage may be blocked
  }
  return undefined;
}

/** Read saved color id from localStorage. */
export function getSavedColorId(): ThemeColorId | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const value = localStorage.getItem(STORAGE_COLOR_KEY);
    if (value !== null && isValidColor(value)) return value;
  } catch {
    // localStorage may be blocked
  }
  return undefined;
}

/** Persist style id. */
export function saveStyleId(styleId: string): void {
  if (!isValidStyle(styleId) || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_STYLE_KEY, styleId);
  } catch {
    // Silently ignore
  }
}

/** Persist color id. */
export function saveColorId(colorId: string): void {
  if (!isValidColor(colorId) || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_COLOR_KEY, colorId);
  } catch {
    // Silently ignore
  }
}

/** Return the initial style + color to use on startup. */
export function getInitialTheme(): AppliedTheme {
  return normalizeTheme(getSavedStyleId(), getSavedColorId());
}
