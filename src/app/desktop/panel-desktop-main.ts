import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type Rectangle,
} from "electron";
import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePanelDesktopArgs } from "../panel-server/panel-launch-args.js";
import { createDesktopLocalPreferenceStore, type DesktopLocalPreferenceStore } from "./panel-desktop-local-preferences.js";
import {
  createPanelDesktopWindowOptions,
  startPanelDesktopSession,
  type PanelDesktopSession,
} from "./panel-desktop-launcher.js";
import {
  clearDesktopWindowMaximizeState,
  createDesktopWindowMaximizeState,
  readDesktopWindowPresentationState,
  toggleDesktopWindowMaximize,
  type DesktopWindowPresentationState,
  type DesktopWindowMaximizeState,
} from "./panel-desktop-window-controls.js";
import { startLocalPanelServer } from "../panel-server.js";
import type { AppUpdateServiceLike } from "../app-update/app-update-service.js";
import { createUnsupportedAppUpdateService } from "../app-update/app-update-service.js";
import {
  createElectronAppUpdateService,
  electronAutoUpdaterFromModule,
  type ElectronUpdaterLike,
} from "../app-update/electron-app-update-service.js";

const activeWindows = new Set<BrowserWindow>();
const activeDesktopSessions = new Set<PanelDesktopSession>();
const startupWindowStates = new WeakMap<BrowserWindow, DesktopStartupWindowState>();
const mainWindowStates = new WeakMap<BrowserWindow, DesktopMainWindowState>();
let desktopLocalPreferenceStore: DesktopLocalPreferenceStore | undefined;
let desktopExitCleanup: Promise<void> | undefined;
const startupHandoffFallbackTimers = new WeakMap<BrowserWindow, NodeJS.Timeout>();
const startupNativeControlRestoreTimers = new WeakMap<BrowserWindow, NodeJS.Timeout>();
const STARTUP_WINDOW_EXPAND_CHANNEL = "agentarbor:startup-window-expand";
const STARTUP_WINDOW_BEGIN_EXPAND_CHANNEL = "agentarbor:startup-window-begin-expand";
const STARTUP_ANIMATION_CONSUME_CHANNEL = "agentarbor:startup-animation-consume";
const STARTUP_OVERLAY_READY_CHANNEL = "agentarbor:startup-overlay-ready";
const STARTUP_MAIN_READY_CHANNEL = "agentarbor:startup-main-ready";
const STARTUP_MAIN_HANDOFF_VISIBLE_CHANNEL = "agentarbor:startup-main-handoff-visible";
const STARTUP_RENDERER_FRAME_STATS_CHANNEL = "agentarbor:startup-renderer-frame-stats";
const WINDOW_MINIMIZE_CHANNEL = "agentarbor:window-minimize";
const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = "agentarbor:window-toggle-maximize";
const WINDOW_GET_STATE_CHANNEL = "agentarbor:window-get-state";
const WINDOW_STATE_CHANGED_CHANNEL = "agentarbor:window-state-changed";
const WINDOW_CLOSE_CHANNEL = "agentarbor:window-close";
const LOCAL_PREFERENCE_GET_CHANNEL = "agentarbor:local-preference-get";
const LOCAL_PREFERENCE_SET_CHANNEL = "agentarbor:local-preference-set";
const STARTUP_ANIMATION_PREFERENCE_KEY = "agentarbor:startup-animation";
const AGENTARBOR_APP_ID = "com.agentarbor.desktop";
const AGENTARBOR_APP_NAME = "AgentArbor";
const DESKTOP_WINDOW_MAXIMIZE_ANIMATION_MS = 180;
const STARTUP_WINDOW_EXPAND_MS = 720;
const STARTUP_WINDOW_REDUCED_MOTION_MS = 80;
const STARTUP_WINDOW_RENDERER_SETTLE_MS = 80;
const STARTUP_WINDOW_INITIAL_SHOW_FALLBACK_MS = 1200;
const STARTUP_WINDOW_BOUNDS_FRAME_MS = 16;
const STARTUP_MAIN_HANDOFF_VISIBLE_FALLBACK_MS = 900;
const STARTUP_WINDOW_NATIVE_CONTROL_RESTORE_DELAY_MS = 1000;
const STARTUP_WINDOW_SMOKE_TIMEOUT_MS = 18000;
const STARTUP_WINDOW_SMOKE_MAX_BOUNDS_FRAME_MS = 64;
const STARTUP_WINDOW_SMOKE_MAX_BOUNDS_STEP_PX = 96;
const STARTUP_WINDOW_SMOKE_MAX_CENTER_DRIFT_PX = 1;
const STARTUP_WINDOW_SMOKE_MIN_BOUNDS_FRAMES = 24;
const STARTUP_WINDOW_SMOKE_MAX_RENDERER_FRAME_MS = 64;
const STARTUP_WINDOW_SMOKE_MIN_RENDERER_FRAMES = 30;
const STARTUP_WINDOW_SMOKE_MAX_TITLE_CENTER_ERROR_PX = 3;
const STARTUP_WINDOW_SMOKE_MAX_TITLE_SIZE_ERROR_PX = 2;
let startupWindowExpansionBridgeInstalled = false;
let startupWindowSmokeRequested = false;
let startupWindowSmokeTimeout: NodeJS.Timeout | undefined;
const startupWindowSmokeEvents: string[] = [];
const startupWindowSmokeEventLabels: string[] = [];
let startupWindowSmokeBoundsFrameStats: DesktopStartupWindowBoundsFrameStats | undefined;
let startupWindowSmokeRendererFrameStats: DesktopStartupRendererFrameStats | undefined;

