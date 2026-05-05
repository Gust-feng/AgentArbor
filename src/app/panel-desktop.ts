import { BrowserWindow, app } from "electron";
import { parsePanelArgs } from "./panel-args.js";
import { createPanelDesktopWindowOptions, startPanelDesktopSession } from "./panel-desktop-launcher.js";
import { startLocalPanelServer } from "./panel-server.js";

await main();

async function main(): Promise<void> {
  const args = parsePanelArgs(process.argv.slice(2));
  try {
    const session = await startPanelDesktopSession(args, {
      startPanelServer: startLocalPanelServer,
      createWindow: createElectronPanelWindow,
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
      quit: () => {
        app.quit();
      },
    });

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

function createElectronPanelWindow(
  options: ReturnType<typeof createPanelDesktopWindowOptions> = createPanelDesktopWindowOptions()
) {
  const window = new BrowserWindow(options);
  window.once("ready-to-show", () => {
    window.show();
  });
  return {
    loadUrl: async (url: string) => {
      await window.loadURL(url);
    },
  };
}
