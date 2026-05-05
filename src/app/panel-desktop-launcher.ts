import type { PanelLaunchArgs } from "./panel-args.js";
import type { PanelServerOptions, StartedPanelServer } from "./panel-server.js";

export type PanelDesktopWindowOptions = {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly center: boolean;
  readonly backgroundColor: string;
  readonly show: boolean;
  readonly autoHideMenuBar: boolean;
  readonly webPreferences: {
    readonly contextIsolation: true;
    readonly nodeIntegration: false;
    readonly sandbox: true;
    readonly webviewTag: false;
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
  readonly whenReady: Promise<void>;
  readonly onWindowAllClosed: (handler: () => void) => void;
  readonly onBeforeQuit: (handler: () => void) => void;
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
  });
  let closed = false;

  const closeServer = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await server.close();
    dependencies.onSessionClosed?.();
  };

  dependencies.onBeforeQuit(() => {
    void closeServer().catch((error: unknown) => {
      console.error("关闭桌面面板服务器失败。");
      console.error(error);
    });
  });
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
      url: server.url,
      configDirectory: server.configDirectory,
      close: closeServer,
    };
  }

  try {
    await dependencies.whenReady;
    const window = dependencies.createWindow(createPanelDesktopWindowOptions());
    window.onReadyToShow(() => {
      showPanelDesktopWindow(window);
    });
    await window.loadUrl(server.url);
    showPanelDesktopWindow(window);
  } catch (error) {
    await closeServer();
    throw error;
  }

  return {
    url: server.url,
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
  return {
    title: "AgentArbor 地下运行面板",
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 800,
    center: true,
    backgroundColor: "#f5f6f7",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  };
}