type DesktopStartupWindowExpansionResult = {
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

type DesktopStartupWindowExpansionRequest = {
  readonly reducedMotion?: boolean;
};

type DesktopStartupWindowBeginResult = {
  readonly started: boolean;
  readonly durationMs: number;
};

type DesktopStartupWindowBoundsFrameStats = {
  readonly frameCount: number;
  readonly maxFrameMs: number;
  readonly maxBoundsStepPx: number;
  readonly maxCenterDriftPx: number;
  readonly reverseStepCount: number;
  readonly averageFrameMs: number;
  readonly totalMs: number;
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

type DesktopStartupWindowState = {
  readonly mainWindow: BrowserWindow;
  readonly targetMinWidth: number;
  readonly targetMinHeight: number;
  readonly targetBounds: Rectangle;
  readonly startupBounds: Rectangle;
  handoffRequested: boolean;
  reducedMotion: boolean;
  handoffVisible: boolean;
  handoffCompleted: boolean;
  expansionStarted: boolean;
  expansionFinished: boolean;
  animationConsumed: boolean;
  expansionResult: DesktopStartupWindowExpansionResult | undefined;
  readyToShow: boolean;
  overlayReady: boolean;
  showRequested: boolean;
  showFallbackTimer: NodeJS.Timeout | undefined;
};

type DesktopMainWindowState = {
  readonly startupWindow: BrowserWindow;
  readonly maximizeState: DesktopWindowMaximizeState;
};

// NOTE: 不使用顶层 await，因为 ESM 顶层 await 会阻塞事件循环，
// 导致 app.whenReady() 永远无法 resolve（死锁）。
main().catch((error: unknown) => {
  console.error("AgentArbor 桌面面板启动失败。");
  console.error(error);
  exitDesktopAfterCleanup(1);
});

async function main(): Promise<void> {
  configureDesktopAppIdentity();
  installDesktopLocalPreferenceBridge();
  const args = parsePanelDesktopArgs(process.argv.slice(2));
  startupWindowSmokeRequested = args.windowSmoke;
  scheduleStartupWindowSmokeTimeout();
  let sessionRef: PanelDesktopSession | undefined;
  try {
    const appUpdateService = await createDesktopAppUpdateService();
    const session = await startPanelDesktopSession(args, {
      startPanelServer: startLocalPanelServer,
      createWindow: (options) => createElectronPanelWindow({
        ...options,
        startupAnimationEnabled: readStartupAnimationPreference(),
      }),
      appUpdateService,
      selectWorkspaceDirectory: selectWorkspaceDirectory,
      selectContextAttachment: selectContextAttachment,
      whenReady: app.whenReady(),
      onWindowAllClosed: (handler) => {
        app.on("window-all-closed", () => {
          void handler();
        });
      },
      onBeforeQuit: (handler) => {
        let cleanupStarted = false;
        let cleanupComplete = false;
        app.on("before-quit", (event) => {
          if (cleanupComplete) {
            return;
          }
          event.preventDefault();
          if (cleanupStarted) {
            return;
          }
          cleanupStarted = true;
          void handler()
            .catch((error: unknown) => {
              console.error("关闭桌面面板服务器失败。");
              console.error(error);
            })
            .finally(() => {
              cleanupComplete = true;
              app.quit();
            });
        });
      },
      onSessionClosed: () => {
        if (sessionRef !== undefined) {
          activeDesktopSessions.delete(sessionRef);
          sessionRef = undefined;
        }
      },
      quit: () => {
        app.quit();
      },
    });
    sessionRef = session;

    if (!args.smoke) {
      activeDesktopSessions.add(session);
      if (args.devUrl === undefined && !args.windowSmoke) {
        void appUpdateService.check().catch((error: unknown) => {
          console.error("自动更新检查失败。");
          console.error(error);
        });
      }
    }

    console.log(`AgentArbor 本地桌面面板：${session.url}`);
    if (session.configDirectory !== undefined) {
      console.log(`配置目录：${session.configDirectory}`);
    }
  } catch (error) {
    clearStartupWindowSmokeTimeout();
    console.error("AgentArbor 桌面面板启动失败。");
    console.error(error);
    exitDesktopAfterCleanup(1);
  }
}

function exitDesktopAfterCleanup(exitCode: number): void {
  desktopExitCleanup ??= (async () => {
    const results = await Promise.allSettled(
      [...activeDesktopSessions].map((session) => session.close())
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("强制退出前关闭桌面面板服务器失败。");
        console.error(result.reason);
      }
    }
    app.exit(exitCode);
  })();
}

function configureDesktopAppIdentity(): void {
  app.setName(AGENTARBOR_APP_NAME);
  if (process.platform === "win32") {
    app.setAppUserModelId(AGENTARBOR_APP_ID);
  }
  try {
    app.setPath("userData", path.join(app.getPath("appData"), AGENTARBOR_APP_NAME));
  } catch {
    // Electron may reject path changes in unusual embed contexts; app identity still remains set.
  }
}

async function selectWorkspaceDirectory(): Promise<string | undefined> {
  await app.whenReady();
  const window = currentPanelDialogWindow();
  const options: OpenDialogOptions = {
    title: "选择工作空间",
    properties: ["openDirectory"],
  };
  const result = window === undefined
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(window, options);
  return result.canceled ? undefined : result.filePaths[0];
}

async function selectContextAttachment(): Promise<{ readonly kind: "file" | "project"; readonly path: string } | undefined> {
  await app.whenReady();
  const window = currentPanelDialogWindow();
  const options: OpenDialogOptions = {
    title: "选择附件",
    properties: ["openFile"],
    filters: [{ name: "所有文件", extensions: ["*"] }],
  };
  const result = window === undefined
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(window, options);
  if (result.canceled) {
    return undefined;
  }
  const selectedPath = result.filePaths[0];
  if (selectedPath === undefined) {
    return undefined;
  }
  const selectedStat = await stat(selectedPath).catch(() => undefined);
  return {
    kind: selectedStat?.isDirectory() === true ? "project" : "file",
    path: selectedPath,
  };
}

function currentPanelDialogWindow(): BrowserWindow | undefined {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow !== null && activeWindows.has(focusedWindow) && !focusedWindow.isDestroyed()) {
    return focusedWindow;
  }
  return [...activeWindows].find((candidate) => !candidate.isDestroyed());
}

