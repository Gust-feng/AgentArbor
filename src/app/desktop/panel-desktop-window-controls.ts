import { performance } from "node:perf_hooks";

export type DesktopWindowBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type DesktopWindowMaximizeState = {
  normalBoundsBeforeMaximize: DesktopWindowBounds | undefined;
  maximizedByWindowControl: boolean;
  animationTimer: ReturnType<typeof setTimeout> | undefined;
};

export type DesktopWindowControlTarget = {
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  setFullScreen(fullScreen: boolean): void;
  isMaximized(): boolean;
  unmaximize(): void;
  getBounds(): DesktopWindowBounds;
  setBounds(bounds: DesktopWindowBounds): void;
};

export type DesktopWindowPresentationState = {
  readonly maximized: boolean;
  readonly animating: boolean;
};

export type DesktopWindowMaximizeOptions = {
  readonly targetBounds: DesktopWindowBounds;
  readonly durationMs?: number;
  readonly frameMs?: number;
  readonly onStateChange?: (state: DesktopWindowPresentationState) => void;
};

export function createDesktopWindowMaximizeState(): DesktopWindowMaximizeState {
  return {
    normalBoundsBeforeMaximize: undefined,
    maximizedByWindowControl: false,
    animationTimer: undefined,
  };
}

export function clearDesktopWindowMaximizeState(state: DesktopWindowMaximizeState): void {
  clearDesktopWindowAnimation(state);
  state.normalBoundsBeforeMaximize = undefined;
  state.maximizedByWindowControl = false;
}

export function toggleDesktopWindowMaximize(
  window: DesktopWindowControlTarget,
  state: DesktopWindowMaximizeState,
  options: DesktopWindowMaximizeOptions
): void {
  if (window.isDestroyed()) return;
  if (shouldRestoreDesktopWindow(window, state)) {
    restoreDesktopWindow(window, state, options);
    return;
  }
  state.normalBoundsBeforeMaximize = window.getBounds();
  state.maximizedByWindowControl = true;
  notifyDesktopWindowPresentationState(window, state, options);
  animateDesktopWindowBounds(window, state, options.targetBounds, options);
}

export function readDesktopWindowPresentationState(
  window: DesktopWindowControlTarget,
  state: DesktopWindowMaximizeState
): DesktopWindowPresentationState {
  return {
    maximized: window.isFullScreen() || window.isMaximized() || state.maximizedByWindowControl,
    animating: state.animationTimer !== undefined,
  };
}

function shouldRestoreDesktopWindow(
  window: DesktopWindowControlTarget,
  state: DesktopWindowMaximizeState
): boolean {
  return window.isFullScreen() || window.isMaximized() || state.maximizedByWindowControl;
}

function restoreDesktopWindow(
  window: DesktopWindowControlTarget,
  state: DesktopWindowMaximizeState,
  options: DesktopWindowMaximizeOptions
): void {
  const normalBounds = state.normalBoundsBeforeMaximize;
  clearDesktopWindowMaximizeState(state);
  notifyDesktopWindowPresentationState(window, state, options);
  if (window.isFullScreen()) {
    window.setFullScreen(false);
  }
  if (window.isMaximized()) {
    window.unmaximize();
  }
  if (normalBounds !== undefined) {
    animateDesktopWindowBounds(window, state, normalBounds, options);
  }
}

function animateDesktopWindowBounds(
  window: DesktopWindowControlTarget,
  state: DesktopWindowMaximizeState,
  targetBounds: DesktopWindowBounds,
  options: DesktopWindowMaximizeOptions
): void {
  clearDesktopWindowAnimation(state);
  const durationMs = Math.max(0, options.durationMs ?? 180);
  const frameMs = Math.max(1, options.frameMs ?? 16);
  const startBounds = window.getBounds();
  if (durationMs === 0 || boundsEqual(startBounds, targetBounds)) {
    window.setBounds(targetBounds);
    notifyDesktopWindowPresentationState(window, state, options);
    return;
  }
  const startedAt = performance.now();
  const tick = () => {
    if (window.isDestroyed()) {
      clearDesktopWindowAnimation(state);
      notifyDesktopWindowPresentationState(window, state, options);
      return;
    }
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
    const easedProgress = easeOutCubic(progress);
    window.setBounds(interpolateBounds(startBounds, targetBounds, easedProgress));
    if (progress >= 1) {
      state.animationTimer = undefined;
      window.setBounds(targetBounds);
      notifyDesktopWindowPresentationState(window, state, options);
      return;
    }
    state.animationTimer = setTimeout(tick, frameMs);
    state.animationTimer.unref?.();
  };
  state.animationTimer = setTimeout(tick, 0);
  state.animationTimer.unref?.();
  notifyDesktopWindowPresentationState(window, state, options);
}

function clearDesktopWindowAnimation(state: DesktopWindowMaximizeState): void {
  if (state.animationTimer === undefined) return;
  clearTimeout(state.animationTimer);
  state.animationTimer = undefined;
}

function notifyDesktopWindowPresentationState(
  window: DesktopWindowControlTarget,
  state: DesktopWindowMaximizeState,
  options: DesktopWindowMaximizeOptions
): void {
  options.onStateChange?.(readDesktopWindowPresentationState(window, state));
}

function interpolateBounds(
  start: DesktopWindowBounds,
  end: DesktopWindowBounds,
  progress: number
): DesktopWindowBounds {
  return {
    x: interpolateInteger(start.x, end.x, progress),
    y: interpolateInteger(start.y, end.y, progress),
    width: interpolateInteger(start.width, end.width, progress),
    height: interpolateInteger(start.height, end.height, progress),
  };
}

function interpolateInteger(start: number, end: number, progress: number): number {
  return Math.round(start + (end - start) * progress);
}

function easeOutCubic(progress: number): number {
  const remaining = 1 - progress;
  return 1 - remaining * remaining * remaining;
}

function boundsEqual(left: DesktopWindowBounds, right: DesktopWindowBounds): boolean {
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height;
}
