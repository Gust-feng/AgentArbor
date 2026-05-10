import { BrowserWindow, app, dialog } from "electron";
import { parsePanelDesktopArgs } from "./panel-args.js";
import {
  createPanelDesktopWindowOptions,
  startPanelDesktopSession,
  type PanelDesktopSession,
} from "./panel-desktop-launcher.js";
import { startLocalPanelServer } from "./panel-server.js";

const activeWindows = new Set<BrowserWindow>();
let activeDesktopSession: PanelDesktopSession | undefined;

// NOTE: 不使用顶层 await，因为 ESM 顶层 await 会阻塞事件循环，
// 导致 app.whenReady() 永远无法 resolve（死锁）。
main().catch((error: unknown) => {
  console.error("AgentArbor 桌面面板启动失败。");
  console.error(error);
  app.exit(1);
});

async function main(): Promise<void> {
  const args = parsePanelDesktopArgs(process.argv.slice(2));
  try {
    const session = await startPanelDesktopSession(args, {
      startPanelServer: startLocalPanelServer,
      createWindow: createElectronPanelWindow,
      selectWorkspaceDirectory: selectWorkspaceDirectory,
      whenReady: app.whenReady(),
      onWindowAllClosed: (handler) => {
        app.on("window-all-closed", () => {
          void handler();
        });
      },
      onBeforeQuit: (handler) => {
        app.on("before-quit", () => {
          void handler();
        });
      },
      onSessionClosed: () => {
        activeDesktopSession = undefined;
      },
      quit: () => {
        app.quit();
      },
    });

    if (!args.smoke) {
      activeDesktopSession = session;
    }

    console.log(`AgentArbor 本地桌面面板：${session.url}`);
    if (session.configDirectory !== undefined) {
      console.log(`配置目录：${session.configDirectory}`);
    }
  } catch (error) {
    console.error("AgentArbor 桌面面板启动失败。");
    console.error(error);
    app.exit(1);
  }
}

async function selectWorkspaceDirectory(): Promise<string | undefined> {
  await app.whenReady();
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  return result.canceled ? undefined : result.filePaths[0];
}

function createElectronPanelWindow(
  options: ReturnType<typeof createPanelDesktopWindowOptions> = createPanelDesktopWindowOptions()
) {
  const window = new BrowserWindow(options);
  activeWindows.add(window);
  window.once("closed", () => {
    activeWindows.delete(window);
  });

  return {
    loadUrl: async (url: string) => {
      await window.loadURL(url);
    },
    onReadyToShow: (handler: () => void) => {
      window.once("ready-to-show", handler);
    },
    show: () => {
      window.show();
    },
    isVisible: () => window.isVisible(),
    isDestroyed: () => window.isDestroyed(),
  };
}
