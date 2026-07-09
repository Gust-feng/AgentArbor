import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDesktopWindowMaximizeState,
  createDesktopWindowMaximizeState,
  readDesktopWindowPresentationState,
  toggleDesktopWindowMaximize,
  type DesktopWindowBounds,
  type DesktopWindowControlTarget,
} from "./panel-desktop-window-controls.js";

test("desktop window maximize toggle restores the previous bounds", () => {
  const normalBounds = { x: 120, y: 80, width: 1440, height: 960 };
  const maximizedBounds = { x: 0, y: 0, width: 1920, height: 1040 };
  const window = createFakeDesktopWindow(normalBounds);
  const state = createDesktopWindowMaximizeState();

  toggleDesktopWindowMaximize(window, state, { targetBounds: maximizedBounds, durationMs: 0 });
  assert.deepEqual(window.bounds, maximizedBounds);
  assert.equal(state.maximizedByWindowControl, true);
  assert.deepEqual(state.normalBoundsBeforeMaximize, normalBounds);
  assert.deepEqual(readDesktopWindowPresentationState(window, state), {
    maximized: true,
    animating: false,
  });

  toggleDesktopWindowMaximize(window, state, { targetBounds: maximizedBounds, durationMs: 0 });
  assert.equal(window.unmaximizeCalls, 0);
  assert.deepEqual(window.bounds, normalBounds);
  assert.equal(state.maximizedByWindowControl, false);
  assert.equal(state.normalBoundsBeforeMaximize, undefined);
  assert.deepEqual(readDesktopWindowPresentationState(window, state), {
    maximized: false,
    animating: false,
  });
});

test("desktop window maximize toggle restores even when native maximized state is not reported", () => {
  const normalBounds = { x: 90, y: 60, width: 1320, height: 900 };
  const maximizedBounds = { x: 0, y: 0, width: 1920, height: 1040 };
  const window = createFakeDesktopWindow(normalBounds);
  const state = createDesktopWindowMaximizeState();

  toggleDesktopWindowMaximize(window, state, { targetBounds: maximizedBounds, durationMs: 0 });
  assert.deepEqual(window.bounds, maximizedBounds);
  assert.equal(window.isMaximized(), false);

  toggleDesktopWindowMaximize(window, state, { targetBounds: maximizedBounds, durationMs: 0 });
  assert.equal(window.unmaximizeCalls, 0);
  assert.deepEqual(window.bounds, normalBounds);
  assert.equal(state.maximizedByWindowControl, false);
});

test("desktop window maximize state can be cleared after an external restore", () => {
  const window = createFakeDesktopWindow(
    { x: 100, y: 70, width: 1400, height: 920 }
  );
  const state = createDesktopWindowMaximizeState();

  toggleDesktopWindowMaximize(window, state, {
    targetBounds: { x: 0, y: 0, width: 1920, height: 1040 },
    durationMs: 0,
  });
  window.bounds = { x: 100, y: 70, width: 1400, height: 920 };
  clearDesktopWindowMaximizeState(state);
  toggleDesktopWindowMaximize(window, state, {
    targetBounds: { x: 0, y: 0, width: 1920, height: 1040 },
    durationMs: 0,
  });

  assert.equal(state.maximizedByWindowControl, true);
  assert.deepEqual(window.bounds, { x: 0, y: 0, width: 1920, height: 1040 });
});

test("desktop window maximize toggle reports animation state", () => {
  const window = createFakeDesktopWindow({ x: 80, y: 48, width: 1280, height: 860 });
  const state = createDesktopWindowMaximizeState();
  const reportedStates: Array<{ readonly maximized: boolean; readonly animating: boolean }> = [];

  toggleDesktopWindowMaximize(window, state, {
    targetBounds: { x: 0, y: 0, width: 1920, height: 1040 },
    durationMs: 180,
    onStateChange: (nextState) => {
      reportedStates.push(nextState);
    },
  });

  assert.deepEqual(reportedStates.slice(0, 2), [
    { maximized: true, animating: false },
    { maximized: true, animating: true },
  ]);
  clearDesktopWindowMaximizeState(state);
});

type FakeDesktopWindow = DesktopWindowControlTarget & {
  bounds: DesktopWindowBounds;
  unmaximizeCalls: number;
  nativeMaximized: boolean;
};

function createFakeDesktopWindow(initialBounds: DesktopWindowBounds): FakeDesktopWindow {
  const window: FakeDesktopWindow = {
    bounds: initialBounds,
    unmaximizeCalls: 0,
    nativeMaximized: false,
    isDestroyed: () => false,
    isFullScreen: () => false,
    setFullScreen: () => undefined,
    isMaximized: () => window.nativeMaximized,
    unmaximize: () => {
      window.unmaximizeCalls += 1;
      window.nativeMaximized = false;
      window.bounds = initialBounds;
    },
    getBounds: () => window.bounds,
    setBounds: (bounds) => {
      window.bounds = bounds;
    },
  };
  return window;
}
