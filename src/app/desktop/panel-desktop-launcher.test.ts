import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  createPanelDesktopWindowOptions,
  createPanelDesktopWindowOptionsWithStartupAnimation,
  startPanelDesktopSession,
  type PanelDesktopDependencies,
  type PanelDesktopWindowHandle,
  type PanelDesktopWindowOptions,
} from "./panel-desktop-launcher.js";

test("panel desktop window options keep secure defaults", () => {
  const options = createPanelDesktopWindowOptions();
  const { icon, ...stableOptions } = options;

  assert.equal(isPanelBrandLogoPath(icon), true);
  assert.deepEqual(stableOptions, {
    title: "AgentArbor",
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    kind: "main",
    startup: {
      initialWidth: 718,
      initialHeight: 404,
      theme: {
        styleId: "default",
        colorId: "light",
        backgroundColor: "#f5f7fa",
        shellColor: "#ffffff",
        borderColor: "#b8c5d6",
        textColor: "#18212f",
        mainWindow: {
          width: 1440,
          height: 960,
        },
      },
    },
    frame: false,
    transparent: false,
    resizable: true,
    maximizable: true,
    hasShadow: false,
    center: true,
    backgroundColor: "#f5f7fa",
    show: false,
    autoHideMenuBar: true,
    startupAnimationEnabled: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      partition: "persist:agentarbor",
    },
  } satisfies Omit<PanelDesktopWindowOptions, "icon">);

  assert.equal(createPanelDesktopWindowOptionsWithStartupAnimation(false).startupAnimationEnabled, false);
});

test("startup animation preserves native window resize, maximize, and restore", () => {
  const animatedOptions = createPanelDesktopWindowOptionsWithStartupAnimation(true);

  assert.equal(animatedOptions.startupAnimationEnabled, true);
  assert.equal(animatedOptions.transparent, false);
  assert.equal(animatedOptions.resizable, true);
  assert.equal(animatedOptions.maximizable, true);
  assert.notEqual(animatedOptions.backgroundColor, "#00000000");
});

test("panel desktop smoke starts and closes the local server without creating a window", async () => {
  const calls: {
    start: Array<{
      host?: string;
      port?: number;
      configDirectory?: string;
    }>;
    windows: PanelDesktopWindowOptions[];
    loads: string[];
    quits: number;
    closes: number;
    sessionClosed: number;
  } = {
    start: [],
    windows: [],
    loads: [],
    quits: 0,
    closes: 0,
    sessionClosed: 0,
  };
  let beforeQuitHandler: (() => Promise<void>) | undefined;
  let windowAllClosedHandler: (() => void) | undefined;
  const dependencies: PanelDesktopDependencies = {
    startPanelServer: async (options) => {
      calls.start.push({
        host: options.host ?? "127.0.0.1",
        port: options.port ?? 9090,
        configDirectory: options.configDirectory,
      });
      return {
        url: "http://127.0.0.1:54321/",
        configDirectory: options.configDirectory,
        close: async () => {
          calls.closes += 1;
        },
      };
    },
    createWindow: (options) => {
      calls.windows.push(options);
      const window = createFakePanelDesktopWindow();
      return {
        ...window,
        loadUrl: async (url) => {
          calls.loads.push(url);
        },
      };
    },
    whenReady: Promise.resolve(),
    onBeforeQuit: (handler) => {
      beforeQuitHandler = handler;
    },
    onWindowAllClosed: (handler) => {
      windowAllClosedHandler = handler;
    },
    onSessionClosed: () => {
      calls.sessionClosed += 1;
    },
    quit: () => {
      calls.quits += 1;
    },
  };

  const session = await startPanelDesktopSession(
    {
      host: "127.0.0.1",
      port: 0,
      smoke: true,
      windowSmoke: false,
    },
    dependencies
  );

  assert.equal(session.url, "http://127.0.0.1:54321/");
  assert.equal(session.configDirectory, undefined);
  assert.equal(calls.start.length, 1);
  assert.deepEqual(calls.start[0], {
    host: "127.0.0.1",
    port: 0,
    configDirectory: undefined,
  });
  assert.equal(calls.windows.length, 0);
  assert.equal(calls.loads.length, 0);
  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);
  assert.equal(calls.quits, 1);
  assert.equal(beforeQuitHandler !== undefined, true);
  assert.equal(windowAllClosedHandler !== undefined, true);

  await beforeQuitHandler?.();
  await flushMicrotasks();
  windowAllClosedHandler?.();
  await flushMicrotasks();

  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);
  assert.equal(calls.quits, 2);
});

