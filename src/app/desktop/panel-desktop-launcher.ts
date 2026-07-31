import { createStartupIntroDefaultWindowSize } from "./panel-startup-intro-geometry.js";
import { resolvePanelBrandLogoPath } from "../panel-server/panel-assets.js";
import {
  STARTUP_MAIN_WINDOW_HEIGHT,
  STARTUP_MAIN_WINDOW_WIDTH,
  createStartupThemeSnapshot,
  type StartupThemeSnapshot,
} from "./panel-startup-theme.js";
import type { PanelLaunchArgs } from "../panel-server/panel-launch-args.js";
import type { PanelContextAttachmentSelection, PanelExternalResourceTarget, PanelServerOptions, StartedPanelServer } from "../panel-server.js";

export type PanelDesktopWindowKind = "startup" | "main";

export type PanelDesktopWindowOptions = {
  readonly title: string;
  readonly icon: string;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly kind: PanelDesktopWindowKind;
  readonly startup: {
    readonly initialWidth: number;
    readonly initialHeight: number;
    readonly theme: StartupThemeSnapshot;
  };
  readonly frame: false;
  readonly transparent: false;
  readonly resizable: true;
  readonly maximizable: true;
  readonly hasShadow: false;
  readonly center: boolean;
  readonly backgroundColor: string;
  readonly show: boolean;
  readonly autoHideMenuBar: boolean;
  readonly startupAnimationEnabled: boolean;
  readonly webPreferences: {
    readonly contextIsolation: true;
    readonly nodeIntegration: false;
    readonly sandbox: true;
    readonly webviewTag: false;
    readonly partition: "persist:agentarbor";
  };
};

export type PanelDesktopWindowHandle = {
  loadUrl(url: string): Promise<void>;
  onReadyToShow(handler: () => void): void;
  show(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
};

export type PanelDesktopSession = {
  readonly url: string;
  readonly configDirectory?: string;
  close(): Promise<void>;
};

export type PanelDesktopDependencies = {
  readonly startPanelServer: (options: PanelServerOptions) => Promise<StartedPanelServer>;
  readonly createWindow: (options: PanelDesktopWindowOptions) => PanelDesktopWindowHandle;
  readonly appUpdateService?: PanelServerOptions["appUpdateService"];
  readonly selectWorkspaceDirectory?: () => Promise<string | undefined>;
  readonly selectContextAttachment?: () => Promise<PanelContextAttachmentSelection | undefined>;
  readonly selectWorkbenchRestore?: () => Promise<string | undefined>;
  readonly openExternalResource?: (target: PanelExternalResourceTarget) => Promise<void>;
  readonly whenReady: Promise<void>;
  readonly onWindowAllClosed: (handler: () => void) => void;
  readonly onBeforeQuit: (handler: () => Promise<void>) => void;
  readonly onSessionClosed?: () => void;
  readonly quit: () => void;
};

export async function startPanelDesktopSession(
  args: PanelLaunchArgs,
  dependencies: PanelDesktopDependencies
): Promise<PanelDesktopSession> {
  const server = await dependencies.startPanelServer({
    host: args.host,
    port: args.port,
    configDirectory: args.configDirectory,
    workspaceDirectoryPicker: args.smoke ? undefined : dependencies.selectWorkspaceDirectory,
    contextAttachmentPicker: args.smoke ? undefined : dependencies.selectContextAttachment,
    workbenchRestorePicker: args.smoke ? undefined : dependencies.selectWorkbenchRestore,
    externalResourceOpener: args.smoke ? undefined : dependencies.openExternalResource,
    appUpdateService: args.smoke || args.windowSmoke || args.devUrl !== undefined ? undefined : dependencies.appUpdateService,
  });
  const panelUrl = args.devUrl ?? server.url;
  let closePromise: Promise<void> | undefined;

  const closeServer = (): Promise<void> => {
    closePromise ??= (async () => {
      await server.close();
      dependencies.onSessionClosed?.();
    })();
    return closePromise;
  };

  dependencies.onBeforeQuit(closeServer);
  dependencies.onWindowAllClosed(() => {
    void (async () => {
      await closeServer();
      dependencies.quit();
    })().catch((error: unknown) => {
      console.error("桌面面板退出失败。");
      console.error(error);
      dependencies.quit();
    });
  });

  if (args.smoke) {
    await closeServer();
    dependencies.quit();
    return {
      url: panelUrl,
      configDirectory: server.configDirectory,
      close: closeServer,
    };
  }

  try {
    await dependencies.whenReady;
    const options = createPanelDesktopWindowOptions();
    const window = dependencies.createWindow(options);
    window.onReadyToShow(() => {
      showPanelDesktopWindow(window);
    });
    await window.loadUrl(panelUrl);
    showPanelDesktopWindow(window);
  } catch (error) {
    await closeServer();
    throw error;
  }

  return {
    url: panelUrl,
    configDirectory: server.configDirectory,
    close: closeServer,
  };
}

function showPanelDesktopWindow(window: PanelDesktopWindowHandle): void {
  if (window.isDestroyed() || window.isVisible()) {
    return;
  }
  window.show();
}

export function createPanelDesktopWindowOptions(): PanelDesktopWindowOptions {
  return createPanelDesktopWindowOptionsWithStartupAnimation(false);
}

export function createPanelDesktopWindowOptionsWithStartupAnimation(
  startupAnimationEnabled: boolean
): PanelDesktopWindowOptions {
  const startupWindowSize = createStartupIntroDefaultWindowSize();
  const startupTheme = createStartupThemeSnapshot(undefined, undefined);
  return {
    title: "AgentArbor",
    icon: resolvePanelBrandLogoPath(),
    width: STARTUP_MAIN_WINDOW_WIDTH,
    height: STARTUP_MAIN_WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    kind: "main",
    startup: {
      initialWidth: startupWindowSize.width,
      initialHeight: startupWindowSize.height,
      theme: startupTheme,
    },
    frame: false,
    transparent: false,
    resizable: true,
    maximizable: true,
    hasShadow: false,
    center: true,
    backgroundColor: startupTheme.backgroundColor,
    show: false,
    autoHideMenuBar: true,
    startupAnimationEnabled,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      partition: "persist:agentarbor",
    },
  };
}