function createElectronPanelWindow(
  options: ReturnType<typeof createPanelDesktopWindowOptions> = createPanelDesktopWindowOptions()
) {
  installStartupWindowExpansionBridge();
  const {
    startup,
    startupAnimationEnabled: configuredStartupAnimationEnabled,
    ...targetOptions
  } = options;
  const startupAnimationEnabled = startupWindowSmokeRequested || configuredStartupAnimationEnabled;
  const targetBounds = centeredBoundsForPrimaryDisplay(targetOptions.width, targetOptions.height);
  const startupBounds = centeredBoundsInside(targetBounds, startup.initialWidth, startup.initialHeight);
  const mainWindow = new BrowserWindow({
    ...targetOptions,
    x: targetBounds.x,
    y: targetBounds.y,
    width: targetBounds.width,
    height: targetBounds.height,
    minWidth: targetOptions.minWidth,
    minHeight: targetOptions.minHeight,
    backgroundColor: startupAnimationEnabled ? "#00000000" : startup.theme.backgroundColor,
    transparent: startupAnimationEnabled,
    resizable: !startupAnimationEnabled,
    show: false,
    webPreferences: {
      ...targetOptions.webPreferences,
      preload: getPanelDesktopPreloadPath(),
    },
  });
  recordStartupWindowSmokeEvent("window-created");
  if (startupWindowSmokeRequested) {
    mainWindow.webContents.on("console-message", (_event, _level, message) => {
      recordStartupWindowSmokeEvent(`renderer-console: ${message}`);
    });
    mainWindow.webContents.once("did-finish-load", () => {
      recordStartupWindowSmokeEvent("did-finish-load");
    });
  }
  activeWindows.add(mainWindow);
  if (startupAnimationEnabled) {
    startupWindowStates.set(mainWindow, {
      mainWindow,
      targetMinWidth: targetOptions.minWidth,
      targetMinHeight: targetOptions.minHeight,
      targetBounds,
      startupBounds,
      handoffRequested: false,
      reducedMotion: false,
      handoffVisible: false,
      handoffCompleted: false,
      expansionStarted: false,
      expansionFinished: false,
      animationConsumed: false,
      expansionResult: undefined,
      readyToShow: false,
      overlayReady: false,
      showRequested: false,
      showFallbackTimer: undefined,
    });
  }
  mainWindowStates.set(mainWindow, {
    startupWindow: mainWindow,
    maximizeState: createDesktopWindowMaximizeState(),
  });
  registerDesktopWindowCleanup(mainWindow);
  mainWindow.on("unmaximize", () => {
    const state = mainWindowStates.get(mainWindow);
    if (state === undefined) return;
    clearDesktopWindowMaximizeState(state.maximizeState);
    notifyCurrentDesktopWindowState(mainWindow);
  });
  mainWindow.on("maximize", () => {
    notifyCurrentDesktopWindowState(mainWindow);
  });
  mainWindow.on("leave-full-screen", () => {
    const state = mainWindowStates.get(mainWindow);
    if (state === undefined) return;
    clearDesktopWindowMaximizeState(state.maximizeState);
    notifyCurrentDesktopWindowState(mainWindow);
  });
  mainWindow.on("enter-full-screen", () => {
    notifyCurrentDesktopWindowState(mainWindow);
  });
  let readyToShowHandler: (() => void) | undefined;
  const notifyReadyToShow = () => {
    const state = startupWindowStates.get(mainWindow);
    if (state === undefined || !state.readyToShow) return;
    readyToShowHandler?.();
  };
  mainWindow.once("ready-to-show", () => {
    const state = startupWindowStates.get(mainWindow);
    if (state !== undefined) {
      state.readyToShow = true;
    }
    recordStartupWindowSmokeEvent("ready-to-show");
    notifyReadyToShow();
    if (state !== undefined) {
      showStartupWindowIfReady(mainWindow, state);
    }
  });

  return {
    loadUrl: async (url: string) => {
      recordStartupWindowSmokeEvent("load-url");
      await mainWindow.loadURL(startupAnimationEnabled ? withStartupMode(url, startupWindowSmokeRequested) : url);
    },
    onReadyToShow: (handler: () => void) => {
      readyToShowHandler = handler;
      notifyReadyToShow();
    },
    show: () => {
      const state = startupWindowStates.get(mainWindow);
      if (state === undefined) {
        showWindowIfAlive(mainWindow);
        return;
      }
      state.showRequested = true;
      scheduleStartupWindowInitialShowFallback(mainWindow, state);
      showStartupWindowIfReady(mainWindow, state);
    },
    isVisible: () => mainWindow.isVisible(),
    isDestroyed: () => mainWindow.isDestroyed(),
  };
}

function registerDesktopWindowCleanup(window: BrowserWindow): void {
  window.once("closed", () => {
    const fallbackTimer = startupHandoffFallbackTimers.get(window);
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer);
      startupHandoffFallbackTimers.delete(window);
    }
    const nativeControlTimer = startupNativeControlRestoreTimers.get(window);
    if (nativeControlTimer !== undefined) {
      clearTimeout(nativeControlTimer);
      startupNativeControlRestoreTimers.delete(window);
    }
    const startupState = startupWindowStates.get(window);
    if (startupState?.showFallbackTimer !== undefined) {
      clearTimeout(startupState.showFallbackTimer);
      startupState.showFallbackTimer = undefined;
    }
    const mainState = mainWindowStates.get(window);
    if (mainState !== undefined) {
      clearDesktopWindowMaximizeState(mainState.maximizeState);
    }
    activeWindows.delete(window);
  });
}

function installStartupWindowExpansionBridge(): void {
  if (startupWindowExpansionBridgeInstalled) {
    return;
  }
  startupWindowExpansionBridgeInstalled = true;
  ipcMain.handle(STARTUP_WINDOW_EXPAND_CHANNEL, (
    event: IpcMainInvokeEvent,
    request: unknown
  ): Promise<DesktopStartupWindowExpansionResult> => {
    const window = startupWindowFromPanelEvent(event);
    if (window === undefined) return Promise.resolve(createNoopStartupWindowExpansionResult());
    const reducedMotion = readStartupWindowExpansionRequest(request).reducedMotion === true;
    return prepareStartupWindowExpansion(window, reducedMotion);
  });
  ipcMain.handle(STARTUP_WINDOW_BEGIN_EXPAND_CHANNEL, (event: IpcMainInvokeEvent): DesktopStartupWindowBeginResult => {
    const window = startupWindowFromPanelEvent(event);
    if (window === undefined) return createNoopStartupWindowBeginResult();
    return beginStartupWindowExpansion(window);
  });
  ipcMain.on(STARTUP_ANIMATION_CONSUME_CHANNEL, (event: IpcMainEvent) => {
    const window = startupWindowFromPanelEvent(event);
    if (window === undefined) {
      event.returnValue = false;
      return;
    }
    const state = startupWindowStates.get(window);
    if (state === undefined || state.animationConsumed) {
      event.returnValue = false;
      return;
    }
    state.animationConsumed = true;
    event.returnValue = true;
  });
  ipcMain.on(STARTUP_OVERLAY_READY_CHANNEL, (event: IpcMainEvent) => {
    const window = panelWindowFromEvent(event);
    if (window === undefined) return;
    const startupState = startupWindowStates.get(window);
    if (startupState === undefined) return;
    startupState.overlayReady = true;
    recordStartupWindowSmokeEvent("overlay-ready");
    showStartupWindowIfReady(window, startupState);
  });
  ipcMain.on(STARTUP_MAIN_READY_CHANNEL, (event: IpcMainEvent) => {
    const window = panelWindowFromEvent(event);
    if (window === undefined) return;
    const mainState = mainWindowStates.get(window);
    if (mainState === undefined) return;
    const startupState = startupWindowStates.get(mainState.startupWindow);
    if (startupState === undefined) return;
    recordStartupWindowSmokeEvent("main-ready");
  });
  ipcMain.on(STARTUP_MAIN_HANDOFF_VISIBLE_CHANNEL, (event: IpcMainEvent) => {
    const window = panelWindowFromEvent(event);
    if (window === undefined) return;
    const mainState = mainWindowStates.get(window);
    if (mainState === undefined) return;
    const startupState = startupWindowStates.get(mainState.startupWindow);
    if (startupState === undefined) return;
    recordStartupWindowSmokeEvent("handoff-visible");
    requestStartupMainHandoffCompletion(mainState.startupWindow, startupState);
  });
  ipcMain.on(STARTUP_RENDERER_FRAME_STATS_CHANNEL, (event: IpcMainEvent, payload: unknown) => {
    const window = panelWindowFromEvent(event);
    if (window === undefined) return;
    if (!mainWindowStates.has(window)) return;
    const stats = readStartupRendererFrameStats(payload);
    if (stats === undefined) return;
    recordStartupWindowSmokeRendererFrameStats(stats);
    completeStartupWindowSmokeIfRequested(window);
  });
  ipcMain.handle(WINDOW_GET_STATE_CHANNEL, (event: IpcMainInvokeEvent): DesktopWindowPresentationState => {
    const window = panelWindowFromEvent(event);
    if (window === undefined) return createDefaultDesktopWindowState();
    const state = mainWindowStates.get(window);
    if (state === undefined) return createDefaultDesktopWindowState();
    return readDesktopWindowPresentationState(window, state.maximizeState);
  });
  ipcMain.on(WINDOW_MINIMIZE_CHANNEL, (event: IpcMainEvent) => {
    const window = panelWindowFromEvent(event);
    if (window === undefined) return;
    window.minimize();
  });
  ipcMain.on(WINDOW_TOGGLE_MAXIMIZE_CHANNEL, (event: IpcMainEvent) => {
    const window = panelWindowFromEvent(event);
    if (window === undefined) return;
    const state = mainWindowStates.get(window);
    if (state === undefined) return;
    toggleDesktopWindowMaximize(window, state.maximizeState, {
      targetBounds: desktopWindowMaximizeTargetBounds(window),
      durationMs: DESKTOP_WINDOW_MAXIMIZE_ANIMATION_MS,
      onStateChange: (nextState) => {
        notifyDesktopWindowState(window, nextState);
      },
    });
  });
  ipcMain.on(WINDOW_CLOSE_CHANNEL, (event: IpcMainEvent) => {
    const window = panelWindowFromEvent(event);
    if (window === undefined) return;
    window.close();
  });
}