test("panel desktop session can load a Vite dev url while keeping the local API server", async () => {
  const calls = {
    start: 0,
    loads: [] as string[],
  };
  const dependencies: PanelDesktopDependencies = {
    startPanelServer: async () => {
      calls.start += 1;
      return {
        url: "http://127.0.0.1:54329/",
        close: async () => undefined,
      };
    },
    createWindow: () => ({
      ...createFakePanelDesktopWindow(),
      loadUrl: async (url) => {
        calls.loads.push(url);
      },
    }),
    whenReady: Promise.resolve(),
    onBeforeQuit: () => undefined,
    onWindowAllClosed: () => undefined,
    quit: () => undefined,
  };

  const session = await startPanelDesktopSession(
    {
      host: "127.0.0.1",
      port: 0,
      smoke: false,
      windowSmoke: false,
      devUrl: "http://127.0.0.1:4305/",
    },
    dependencies
  );

  assert.equal(calls.start, 1);
  assert.equal(session.url, "http://127.0.0.1:4305/");
  assert.deepEqual(calls.loads, ["http://127.0.0.1:4305/"]);
});

test("panel desktop session loads the panel url and closes on quit", async () => {
  const calls = {
    start: 0,
    windows: [] as PanelDesktopWindowOptions[],
    loads: [] as string[],
    closes: 0,
    quits: 0,
    sessionClosed: 0,
  };
  let beforeQuitHandler: (() => Promise<void>) | undefined;
  let windowAllClosedHandler: (() => void) | undefined;
  let createdWindow: FakePanelDesktopWindow | undefined;
  const dependencies: PanelDesktopDependencies = {
    startPanelServer: async () => {
      calls.start += 1;
      return {
        url: "http://127.0.0.1:54322/",
        configDirectory: "C:/agentarbor",
        close: async () => {
          calls.closes += 1;
        },
      };
    },
    createWindow: (options) => {
      calls.windows.push(options);
      createdWindow = createFakePanelDesktopWindow();
      return {
        ...createdWindow,
        loadUrl: async (url) => {
          calls.loads.push(url);
          await createdWindow?.loadUrl(url);
        },
      };
    },
    whenReady: Promise.resolve(),
    onBeforeQuit: (handler) => {
      beforeQuitHandler = handler;
    },
    onWindowAllClosed: (handler) => {
      windowAllClosedHandler = handler;
    },
    onSessionClosed: () => {
      calls.sessionClosed += 1;
    },
    quit: () => {
      calls.quits += 1;
    },
  };

  const session = await startPanelDesktopSession(
    {
      host: "127.0.0.1",
      port: 0,
      smoke: false,
      windowSmoke: false,
      configDirectory: "C:/agentarbor",
    },
    dependencies
  );

  assert.equal(session.url, "http://127.0.0.1:54322/");
  assert.equal(session.configDirectory, "C:/agentarbor");
  assert.equal(calls.start, 1);
  assert.equal(calls.windows.length, 1);
  assert.deepEqual(calls.loads, ["http://127.0.0.1:54322/"]);
  assert.equal(calls.closes, 0);
  assert.equal(calls.sessionClosed, 0);
  assert.equal(calls.quits, 0);
  assert.equal(calls.windows[0]?.webPreferences.contextIsolation, true);
  assert.equal(calls.windows[0]?.webPreferences.nodeIntegration, false);
  assert.equal(calls.windows[0]?.webPreferences.sandbox, true);
  assert.equal(calls.windows[0]?.webPreferences.webviewTag, false);
  assert.equal(createdWindow?.getShowCount(), 1);

  windowAllClosedHandler?.();
  await flushMicrotasks();
  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);
  assert.equal(calls.quits, 1);

  await beforeQuitHandler?.();
  await flushMicrotasks();
  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);

  await session.close();
  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);
});

