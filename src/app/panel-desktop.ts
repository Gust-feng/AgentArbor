import { BrowserWindow, app, dialog } from "electron";
import { stat } from "node:fs/promises";
import { parsePanelDesktopArgs } from "./panel-args.js";
import {
  createPanelDesktopWindowOptions,
  startPanelDesktopSession,
  type PanelDesktopSession,
} from "./panel-desktop-launcher.js";
import { startLocalPanelServer } from "./panel-server.js";

const activeWindows = new Set<BrowserWindow>();
const activeDesktopSessions = new Set<PanelDesktopSession>();

// NOTE: 不使用顶层 await，因为 ESM 顶层 await 会阻塞事件循环，
// 导致 app.whenReady() 永远无法 resolve（死锁）。
main().catch((error: unknown) => {
  console.error("AgentArbor 桌面面板启动失败。");
  console.error(error);
  app.exit(1);
});

async function main(): Promise<void> {
  const args = parsePanelDesktopArgs(process.argv.slice(2));
  let sessionRef: PanelDesktopSession | undefined;
  try {
    const session = await startPanelDesktopSession(args, {
      startPanelServer: startLocalPanelServer,
      createWindow: createElectronPanelWindow,
      selectWorkspaceDirectory: selectWorkspaceDirectory,
      selectContextAttachment: selectContextAttachment,
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

async function selectContextAttachment(): Promise<{ readonly kind: "file" | "project"; readonly path: string } | undefined> {
  await app.whenReady();
  const result = await dialog.showOpenDialog({
    title: "选择附件",
    properties: ["openFile"],
    filters: [{ name: "所有文件", extensions: ["*"] }],
  });
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