function installDesktopLocalPreferenceBridge(): void {
  ipcMain.on(LOCAL_PREFERENCE_GET_CHANNEL, (event, key: unknown) => {
    event.returnValue = getDesktopLocalPreferenceStore().read(key);
  });
  ipcMain.on(LOCAL_PREFERENCE_SET_CHANNEL, (event, payload: unknown) => {
    event.returnValue = getDesktopLocalPreferenceStore().write(payload);
  });
}

function getDesktopLocalPreferenceStore(): DesktopLocalPreferenceStore {
  if (desktopLocalPreferenceStore === undefined) {
    desktopLocalPreferenceStore = createDesktopLocalPreferenceStore({
      userDataDirectory: app.getPath("userData"),
      appDataDirectory: app.getPath("appData"),
    });
  }
  return desktopLocalPreferenceStore;
}

function readStartupAnimationPreference(): boolean {
  return getDesktopLocalPreferenceStore().read(STARTUP_ANIMATION_PREFERENCE_KEY) === "true";
}

function panelWindowFromEvent(event: Pick<IpcMainEvent, "sender">): BrowserWindow | undefined {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === null || !activeWindows.has(window) || window.isDestroyed()) {
    return undefined;
  }
  return window;
}

function startupWindowFromPanelEvent(event: Pick<IpcMainEvent, "sender">): BrowserWindow | undefined {
  const window = panelWindowFromEvent(event);
  if (window === undefined) return undefined;
  return startupWindowStates.has(window) ? window : undefined;
}

function createDefaultDesktopWindowState(): DesktopWindowPresentationState {
  return {
    maximized: false,
    animating: false,
  };
}

function notifyDesktopWindowState(
  window: BrowserWindow,
  state: DesktopWindowPresentationState
): void {
  if (window.isDestroyed()) return;
  window.webContents.send(WINDOW_STATE_CHANGED_CHANNEL, state);
}

function notifyCurrentDesktopWindowState(window: BrowserWindow): void {
  const state = mainWindowStates.get(window);
  if (state === undefined) return;
  notifyDesktopWindowState(window, readDesktopWindowPresentationState(window, state.maximizeState));
}

function desktopWindowMaximizeTargetBounds(window: BrowserWindow): Rectangle {
  return screen.getDisplayMatching(window.getBounds()).workArea;
}

function readStartupWindowExpansionRequest(request: unknown): DesktopStartupWindowExpansionRequest {
  if (request === null || typeof request !== "object") {
    return {};
  }
  return {
    reducedMotion: (request as { readonly reducedMotion?: unknown }).reducedMotion === true,
  };
}

function readStartupRendererFrameStats(payload: unknown): DesktopStartupRendererFrameStats | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const candidate = payload as Partial<Record<keyof DesktopStartupRendererFrameStats, unknown>>;
  const frameCount = readNonNegativeFiniteNumber(candidate.frameCount);
  const maxFrameMs = readNonNegativeFiniteNumber(candidate.maxFrameMs);
  const maxFrameAtMs = readNonNegativeFiniteNumber(candidate.maxFrameAtMs);
  const averageFrameMs = readNonNegativeFiniteNumber(candidate.averageFrameMs);
  const totalMs = readNonNegativeFiniteNumber(candidate.totalMs);
  const visual = readStartupRendererVisualStats(candidate.visual);
  if (
    frameCount === undefined ||
    maxFrameMs === undefined ||
    maxFrameAtMs === undefined ||
    averageFrameMs === undefined ||
    totalMs === undefined
  ) {
    return undefined;
  }
  return {
    frameCount: Math.round(frameCount),
    maxFrameMs,
    maxFrameAtMs,
    averageFrameMs,
    totalMs,
    ...(visual === undefined ? {} : { visual }),
  };
}