test("panel desktop session shares an in-flight server close across quit signals", async () => {
  let beforeQuitHandler: (() => Promise<void>) | undefined;
  let windowAllClosedHandler: (() => void) | undefined;
  let resolveClose!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const calls = { closes: 0, quits: 0, sessionClosed: 0 };
  const session = await startPanelDesktopSession(
    {
      host: "127.0.0.1",
      port: 0,
      smoke: false,
      windowSmoke: false,
    },
    {
      startPanelServer: async () => ({
        url: "http://127.0.0.1:54330/",
        close: async () => {
          calls.closes += 1;
          await closeGate;
        },
      }),
      createWindow: () => createFakePanelDesktopWindow(),
      whenReady: Promise.resolve(),
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      onWindowAllClosed: (handler) => {
        windowAllClosedHandler = handler;
      },
      onSessionClosed: () => {
        calls.sessionClosed += 1;
      },
      quit: () => {
        calls.quits += 1;
      },
    },
  );

  windowAllClosedHandler?.();
  await flushMicrotasks();
  const beforeQuit = beforeQuitHandler?.();
  await flushMicrotasks();

  assert.equal(calls.closes, 1);
  assert.equal(calls.quits, 0);
  assert.equal(calls.sessionClosed, 0);

  resolveClose();
  await beforeQuit;
  await flushMicrotasks();

  assert.equal(calls.closes, 1);
  assert.equal(calls.quits, 1);
  assert.equal(calls.sessionClosed, 1);
  await session.close();
  assert.equal(calls.closes, 1);
});

test("panel desktop session injects host pickers only outside smoke mode", async () => {
  const calls: Array<{ readonly hasWorkspacePicker: boolean; readonly hasRestorePicker: boolean }> = [];
  let pickerCalls = 0;
  let restorePickerCalls = 0;
  const dependencies: PanelDesktopDependencies = {
    startPanelServer: async (options) => {
      calls.push({
        hasWorkspacePicker: options.workspaceDirectoryPicker !== undefined,
        hasRestorePicker: options.workbenchRestorePicker !== undefined,
      });
      if (options.workspaceDirectoryPicker !== undefined) {
        const selected = await options.workspaceDirectoryPicker();
        assert.equal(selected, "C:/picked-workspace");
      }
      if (options.workbenchRestorePicker !== undefined) {
        const selected = await options.workbenchRestorePicker();
        assert.equal(selected, "C:/backup/workbench.sqlite3");
      }
      return {
        url: "http://127.0.0.1:54326/",
        close: async () => undefined,
      };
    },
    createWindow: () => createFakePanelDesktopWindow(),
    selectWorkspaceDirectory: async () => {
      pickerCalls += 1;
      return "C:/picked-workspace";
    },
    selectWorkbenchRestore: async () => {
      restorePickerCalls += 1;
      return "C:/backup/workbench.sqlite3";
    },
    whenReady: Promise.resolve(),
    onBeforeQuit: () => undefined,
    onWindowAllClosed: () => undefined,
    quit: () => undefined,
  };

  await startPanelDesktopSession(
    {
      host: "127.0.0.1",
      port: 0,
      smoke: true,
      windowSmoke: false,
    },
    dependencies
  );
  await startPanelDesktopSession(
    {
      host: "127.0.0.1",
      port: 0,
      smoke: false,
      windowSmoke: false,
    },
    dependencies
  );

  assert.deepEqual(calls, [
    { hasWorkspacePicker: false, hasRestorePicker: false },
    { hasWorkspacePicker: true, hasRestorePicker: true },
  ]);
  assert.equal(pickerCalls, 1);
  assert.equal(restorePickerCalls, 1);
});

