const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

type DesktopStartupWindowExpansion = {
  readonly durationMs: number;
  readonly nativeExpanded: boolean;
  readonly startupRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly targetWindow: {
    readonly width: number;
    readonly height: number;
  };
};

type DesktopStartupWindowExpansionOptions = {
  readonly reducedMotion?: boolean;
};

type DesktopStartupWindowBeginResult = {
  readonly started: boolean;
  readonly durationMs: number;
};

type DesktopStartupRendererFrameStats = {
  readonly frameCount: number;
  readonly maxFrameMs: number;
  readonly maxFrameAtMs: number;
  readonly averageFrameMs: number;
  readonly totalMs: number;
  readonly visual?: DesktopStartupRendererVisualStats;
};

type DesktopStartupRendererVisualStats = {
  readonly sampleCount: number;
  readonly shellNodeMax: number;
  readonly missingOverlayCount: number;
  readonly missingFrameCount: number;
  readonly missingTextCount: number;
  readonly duplicateHeadingVisibleCount: number;
  readonly visibleChromeDuringExpansionCount: number;
  readonly overlayBackgroundOpaqueCount: number;
  readonly seenExpandingOpaqueSurface: boolean;
  readonly seenExpandingTransparentSurface: boolean;
  readonly titleHandoffSampleCount: number;
  readonly titleHandoffOpaqueSurfaceCount: number;
  readonly titleHandoffMaxCenterErrorPx: number;
  readonly titleHandoffMaxSizeErrorPx: number;
  readonly titleHandoffMinCenterErrorPx: number;
  readonly titleHandoffLastCenterErrorPx: number;
  readonly titleHandoffLastSizeErrorPx: number;
};

type DesktopStartupThemeSnapshot = {
  readonly styleId: "default" | "classic" | "glass";
  readonly colorId: "system" | "light" | "dark" | "warm" | "forest" | "slate" | "aurora" | "sunset" | "ocean";
  readonly backgroundColor: string;
  readonly shellColor: string;
  readonly borderColor: string;
  readonly textColor: string;
  readonly mainWindow: {
    readonly width: number;
    readonly height: number;
  };
};

type DesktopWindowPresentationState = {
  readonly maximized: boolean;
  readonly animating: boolean;
};

const STARTUP_THEME_STYLE_STORAGE_KEY = "agentarbor:style";
const STARTUP_THEME_COLOR_STORAGE_KEY = "agentarbor:color";

contextBridge.exposeInMainWorld("agentarborDesktop", {
  getStartupThemeSnapshot: (): DesktopStartupThemeSnapshot => {
    return readDesktopStartupThemeSnapshot();
  },
  expandStartupWindow: (options?: DesktopStartupWindowExpansionOptions) => {
    return ipcRenderer.invoke("agentarbor:startup-window-expand", options) as Promise<DesktopStartupWindowExpansion>;
  },
  beginStartupWindowExpansion: () => {
    return ipcRenderer.invoke("agentarbor:startup-window-begin-expand") as Promise<DesktopStartupWindowBeginResult>;
  },
  notifyStartupOverlayReady: () => {
    ipcRenderer.send("agentarbor:startup-overlay-ready");
  },
  notifyStartupMainReady: () => {
    ipcRenderer.send("agentarbor:startup-main-ready");
  },
  notifyStartupMainHandoffVisible: () => {
    ipcRenderer.send("agentarbor:startup-main-handoff-visible");
  },
  notifyStartupRendererFrameStats: (stats: DesktopStartupRendererFrameStats) => {
    ipcRenderer.send("agentarbor:startup-renderer-frame-stats", stats);
  },
  getWindowState: () => {
    return ipcRenderer.invoke("agentarbor:window-get-state") as Promise<DesktopWindowPresentationState>;
  },
  onWindowStateChanged: (callback: (state: DesktopWindowPresentationState) => void) => {
    const listener: Parameters<typeof ipcRenderer.on>[1] = (_event, payload: unknown) => {
      const state = readDesktopWindowPresentationState(payload);
      if (state !== undefined) {
        callback(state);
      }
    };
    ipcRenderer.on("agentarbor:window-state-changed", listener);
    return () => {
      ipcRenderer.removeListener("agentarbor:window-state-changed", listener);
    };
  },
  minimizeWindow: () => {
    ipcRenderer.send("agentarbor:window-minimize");
  },
  toggleMaximizeWindow: () => {
    ipcRenderer.send("agentarbor:window-toggle-maximize");
  },
  closeWindow: () => {
    ipcRenderer.send("agentarbor:window-close");
  },
});