function readStartupRendererVisualStats(payload: unknown): DesktopStartupRendererVisualStats | undefined {
  if (payload === undefined) return undefined;
  if (payload === null || typeof payload !== "object") return undefined;
  const candidate = payload as Partial<Record<keyof DesktopStartupRendererVisualStats, unknown>>;
  const sampleCount = readNonNegativeFiniteNumber(candidate.sampleCount);
  const shellNodeMax = readNonNegativeFiniteNumber(candidate.shellNodeMax);
  const missingOverlayCount = readNonNegativeFiniteNumber(candidate.missingOverlayCount);
  const missingFrameCount = readNonNegativeFiniteNumber(candidate.missingFrameCount);
  const missingTextCount = readNonNegativeFiniteNumber(candidate.missingTextCount);
  const duplicateHeadingVisibleCount = readNonNegativeFiniteNumber(candidate.duplicateHeadingVisibleCount);
  const visibleChromeDuringExpansionCount = readNonNegativeFiniteNumber(candidate.visibleChromeDuringExpansionCount);
  const overlayBackgroundOpaqueCount = readNonNegativeFiniteNumber(candidate.overlayBackgroundOpaqueCount);
  const seenExpandingOpaqueSurface = readBoolean(candidate.seenExpandingOpaqueSurface);
  const seenExpandingTransparentSurface = readBoolean(candidate.seenExpandingTransparentSurface);
  const titleHandoffSampleCount = readNonNegativeFiniteNumber(candidate.titleHandoffSampleCount);
  const titleHandoffOpaqueSurfaceCount = readNonNegativeFiniteNumber(candidate.titleHandoffOpaqueSurfaceCount);
  const titleHandoffMaxCenterErrorPx = readNonNegativeFiniteNumber(candidate.titleHandoffMaxCenterErrorPx);
  const titleHandoffMaxSizeErrorPx = readNonNegativeFiniteNumber(candidate.titleHandoffMaxSizeErrorPx);
  const titleHandoffMinCenterErrorPx = readNonNegativeFiniteNumber(candidate.titleHandoffMinCenterErrorPx);
  const titleHandoffLastCenterErrorPx = readNonNegativeFiniteNumber(candidate.titleHandoffLastCenterErrorPx);
  const titleHandoffLastSizeErrorPx = readNonNegativeFiniteNumber(candidate.titleHandoffLastSizeErrorPx);
  if (
    sampleCount === undefined ||
    shellNodeMax === undefined ||
    missingOverlayCount === undefined ||
    missingFrameCount === undefined ||
    missingTextCount === undefined ||
    duplicateHeadingVisibleCount === undefined ||
    visibleChromeDuringExpansionCount === undefined ||
    overlayBackgroundOpaqueCount === undefined ||
    seenExpandingOpaqueSurface === undefined ||
    seenExpandingTransparentSurface === undefined ||
    titleHandoffSampleCount === undefined ||
    titleHandoffOpaqueSurfaceCount === undefined ||
    titleHandoffMaxCenterErrorPx === undefined ||
    titleHandoffMaxSizeErrorPx === undefined ||
    titleHandoffMinCenterErrorPx === undefined ||
    titleHandoffLastCenterErrorPx === undefined ||
    titleHandoffLastSizeErrorPx === undefined
  ) {
    return undefined;
  }
  return {
    sampleCount: Math.round(sampleCount),
    shellNodeMax: Math.round(shellNodeMax),
    missingOverlayCount: Math.round(missingOverlayCount),
    missingFrameCount: Math.round(missingFrameCount),
    missingTextCount: Math.round(missingTextCount),
    duplicateHeadingVisibleCount: Math.round(duplicateHeadingVisibleCount),
    visibleChromeDuringExpansionCount: Math.round(visibleChromeDuringExpansionCount),
    overlayBackgroundOpaqueCount: Math.round(overlayBackgroundOpaqueCount),
    seenExpandingOpaqueSurface,
    seenExpandingTransparentSurface,
    titleHandoffSampleCount: Math.round(titleHandoffSampleCount),
    titleHandoffOpaqueSurfaceCount: Math.round(titleHandoffOpaqueSurfaceCount),
    titleHandoffMaxCenterErrorPx,
    titleHandoffMaxSizeErrorPx,
    titleHandoffMinCenterErrorPx,
    titleHandoffLastCenterErrorPx,
    titleHandoffLastSizeErrorPx,
  };
}

function readNonNegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function prepareStartupWindowExpansion(
  window: BrowserWindow,
  reducedMotion: boolean
): Promise<DesktopStartupWindowExpansionResult> {
  const state = startupWindowStates.get(window);
  if (state === undefined || window.isDestroyed()) {
    return Promise.resolve(createNoopStartupWindowExpansionResult());
  }
  if (state.handoffRequested) {
    return Promise.resolve(createStartupWindowExpansionResult(state));
  }
  recordStartupWindowSmokeEvent("expand-requested");
  state.handoffRequested = true;
  state.reducedMotion = reducedMotion;
  return Promise.resolve(createStartupWindowExpansionResult(state));
}

function beginStartupWindowExpansion(startupWindow: BrowserWindow): DesktopStartupWindowBeginResult {
  const state = startupWindowStates.get(startupWindow);
  if (state === undefined || startupWindow.isDestroyed()) {
    return createNoopStartupWindowBeginResult();
  }
  recordStartupWindowSmokeEvent("begin-expand-requested");
  const expansionResult = createStartupWindowExpansionResult(state);
  const started = startStartupWindowExpansionIfReady(startupWindow, state);
  return {
    started: started || state.expansionStarted,
    durationMs: expansionResult.durationMs,
  };
}

function startStartupWindowExpansionIfReady(startupWindow: BrowserWindow, state: DesktopStartupWindowState): boolean {
  if (!state.handoffRequested || state.expansionStarted || startupWindow.isDestroyed()) {
    return false;
  }
  state.expansionStarted = true;
  recordStartupWindowSmokeEvent("expansion-started");
  const expansionResult = createStartupWindowExpansionResult(state);
  void waitForStartupWindowSurfaceExpansion(expansionResult.durationMs).then((frameStats) => {
    recordStartupWindowSmokeBoundsFrameStats(frameStats);
    state.expansionFinished = true;
    recordStartupWindowSmokeEvent("expansion-finished");
    if (state.handoffVisible) {
      completeStartupMainHandoff(startupWindow, state);
    } else {
      scheduleStartupMainHandoffFallback(startupWindow, state);
    }
  });
  return true;
}

function createStartupWindowExpansionResult(state: DesktopStartupWindowState): DesktopStartupWindowExpansionResult {
  if (state.expansionResult !== undefined) {
    return state.expansionResult;
  }
  const result: DesktopStartupWindowExpansionResult = {
    durationMs: state.reducedMotion ? STARTUP_WINDOW_REDUCED_MOTION_MS : STARTUP_WINDOW_EXPAND_MS,
    nativeExpanded: true,
    startupRect: {
      x: state.startupBounds.x - state.targetBounds.x,
      y: state.startupBounds.y - state.targetBounds.y,
      width: state.startupBounds.width,
      height: state.startupBounds.height,
    },
    targetWindow: {
      width: state.targetBounds.width,
      height: state.targetBounds.height,
    },
  };
  state.expansionResult = result;
  return result;
}