test("panel desktop session keeps ready-to-show and load fallback display idempotent", async () => {
  let createdWindow: FakePanelDesktopWindow | undefined;
  const dependencies: PanelDesktopDependencies = {
    startPanelServer: async () => ({
      url: "http://127.0.0.1:54324/",
      close: async () => undefined,
    }),
    createWindow: () => {
      createdWindow = createFakePanelDesktopWindow();
      return {
        ...createdWindow,
        loadUrl: async (url) => {
          await createdWindow?.loadUrl(url);
          createdWindow?.triggerReadyToShow();
        },
      };
    },
    whenReady: Promise.resolve(),
    onBeforeQuit: () => undefined,
    onWindowAllClosed: () => undefined,
    quit: () => undefined,
  };

  await startPanelDesktopSession(
    {
      host: "127.0.0.1",
      port: 0,
      smoke: false,
      windowSmoke: false,
    },
    dependencies
  );

  assert.deepEqual(createdWindow?.loads, ["http://127.0.0.1:54324/"]);
  assert.equal(createdWindow?.getShowCount(), 1);
  createdWindow?.triggerReadyToShow();
  assert.equal(createdWindow?.getShowCount(), 1);
});

test("panel desktop session does not show a destroyed window after load", async () => {
  let createdWindow: FakePanelDesktopWindow | undefined;
  const dependencies: PanelDesktopDependencies = {
    startPanelServer: async () => ({
      url: "http://127.0.0.1:54325/",
      close: async () => undefined,
    }),
    createWindow: () => {
      createdWindow = createFakePanelDesktopWindow();
      return {
        ...createdWindow,
        loadUrl: async (url) => {
          await createdWindow?.loadUrl(url);
          createdWindow?.destroy();
        },
      };
    },
    whenReady: Promise.resolve(),
    onBeforeQuit: () => undefined,
    onWindowAllClosed: () => undefined,
    quit: () => undefined,
  };

  await startPanelDesktopSession(
    {
      host: "127.0.0.1",
      port: 0,
      smoke: false,
      windowSmoke: false,
    },
    dependencies
  );

  assert.deepEqual(createdWindow?.loads, ["http://127.0.0.1:54325/"]);
  assert.equal(createdWindow?.getShowCount(), 0);
});

test("panel desktop session closes the local server when Electron startup fails", async () => {
  const calls = {
    closes: 0,
    windows: 0,
    quits: 0,
    sessionClosed: 0,
  };
  const dependencies: PanelDesktopDependencies = {
    startPanelServer: async () => ({
      url: "http://127.0.0.1:54323/",
      close: async () => {
        calls.closes += 1;
      },
    }),
    createWindow: () => {
      calls.windows += 1;
      return createFakePanelDesktopWindow();
    },
    whenReady: Promise.reject(new Error("electron ready failed")),
    onBeforeQuit: () => undefined,
    onWindowAllClosed: () => undefined,
    onSessionClosed: () => {
      calls.sessionClosed += 1;
    },
    quit: () => {
      calls.quits += 1;
    },
  };

  await assert.rejects(
    () =>
      startPanelDesktopSession(
        {
          host: "127.0.0.1",
          port: 0,
          smoke: false,
          windowSmoke: false,
        },
        dependencies
      ),
    /electron ready failed/
  );

  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);
  assert.equal(calls.windows, 0);
  assert.equal(calls.quits, 0);
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

type FakePanelDesktopWindow = PanelDesktopWindowHandle & {
  readonly loads: string[];
  readonly getShowCount: () => number;
  readonly triggerReadyToShow: () => void;
  readonly destroy: () => void;
};

function createFakePanelDesktopWindow(): FakePanelDesktopWindow {
  const loads: string[] = [];
  let readyToShowHandler: (() => void) | undefined;
  let showCount = 0;
  let visible = false;
  let destroyed = false;

  return {
    loads,
    getShowCount: () => showCount,
    triggerReadyToShow: () => {
      readyToShowHandler?.();
    },
    destroy: () => {
      destroyed = true;
    },
    loadUrl: async (url) => {
      loads.push(url);
    },
    onReadyToShow: (handler) => {
      readyToShowHandler = handler;
    },
    show: () => {
      showCount += 1;
      visible = true;
    },
    isVisible: () => visible,
    isDestroyed: () => destroyed,
  };
}

function isPanelBrandLogoPath(value: string): boolean {
  return (
    value.endsWith(path.join("src", "app", "panel-ui", "public", "favicon.png")) ||
    value.endsWith(path.join("dist", "app", "panel-ui", "favicon.png"))
  );
}