function readDesktopWindowPresentationState(payload: unknown): DesktopWindowPresentationState | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const candidate = payload as Partial<Record<keyof DesktopWindowPresentationState, unknown>>;
  if (typeof candidate.maximized !== "boolean" || typeof candidate.animating !== "boolean") return undefined;
  return {
    maximized: candidate.maximized,
    animating: candidate.animating,
  };
}

function readDesktopStartupThemeSnapshot(): DesktopStartupThemeSnapshot {
  const styleId = readStorageValue(STARTUP_THEME_STYLE_STORAGE_KEY);
  const colorId = readStorageValue(STARTUP_THEME_COLOR_STORAGE_KEY);
  const normalized = normalizeDesktopStartupTheme(styleId, colorId);
  const resolvedColorId = resolveDesktopStartupColorId(normalized);
  return {
    ...normalized,
    ...STARTUP_THEME_COLORS[resolvedColorId],
    mainWindow: {
      width: STARTUP_MAIN_WINDOW_WIDTH,
      height: STARTUP_MAIN_WINDOW_HEIGHT,
    },
  };
}

function readStorageValue(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function normalizeDesktopStartupTheme(
  styleId: string | undefined,
  colorId: string | undefined
): Pick<DesktopStartupThemeSnapshot, "styleId" | "colorId"> {
  const normalizedStyleId = isDesktopStartupStyleId(styleId) ? styleId : "default";
  const normalizedColorId = isDesktopStartupColorId(colorId) && isDesktopStartupColorForStyle(colorId, normalizedStyleId)
    ? colorId
    : STARTUP_STYLE_DEFAULT_COLORS[normalizedStyleId];
  return {
    styleId: normalizedStyleId,
    colorId: normalizedColorId,
  };
}

function isDesktopStartupStyleId(value: string | undefined): value is DesktopStartupThemeSnapshot["styleId"] {
  return value === "default" || value === "classic" || value === "glass";
}

function isDesktopStartupColorId(value: string | undefined): value is DesktopStartupThemeSnapshot["colorId"] {
  return (
    value === "system" ||
    value === "light" ||
    value === "dark" ||
    value === "warm" ||
    value === "forest" ||
    value === "slate" ||
    value === "aurora" ||
    value === "sunset" ||
    value === "ocean"
  );
}

function isDesktopStartupColorForStyle(
  colorId: DesktopStartupThemeSnapshot["colorId"],
  styleId: DesktopStartupThemeSnapshot["styleId"]
): boolean {
  if (styleId === "default") return colorId === "system" || colorId === "light" || colorId === "dark";
  if (styleId === "classic") return colorId === "warm" || colorId === "forest" || colorId === "slate";
  return colorId === "aurora" || colorId === "sunset" || colorId === "ocean";
}

function resolveDesktopStartupColorId(
  theme: Pick<DesktopStartupThemeSnapshot, "styleId" | "colorId">
): Exclude<DesktopStartupThemeSnapshot["colorId"], "system"> {
  if (theme.styleId === "default" && theme.colorId === "system") {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme.colorId as Exclude<DesktopStartupThemeSnapshot["colorId"], "system">;
}

const STARTUP_STYLE_DEFAULT_COLORS = {
  default: "light",
  classic: "warm",
  glass: "aurora",
} satisfies Record<DesktopStartupThemeSnapshot["styleId"], DesktopStartupThemeSnapshot["colorId"]>;

const STARTUP_MAIN_WINDOW_WIDTH = 1440;
const STARTUP_MAIN_WINDOW_HEIGHT = 960;

const STARTUP_THEME_COLORS = {
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
  slate: {
    backgroundColor: "#eef1f4",
    shellColor: "#fbfcfb",
    borderColor: "#b8c6d3",
    textColor: "#18222c",
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
} satisfies Record<
  Exclude<DesktopStartupThemeSnapshot["colorId"], "system">,
  Omit<DesktopStartupThemeSnapshot, "styleId" | "colorId" | "mainWindow">
>;