function scheduleStartupMainHandoffFallback(startupWindow: BrowserWindow, state: DesktopStartupWindowState): void {
  const existingTimer = startupHandoffFallbackTimers.get(state.mainWindow);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
    startupHandoffFallbackTimers.delete(state.mainWindow);
  }
  const timer = setTimeout(() => {
    completeStartupMainHandoff(startupWindow, state);
  }, STARTUP_MAIN_HANDOFF_VISIBLE_FALLBACK_MS);
  timer.unref();
  startupHandoffFallbackTimers.set(state.mainWindow, timer);
}

function requestStartupMainHandoffCompletion(startupWindow: BrowserWindow, state: DesktopStartupWindowState): void {
  state.handoffVisible = true;
  if (state.expansionFinished) {
    completeStartupMainHandoff(startupWindow, state);
  }
}

function completeStartupMainHandoff(startupWindow: BrowserWindow, state: DesktopStartupWindowState): void {
  if (state.handoffCompleted) return;
  state.handoffCompleted = true;
  recordStartupWindowSmokeEvent("handoff-complete");
  const fallbackTimer = startupHandoffFallbackTimers.get(state.mainWindow);
  if (fallbackTimer !== undefined) {
    clearTimeout(fallbackTimer);
    startupHandoffFallbackTimers.delete(state.mainWindow);
  }
  scheduleStartupWindowNativeControlRestore(startupWindow, state);
  completeStartupWindowSmokeIfRequested(state.mainWindow);
}

function scheduleStartupWindowNativeControlRestore(startupWindow: BrowserWindow, state: DesktopStartupWindowState): void {
  const existingTimer = startupNativeControlRestoreTimers.get(startupWindow);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
    startupNativeControlRestoreTimers.delete(startupWindow);
  }
  const timer = setTimeout(() => {
    startupNativeControlRestoreTimers.delete(startupWindow);
    if (startupWindow.isDestroyed()) return;
    startupWindow.setMinimumSize(state.targetMinWidth, state.targetMinHeight);
    startupWindow.setResizable(true);
    startupWindow.setMaximizable(true);
    startupWindow.focus();
  }, STARTUP_WINDOW_NATIVE_CONTROL_RESTORE_DELAY_MS);
  timer.unref();
  startupNativeControlRestoreTimers.set(startupWindow, timer);
}

function scheduleStartupWindowSmokeTimeout(): void {
  if (!startupWindowSmokeRequested) return;
  startupWindowSmokeTimeout = setTimeout(() => {
    console.error("AgentArbor desktop window smoke timed out before startup handoff completed.");
    printStartupWindowSmokeEvents();
    exitDesktopAfterCleanup(1);
  }, STARTUP_WINDOW_SMOKE_TIMEOUT_MS);
}

function completeStartupWindowSmokeIfRequested(mainWindow: BrowserWindow): void {
  if (!startupWindowSmokeRequested) return;
  if (!startupWindowSmokeEventLabels.includes("handoff-complete") || startupWindowSmokeRendererFrameStats === undefined) {
    return;
  }
  const timelineError = validateStartupWindowSmokeTimeline();
  if (timelineError !== undefined) {
    console.error(timelineError);
    printStartupWindowSmokeEvents();
    exitDesktopAfterCleanup(1);
    return;
  }
  clearStartupWindowSmokeTimeout();
  console.log("AgentArbor desktop window smoke completed startup handoff.");
  printStartupWindowSmokeEvents();
  setTimeout(() => {
    closeWindowIfAlive(mainWindow);
    app.quit();
  }, STARTUP_WINDOW_RENDERER_SETTLE_MS);
}

function scheduleStartupWindowInitialShowFallback(window: BrowserWindow, state: DesktopStartupWindowState): void {
  if (state.showFallbackTimer !== undefined || state.overlayReady) return;
  state.showFallbackTimer = setTimeout(() => {
    state.showFallbackTimer = undefined;
    if (window.isDestroyed() || window.isVisible()) return;
    state.overlayReady = true;
    recordStartupWindowSmokeEvent("overlay-ready");
    recordStartupWindowSmokeEvent("overlay-ready-fallback");
    showStartupWindowIfReady(window, state);
  }, STARTUP_WINDOW_INITIAL_SHOW_FALLBACK_MS);
  state.showFallbackTimer.unref();
}

function showStartupWindowIfReady(window: BrowserWindow, state: DesktopStartupWindowState): void {
  if (!state.showRequested || !state.readyToShow || !state.overlayReady) return;
  if (state.showFallbackTimer !== undefined) {
    clearTimeout(state.showFallbackTimer);
    state.showFallbackTimer = undefined;
  }
  showWindowIfAlive(window);
}

function showWindowIfAlive(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isVisible()) return;
  recordStartupWindowSmokeEvent("show");
  window.show();
}

function recordStartupWindowSmokeEvent(label: string): void {
  if (!startupWindowSmokeRequested) return;
  startupWindowSmokeEventLabels.push(label);
  startupWindowSmokeEvents.push(`${Math.round(performance.now())}ms ${label}`);
}

function recordStartupWindowSmokeBoundsFrameStats(stats: DesktopStartupWindowBoundsFrameStats): void {
  if (!startupWindowSmokeRequested) return;
  startupWindowSmokeBoundsFrameStats = stats;
  recordStartupWindowSmokeEvent(
    `bounds-frames:${stats.frameCount}:max-${Math.round(stats.maxFrameMs)}ms:step-${roundSmokeNumber(stats.maxBoundsStepPx)}px:center-drift-${roundSmokeNumber(stats.maxCenterDriftPx)}px:reverse-${stats.reverseStepCount}:avg-${Math.round(stats.averageFrameMs)}ms`
  );
}

function recordStartupWindowSmokeRendererFrameStats(stats: DesktopStartupRendererFrameStats): void {
  if (!startupWindowSmokeRequested) return;
  startupWindowSmokeRendererFrameStats = stats;
  recordStartupWindowSmokeEvent(
    `renderer-frames:${stats.frameCount}:max-${Math.round(stats.maxFrameMs)}ms:at-${Math.round(stats.maxFrameAtMs)}ms:avg-${Math.round(stats.averageFrameMs)}ms`
  );
  if (stats.visual !== undefined) {
    recordStartupWindowSmokeEvent(
      `visual-samples:${stats.visual.sampleCount}:shell-${stats.visual.shellNodeMax}:dup-${stats.visual.duplicateHeadingVisibleCount}:chrome-${stats.visual.visibleChromeDuringExpansionCount}:handoff-opaque-${stats.visual.titleHandoffOpaqueSurfaceCount}:title-center-last-${roundSmokeNumber(stats.visual.titleHandoffLastCenterErrorPx)}px:title-center-min-${roundSmokeNumber(stats.visual.titleHandoffMinCenterErrorPx)}px:title-center-max-${roundSmokeNumber(stats.visual.titleHandoffMaxCenterErrorPx)}px:title-size-last-${roundSmokeNumber(stats.visual.titleHandoffLastSizeErrorPx)}px`
    );
  }
}

