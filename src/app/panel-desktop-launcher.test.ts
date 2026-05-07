import assert from "node:assert/strict";
import test from "node:test";
import {
  createPanelDesktopWindowOptions,
  startPanelDesktopSession,
  type PanelDesktopDependencies,
  type PanelDesktopWindowHandle,
  type PanelDesktopWindowOptions,
} from "./panel-desktop-launcher.js";

test("panel desktop window options keep secure defaults", () => {
  const options = createPanelDesktopWindowOptions();

  assert.deepEqual(options, {
    title: "AgentArbor Desktop Shell",
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
  } satisfies PanelDesktopWindowOptions);
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
  let beforeQuitHandler: (() => void) | undefined;
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

  beforeQuitHandler?.();
  await flushMicrotasks();
  windowAllClosedHandler?.();
  await flushMicrotasks();

  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);
  assert.equal(calls.quits, 2);
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
  let beforeQuitHandler: (() => void) | undefined;
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

  beforeQuitHandler?.();
  await flushMicrotasks();
  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);

  await session.close();
  assert.equal(calls.closes, 1);
  assert.equal(calls.sessionClosed, 1);
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
