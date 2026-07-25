import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  StartupIntroOverlay,
  useStartupIntro,
  type StartupIntroReveal,
  type StartupIntroTiming,
} from "./app-startup-intro";

test("startup overlay exposes one status surface and notifies the desktop host when painted", async () => {
  const notifyStartupOverlayReady = vi.fn();
  vi.stubGlobal("agentarborDesktop", { notifyStartupOverlayReady });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  render(
    <StartupIntroOverlay
      phase="expanding"
      sidebarCollapsed
      timing={STARTUP_TIMING}
      reveal={STARTUP_REVEAL}
    />,
  );

  const status = screen.getByRole("status");
  expect(status.getAttribute("data-phase")).toBe("expanding");
  expect(status.getAttribute("data-sidebar-collapsed")).toBe("true");
  expect(screen.getByLabelText("今天想处理什么？")).toBeTruthy();
  await waitFor(() => expect(notifyStartupOverlayReady).toHaveBeenCalledTimes(1));
});

test("disabled startup animation begins directly in the completed phase", () => {
  render(<StartupStateProbe />);

  expect(screen.getByTestId("startup-state").textContent).toBe("done:none");
});

test("startup animation already consumed by the desktop host begins directly in the completed phase", () => {
  render(<StartupStateProbe startupAnimationEnabled startupAnimationAllowed={false} />);

  expect(screen.getByTestId("startup-state").textContent).toBe("done:none");
});

test("startup animation completes when animation frames are suspended", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  try {
    render(<StartupStateProbe startupAnimationEnabled />);

    for (let phase = 0; phase < 8; phase += 1) {
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
    }

    expect(screen.getByTestId("startup-state").textContent).toBe("done:none");
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

function StartupStateProbe(props: {
  readonly startupAnimationEnabled?: boolean;
  readonly startupAnimationAllowed?: boolean;
} = {}): React.ReactElement {
  const state = useStartupIntro(false, props);
  return <output data-testid="startup-state">{`${state.phase}:${state.overlayPhase ?? "none"}`}</output>;
}

const STARTUP_TIMING: StartupIntroTiming = {
  textPrintDurationMs: 100,
  shellExpandDurationMs: 100,
  surfaceOutDelayMs: 0,
  surfaceOutDurationMs: 100,
  appRevealDurationMs: 100,
  sidebarRevealDelayMs: 0,
  workbenchRevealDelayMs: 0,
  topbarRevealDelayMs: 0,
  mainRevealDelayMs: 0,
  composerSettleDelayMs: 0,
  titleBridgeDurationMs: 100,
  phaseDurationMs: 200,
};

const STARTUP_REVEAL: StartupIntroReveal = {
  reducedMotion: false,
  nativeExpanded: true,
  startupRect: { x: 100, y: 100, width: 718, height: 404 },
  targetWindow: { width: 1440, height: 960 },
};