function roundSmokeNumber(value: number): number {
  return Math.round(value * 10) / 10;
}

function printStartupWindowSmokeEvents(): void {
  if (!startupWindowSmokeRequested || startupWindowSmokeEvents.length === 0) return;
  console.log(`AgentArbor desktop window smoke timeline: ${startupWindowSmokeEvents.join(" -> ")}`);
}

function validateStartupWindowSmokeTimeline(): string | undefined {
  const requiredEvents = [
    "window-created",
    "load-url",
    "did-finish-load",
    "ready-to-show",
    "overlay-ready",
    "show",
    "main-ready",
    "expand-requested",
    "begin-expand-requested",
    "expansion-started",
    "handoff-visible",
    "expansion-finished",
    "handoff-complete",
  ];
  for (const label of requiredEvents) {
    if (!startupWindowSmokeEventLabels.includes(label)) {
      return `AgentArbor desktop window smoke missing startup event: ${label}`;
    }
  }
  const requiredOrder = [
    "window-created",
    "load-url",
    "overlay-ready",
    "show",
    "main-ready",
    "expand-requested",
    "begin-expand-requested",
    "expansion-started",
    "expansion-finished",
    "handoff-complete",
  ];
  let previousIndex = -1;
  for (const label of requiredOrder) {
    const index = startupWindowSmokeEventLabels.indexOf(label);
    if (index <= previousIndex) {
      return `AgentArbor desktop window smoke event out of order: ${label}`;
    }
    previousIndex = index;
  }
  const expansionStartedIndex = startupWindowSmokeEventLabels.indexOf("expansion-started");
  const handoffVisibleIndex = startupWindowSmokeEventLabels.indexOf("handoff-visible");
  const handoffCompleteIndex = startupWindowSmokeEventLabels.indexOf("handoff-complete");
  if (handoffVisibleIndex <= expansionStartedIndex || handoffVisibleIndex >= handoffCompleteIndex) {
    return "AgentArbor desktop window smoke handoff visibility event was outside the expansion handoff window.";
  }
  if (countStartupWindowSmokeEvents("window-created") !== 1) {
    return "AgentArbor desktop window smoke expected exactly one startup BrowserWindow.";
  }
  const rendererStatsIndex = findStartupWindowSmokeEventIndexByPrefix("renderer-frames:");
  if (rendererStatsIndex === -1) {
    return "AgentArbor desktop window smoke missing renderer frame stats.";
  }
  if (rendererStatsIndex <= handoffCompleteIndex) {
    return "AgentArbor desktop window smoke renderer stats arrived before native handoff completed.";
  }
  if (startupWindowSmokeBoundsFrameStats === undefined) {
    return "AgentArbor desktop window smoke missing bounds frame stats.";
  }
  if (startupWindowSmokeBoundsFrameStats.frameCount < STARTUP_WINDOW_SMOKE_MIN_BOUNDS_FRAMES) {
    return `AgentArbor desktop window smoke bounds animation produced too few frames: ${startupWindowSmokeBoundsFrameStats.frameCount}`;
  }
  if (startupWindowSmokeBoundsFrameStats.maxFrameMs > STARTUP_WINDOW_SMOKE_MAX_BOUNDS_FRAME_MS) {
    return `AgentArbor desktop window smoke bounds animation had a long frame: ${Math.round(startupWindowSmokeBoundsFrameStats.maxFrameMs)}ms`;
  }
  if (startupWindowSmokeBoundsFrameStats.maxBoundsStepPx > STARTUP_WINDOW_SMOKE_MAX_BOUNDS_STEP_PX) {
    return `AgentArbor desktop window smoke bounds animation jumped ${roundSmokeNumber(startupWindowSmokeBoundsFrameStats.maxBoundsStepPx)}px in one frame.`;
  }
  if (startupWindowSmokeBoundsFrameStats.maxCenterDriftPx > STARTUP_WINDOW_SMOKE_MAX_CENTER_DRIFT_PX) {
    return `AgentArbor desktop window smoke bounds animation drifted from center by ${roundSmokeNumber(startupWindowSmokeBoundsFrameStats.maxCenterDriftPx)}px.`;
  }
  if (startupWindowSmokeBoundsFrameStats.reverseStepCount !== 0) {
    return `AgentArbor desktop window smoke bounds animation reversed direction ${startupWindowSmokeBoundsFrameStats.reverseStepCount} times.`;
  }
  if (startupWindowSmokeRendererFrameStats === undefined) {
    return "AgentArbor desktop window smoke missing renderer frame stats.";
  }
  const minRendererFrames = startupWindowSmokeRendererFrameStats.totalMs >= 500
    ? STARTUP_WINDOW_SMOKE_MIN_RENDERER_FRAMES
    : 2;
  if (startupWindowSmokeRendererFrameStats.frameCount < minRendererFrames) {
    return `AgentArbor desktop window smoke renderer animation produced too few frames: ${startupWindowSmokeRendererFrameStats.frameCount}`;
  }
  if (startupWindowSmokeRendererFrameStats.maxFrameMs > STARTUP_WINDOW_SMOKE_MAX_RENDERER_FRAME_MS) {
    return `AgentArbor desktop window smoke renderer animation had a long frame: ${Math.round(startupWindowSmokeRendererFrameStats.maxFrameMs)}ms`;
  }
  const visualStats = startupWindowSmokeRendererFrameStats.visual;
  if (visualStats === undefined) {
    return "AgentArbor desktop window smoke missing startup visual stats.";
  }
  if (visualStats.sampleCount < minRendererFrames) {
    return `AgentArbor desktop window smoke visual probe produced too few samples: ${visualStats.sampleCount}`;
  }
  if (visualStats.shellNodeMax !== 0) {
    return "AgentArbor desktop window smoke saw an extra startup shell layer.";
  }
  if (visualStats.missingOverlayCount !== 0 || visualStats.missingFrameCount !== 0 || visualStats.missingTextCount !== 0) {
    return "AgentArbor desktop window smoke saw an incomplete startup overlay tree.";
  }
  if (visualStats.duplicateHeadingVisibleCount !== 0) {
    return "AgentArbor desktop window smoke saw duplicate visible startup and real headings.";
  }
  if (visualStats.visibleChromeDuringExpansionCount !== 0) {
    return "AgentArbor desktop window smoke saw app chrome during startup expansion.";
  }
  if (visualStats.overlayBackgroundOpaqueCount !== 0) {
    return "AgentArbor desktop window smoke saw an opaque startup overlay background.";
  }
  if (!visualStats.seenExpandingOpaqueSurface) {
    return "AgentArbor desktop window smoke did not observe the renderer startup surface during expansion.";
  }
  if (visualStats.seenExpandingTransparentSurface) {
    return "AgentArbor desktop window smoke saw the startup surface disappear during expansion.";
  }
  if (visualStats.titleHandoffSampleCount < 2) {
    return `AgentArbor desktop window smoke saw too few title handoff visual samples: ${visualStats.titleHandoffSampleCount}`;
  }
  if (visualStats.titleHandoffLastCenterErrorPx > STARTUP_WINDOW_SMOKE_MAX_TITLE_CENTER_ERROR_PX) {
    return `AgentArbor desktop window smoke title handoff missed target center by ${roundSmokeNumber(visualStats.titleHandoffLastCenterErrorPx)}px.`;
  }
  if (visualStats.titleHandoffLastSizeErrorPx > STARTUP_WINDOW_SMOKE_MAX_TITLE_SIZE_ERROR_PX) {
    return `AgentArbor desktop window smoke title handoff size differs by ${roundSmokeNumber(visualStats.titleHandoffLastSizeErrorPx)}px.`;
  }
  return undefined;
}

