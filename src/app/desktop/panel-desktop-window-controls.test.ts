import assert from "node:assert/strict";
import test from "node:test";
import {
  createDesktopWindowNativeEventState,
  readDesktopWindowPresentationState,
  recordDesktopWindowMaximized,
  toggleDesktopWindowMaximize,
  type DesktopWindowControlTarget,
} from "./panel-desktop-window-controls.js";

test("desktop window maximize toggle delegates geometry to native window controls", () => {
  const window = createFakeDesktopWindow();
  const state = createDesktopWindowNativeEventState();

  toggleDesktopWindowMaximize(window, state);
  assert.equal(window.maximizeCalls, 1);
  assert.equal(window.unmaximizeCalls, 0);

  window.nativeMaximized = true;
  toggleDesktopWindowMaximize(window, state);
  assert.equal(window.maximizeCalls, 1);
  assert.equal(window.unmaximizeCalls, 1);
});

test("desktop window maximize toggle exits fullscreen before changing maximize state", () => {
  const window = createFakeDesktopWindow();
  const state = createDesktopWindowNativeEventState();
  window.fullScreen = true;

  toggleDesktopWindowMaximize(window, state);

  assert.equal(window.fullScreen, false);
  assert.equal(window.maximizeCalls, 0);
  assert.equal(window.unmaximizeCalls, 0);
});

test("desktop window maximize toggle ignores destroyed windows", () => {
  const window = createFakeDesktopWindow();
  const state = createDesktopWindowNativeEventState();
  window.destroyed = true;

  toggleDesktopWindowMaximize(window, state);

  assert.equal(window.maximizeCalls, 0);
  assert.equal(window.unmaximizeCalls, 0);
});

test("desktop window presentation reads native query and event state", () => {
  const window = createFakeDesktopWindow();
  const state = createDesktopWindowNativeEventState();

  assert.deepEqual(readDesktopWindowPresentationState(window, state), {
    maximized: false,
    animating: false,
  });

  window.nativeMaximized = true;
  assert.deepEqual(readDesktopWindowPresentationState(window, state), {
    maximized: true,
    animating: false,
  });

  window.nativeMaximized = false;
  window.fullScreen = true;
  assert.deepEqual(readDesktopWindowPresentationState(window, state), {
    maximized: true,
    animating: false,
  });
});

test("desktop window restores after a maximize event when isMaximized stays false", () => {
  const window = createFakeDesktopWindow();
  const state = createDesktopWindowNativeEventState();

  toggleDesktopWindowMaximize(window, state);
  assert.equal(state.maximized, false);

  recordDesktopWindowMaximized(state, true);
  assert.deepEqual(readDesktopWindowPresentationState(window, state), {
    maximized: true,
    animating: false,
  });

  toggleDesktopWindowMaximize(window, state);
  assert.equal(window.unmaximizeCalls, 1);

  recordDesktopWindowMaximized(state, false);
  assert.deepEqual(readDesktopWindowPresentationState(window, state), {
    maximized: false,
    animating: false,
  });
});

type FakeDesktopWindow = DesktopWindowControlTarget & {
  destroyed: boolean;
  fullScreen: boolean;
  maximizeCalls: number;
  unmaximizeCalls: number;
  nativeMaximized: boolean;
};

function createFakeDesktopWindow(): FakeDesktopWindow {
  const window: FakeDesktopWindow = {
    destroyed: false,
    fullScreen: false,
    maximizeCalls: 0,
    unmaximizeCalls: 0,
    nativeMaximized: false,
    isDestroyed: () => window.destroyed,
    isFullScreen: () => window.fullScreen,
    setFullScreen: (fullScreen) => {
      window.fullScreen = fullScreen;
    },
    isMaximized: () => window.nativeMaximized,
    maximize: () => {
      window.maximizeCalls += 1;
    },
    unmaximize: () => {
      window.unmaximizeCalls += 1;
    },
  };
  return window;
}