function countStartupWindowSmokeEvents(label: string): number {
  return startupWindowSmokeEventLabels.filter((eventLabel) => eventLabel === label).length;
}

function findStartupWindowSmokeEventIndexByPrefix(prefix: string): number {
  return startupWindowSmokeEventLabels.findIndex((eventLabel) => eventLabel.startsWith(prefix));
}

function clearStartupWindowSmokeTimeout(): void {
  if (startupWindowSmokeTimeout === undefined) return;
  clearTimeout(startupWindowSmokeTimeout);
  startupWindowSmokeTimeout = undefined;
}

function waitForStartupWindowSurfaceExpansion(durationMs: number): Promise<DesktopStartupWindowBoundsFrameStats> {
  if (durationMs <= STARTUP_WINDOW_REDUCED_MOTION_MS) {
    return Promise.resolve(createStartupWindowBoundsFrameStats(1, 0, 0, 0, 0, 0, 0));
  }
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let frameIndex = 0;
    let lastFrameAt = startedAt;
    let maxFrameMs = 0;
    let totalFrameMs = 0;
    const tick = () => {
      const now = performance.now();
      const frameMs = now - lastFrameAt;
      if (frameIndex > 0) {
        maxFrameMs = Math.max(maxFrameMs, frameMs);
        totalFrameMs += frameMs;
      }
      lastFrameAt = now;
      frameIndex += 1;
      if (now - startedAt >= durationMs) {
        resolve(createStartupWindowBoundsFrameStats(
          frameIndex,
          maxFrameMs,
          0,
          0,
          0,
          totalFrameMs,
          now - startedAt
        ));
        return;
      }
      const nextFrameAt = startedAt + frameIndex * STARTUP_WINDOW_BOUNDS_FRAME_MS;
      const frameTimer = setTimeout(tick, Math.max(0, nextFrameAt - performance.now()));
      frameTimer.unref();
    };
    tick();
  });
}

function createStartupWindowBoundsFrameStats(
  frameCount: number,
  maxFrameMs: number,
  maxBoundsStepPx: number,
  maxCenterDriftPx: number,
  reverseStepCount: number,
  totalFrameMs: number,
  totalMs: number
): DesktopStartupWindowBoundsFrameStats {
  return {
    frameCount,
    maxFrameMs,
    maxBoundsStepPx,
    maxCenterDriftPx,
    reverseStepCount,
    averageFrameMs: frameCount > 1 ? totalFrameMs / (frameCount - 1) : 0,
    totalMs,
  };
}

function centeredBoundsForPrimaryDisplay(width: number, height: number): Rectangle {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function centeredBoundsInside(outer: Rectangle, width: number, height: number): Rectangle {
  const normalizedWidth = roundToParity(width, outer.width);
  const normalizedHeight = roundToParity(height, outer.height);
  return {
    x: Math.round(outer.x + (outer.width - normalizedWidth) / 2),
    y: Math.round(outer.y + (outer.height - normalizedHeight) / 2),
    width: normalizedWidth,
    height: normalizedHeight,
  };
}

function roundToParity(value: number, paritySource: number): number {
  const rounded = Math.max(1, Math.round(value));
  return sameParity(rounded, paritySource) ? rounded : rounded + 1;
}

function sameParity(left: number, right: number): boolean {
  return Math.abs(left % 2) === Math.abs(right % 2);
}

function createNoopStartupWindowExpansionResult(): DesktopStartupWindowExpansionResult {
  return {
    durationMs: 0,
    nativeExpanded: false,
    startupRect: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    },
    targetWindow: {
      width: 0,
      height: 0,
    },
  };
}

function createNoopStartupWindowBeginResult(): DesktopStartupWindowBeginResult {
  return {
    started: false,
    durationMs: 0,
  };
}

function closeWindowIfAlive(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.hide();
  window.close();
}

function withStartupMode(url: string, windowSmoke = false): string {
  const parsed = new URL(url);
  parsed.searchParams.set("agentarborStartup", "main");
  if (windowSmoke) {
    parsed.searchParams.set("agentarborStartupSmoke", "1");
  }
  return parsed.toString();
}

function getPanelDesktopPreloadPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "panel-desktop-preload.cjs");
}

async function createDesktopAppUpdateService(): Promise<AppUpdateServiceLike> {
  if (process.platform !== "win32") {
    return createUnsupportedAppUpdateService({
      currentVersion: app.getVersion(),
      reason: "当前自动更新首版仅支持 Windows 打包桌面版。",
    });
  }
  if (!app.isPackaged) {
    return createUnsupportedAppUpdateService({
      currentVersion: app.getVersion(),
      reason: "当前运行方式不支持自动更新。请使用 Windows 打包桌面版。",
    });
  }
  try {
    const electronUpdaterModule = "electron-updater";
    const module = await import(electronUpdaterModule) as {
      readonly autoUpdater?: ElectronUpdaterLike;
      readonly default?: { readonly autoUpdater?: ElectronUpdaterLike };
    };
    const updater = electronAutoUpdaterFromModule(module);
    if (updater === undefined) {
      return createUnsupportedAppUpdateService({
        currentVersion: app.getVersion(),
        reason: "自动更新模块不可用。",
      });
    }
    return createElectronAppUpdateService({
      updater,
      currentVersion: app.getVersion(),
      enabled: true,
    });
  } catch (error) {
    return createUnsupportedAppUpdateService({
      currentVersion: app.getVersion(),
      reason: error instanceof Error ? error.message : "自动更新模块加载失败。",
    });
  }
}
