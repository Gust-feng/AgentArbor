import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  STARTUP_INTRO_TEXT,
  createStartupIntroDefaultWindowSize,
  createStartupIntroWindowSize,
} from "../../panel-startup-intro-geometry";
import { isReducedMotionEffective, subscribeMotionSettingsChanged } from "./app-motion";

export type StartupIntroPhase = "loading" | "handoff-ready" | "expanding" | "title-ready" | "title-handoff" | "done";
export type StartupIntroVisiblePhase = Exclude<StartupIntroPhase, "done">;
type StartupRuntimeMode = "single-window" | "main-window";

type StartupIntroSize = {
  readonly width: number;
  readonly height: number;
};

type StartupIntroRect = StartupIntroSize & {
  readonly x: number;
  readonly y: number;
};

export type StartupIntroReveal = {
  readonly reducedMotion: boolean;
  readonly nativeExpanded: boolean;
  readonly startupRect: StartupIntroRect;
  readonly targetWindow: StartupIntroSize;
};

export type StartupIntroTiming = {
  readonly textPrintDurationMs: number;
  readonly shellExpandDurationMs: number;
  readonly surfaceOutDelayMs: number;
  readonly surfaceOutDurationMs: number;
  readonly appRevealDurationMs: number;
  readonly sidebarRevealDelayMs: number;
  readonly workbenchRevealDelayMs: number;
  readonly topbarRevealDelayMs: number;
  readonly mainRevealDelayMs: number;
  readonly composerSettleDelayMs: number;
  readonly titleBridgeDurationMs: number;
  readonly phaseDurationMs: number;
};

export type StartupIntroState = {
  readonly phase: StartupIntroPhase;
  readonly overlayPhase: StartupIntroVisiblePhase | undefined;
  readonly timing: StartupIntroTiming;
  readonly reveal: StartupIntroReveal | undefined;
};

type StartupIntroOptions = {
  readonly startupAnimationEnabled?: boolean;
};

type StartupIntroWindowExpansion = {
  readonly durationMs: number;
  readonly nativeExpanded?: boolean;
  readonly startupRect?: Partial<StartupIntroRect>;
  readonly targetWindow?: Partial<StartupIntroSize>;
};

type StartupIntroRendererFrameStats = {
  readonly frameCount: number;
  readonly maxFrameMs: number;
  readonly maxFrameAtMs: number;
  readonly averageFrameMs: number;
  readonly totalMs: number;
  readonly visual?: StartupIntroRendererVisualStats;
};

type StartupIntroRendererFrameProbe = {
  readonly finish: () => StartupIntroRendererFrameStats;
};

type StartupIntroTitleBridgeAnimation = {
  readonly cancel: () => void;
};

type StartupIntroRendererVisualStats = {
  readonly sampleCount: number;
  readonly shellNodeMax: number;
  readonly missingOverlayCount: number;
  readonly missingFrameCount: number;
  readonly missingTextCount: number;
  readonly duplicateHeadingVisibleCount: number;
  readonly visibleChromeDuringExpansionCount: number;
  readonly overlayBackgroundOpaqueCount: number;
  readonly seenExpandingOpaqueSurface: boolean;
  readonly seenExpandingTransparentSurface: boolean;
  readonly titleHandoffSampleCount: number;
  readonly titleHandoffOpaqueSurfaceCount: number;
  readonly titleHandoffMaxCenterErrorPx: number;
  readonly titleHandoffMaxSizeErrorPx: number;
  readonly titleHandoffMinCenterErrorPx: number;
  readonly titleHandoffLastCenterErrorPx: number;
  readonly titleHandoffLastSizeErrorPx: number;
};

type StartupIntroRendererVisualStatsDraft = {
  sampleCount: number;
  shellNodeMax: number;
  missingOverlayCount: number;
  missingFrameCount: number;
  missingTextCount: number;
  duplicateHeadingVisibleCount: number;
  visibleChromeDuringExpansionCount: number;
  overlayBackgroundOpaqueCount: number;
  seenExpandingOpaqueSurface: boolean;
  seenExpandingTransparentSurface: boolean;
  titleHandoffSampleCount: number;
  titleHandoffOpaqueSurfaceCount: number;
  titleHandoffMaxCenterErrorPx: number;
  titleHandoffMaxSizeErrorPx: number;
  titleHandoffMinCenterErrorPx: number;
  titleHandoffLastCenterErrorPx: number;
  titleHandoffLastSizeErrorPx: number;
  titleHandoffStartedAtMs: number | undefined;
  lastVisualHeavySampleAtMs: number | undefined;
};

type StartupIntroRendererFrameProbeOptions = {
  readonly collectVisualStats?: boolean;
  readonly titleHandoffSettleMs?: number;
};

type StartupIntroLayoutBox = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

type StartupIntroCharStyle = React.CSSProperties & {
  readonly "--startup-intro-char-delay": string;
};

type StartupIntroOverlayStyle = React.CSSProperties;

type StartupIntroContentStyle = React.CSSProperties & {
  readonly "--startup-intro-source-x": string;
  readonly "--startup-intro-source-y": string;
  readonly "--startup-intro-source-width": string;
  readonly "--startup-intro-source-height": string;
};

type StartupIntroTitleBridgeTarget = {
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
};

const STARTUP_INTRO_DEFAULT_EXPAND_MS = 720;
const STARTUP_INTRO_EXPANSION_RESPONSE_TIMEOUT_MS = 3000;
const STARTUP_INTRO_HOME_TITLE_FONT_SIZE_PX = 46;
const STARTUP_INTRO_CHAR_ENTER_DELAY_MS = 90;
const STARTUP_INTRO_CHAR_ENTER_STAGGER_MS = 48;
const STARTUP_INTRO_CHAR_ENTER_DURATION_MS = 260;
const STARTUP_INTRO_TEXT_CHAR_COUNT = Array.from(STARTUP_INTRO_TEXT).length;
const STARTUP_INTRO_TEXT_PRINT_DURATION_MS =
  STARTUP_INTRO_CHAR_ENTER_DELAY_MS +
  Math.max(0, STARTUP_INTRO_TEXT_CHAR_COUNT - 1) * STARTUP_INTRO_CHAR_ENTER_STAGGER_MS +
  STARTUP_INTRO_CHAR_ENTER_DURATION_MS;
const STARTUP_INTRO_MIN_RECT_MS = STARTUP_INTRO_TEXT_PRINT_DURATION_MS + 180;
const STARTUP_INTRO_HANDOFF_PAINT_FRAMES = 2;
const STARTUP_INTRO_TITLE_READY_PAINT_FRAMES = 6;
const STARTUP_INTRO_TITLE_HANDOFF_SAMPLE_FRAMES = 4;
const STARTUP_INTRO_HANDOFF_HOLD_MS = 0;
const STARTUP_INTRO_VISUAL_SAMPLE_INTERVAL_MS = 80;
const REDUCED_MOTION_EXPAND_MS = 80;
const STARTUP_INTRO_TITLE_HANDOFF_SETTLE_MS = 980;
const REDUCED_MOTION_TITLE_HANDOFF_SETTLE_MS = 96;
const STARTUP_INTRO_TITLE_BRIDGE_DURATION_MS = 760;
const STARTUP_INTRO_TITLE_BRIDGE_SETTLE_BUFFER_MS = 120;
const STARTUP_INTRO_TITLE_STATIC_TRANSFORM = "translate3d(0, 0, 0) scale(1, 1)";
const STARTUP_INTRO_TIMING = {
  surfaceOutDelayMs: 220,
  surfaceOutDurationMs: 520,
  appRevealDurationMs: 520,
  workbenchRevealDelayMs: 0,
  mainRevealDelayMs: 0,
  sidebarRevealDelayMs: 220,
  topbarRevealDelayMs: 140,
  composerSettleDelayMs: 320,
  titleBridgeDurationMs: STARTUP_INTRO_TITLE_BRIDGE_DURATION_MS,
} as const;
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useStartupIntro(
  isBootstrapping: boolean,
  options: StartupIntroOptions = {},
): StartupIntroState {
  const runtimeMode = readStartupRuntimeMode();
  const startupAnimationEnabled = options.startupAnimationEnabled !== false;
  const [phase, setPhase] = useState<StartupIntroPhase>(() => startupAnimationEnabled ? "loading" : "done");
  const [reveal, setReveal] = useState<StartupIntroReveal | undefined>(undefined);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(readPrefersReducedMotion);
  const [timing, setTiming] = useState(() => createStartupIntroTiming({ reducedMotion: readPrefersReducedMotion() }));
  const handoffVisibleNotifiedRef = useRef(false);
  const introStartedAtRef = useRef(readStartupIntroNow());
  const desktopStartupRequestedRef = useRef(false);
  const disabledStartupStateAppliedRef = useRef(false);
  const disabledStartupOverlayReadyRef = useRef(false);
  const disabledStartupCompletedRef = useRef(false);
  const rendererFrameProbeRef = useRef<StartupIntroRendererFrameProbe | undefined>(undefined);
  const rendererFrameStatsRef = useRef<StartupIntroRendererFrameStats | undefined>(undefined);
  const rendererFrameStatsNotifiedRef = useRef(false);
  const notifyStartupRendererFrameStats = () => {
    if (runtimeMode !== "main-window" || rendererFrameStatsNotifiedRef.current) return;
    rendererFrameStatsNotifiedRef.current = true;
    const stats =
      rendererFrameStatsRef.current ??
      rendererFrameProbeRef.current?.finish() ??
      createStartupIntroRendererFrameStats(0, 0, 0, 0, 0);
    rendererFrameStatsRef.current = stats;
    window.agentarborDesktop?.notifyStartupRendererFrameStats(stats);
  };

  useEffect(() => {
    const update = () => setPrefersReducedMotion(readPrefersReducedMotion());
    update();
    return subscribeMotionSettingsChanged(update);
  }, []);

  useEffect(() => {
    if (startupAnimationEnabled) {
      disabledStartupStateAppliedRef.current = false;
      return;
    }
    if (disabledStartupStateAppliedRef.current) return;
    disabledStartupStateAppliedRef.current = true;
    setTiming(createStartupIntroTiming({ reducedMotion: true }));
    setReveal(undefined);
    setPhase("done");
  }, [startupAnimationEnabled]);

  useEffect(() => {
    if (runtimeMode !== "main-window" || startupAnimationEnabled || disabledStartupOverlayReadyRef.current) return;
    disabledStartupOverlayReadyRef.current = true;
    window.agentarborDesktop?.notifyStartupOverlayReady();
  }, [runtimeMode, startupAnimationEnabled]);

  useEffect(() => {
    if (runtimeMode !== "main-window" || startupAnimationEnabled || isBootstrapping) return;
    if (disabledStartupCompletedRef.current) return;
    disabledStartupCompletedRef.current = true;
    let cancelled = false;
    const reducedMotion = true;
    const finishDesktopStartup = async (): Promise<void> => {
      window.agentarborDesktop?.notifyStartupMainReady();
      await requestDesktopStartupWindowExpansion({ reducedMotion });
      if (cancelled) return;
      await requestDesktopStartupWindowBeginExpansion();
      if (cancelled) return;
      handoffVisibleNotifiedRef.current = true;
      notifyDesktopStartupMainHandoffVisible();
      notifyStartupRendererFrameStats();
    };
    void finishDesktopStartup();
    return () => {
      cancelled = true;
    };
  }, [isBootstrapping, runtimeMode, startupAnimationEnabled]);

  useEffect(() => {
    if (!startupAnimationEnabled || runtimeMode !== "main-window" || isBootstrapping || phase !== "loading") return;
    if (desktopStartupRequestedRef.current) return;
    desktopStartupRequestedRef.current = true;
    let cancelled = false;
    const printTimeout = window.setTimeout(() => {
      window.agentarborDesktop?.notifyStartupMainReady();
      void requestDesktopStartupWindowExpansion({ reducedMotion: prefersReducedMotion }).then((expansion) => {
        if (cancelled) return;
        const nextReveal = expansion === undefined
          ? createFallbackStartupReveal(prefersReducedMotion)
          : normalizeStartupExpansionReveal(expansion, prefersReducedMotion);
        setTiming(createStartupIntroTiming({ reducedMotion: prefersReducedMotion }));
        setReveal(nextReveal);
        setPhase("handoff-ready");
        void waitForStartupIntroAnimationFrames(STARTUP_INTRO_HANDOFF_PAINT_FRAMES).then(() => {
          if (cancelled) return;
          void requestDesktopStartupWindowBeginExpansion().then(() => {
            if (!cancelled) setPhase("expanding");
          });
        });
      });
    }, startupIntroRemainingMinRectMs(introStartedAtRef.current, prefersReducedMotion));
    return () => {
      cancelled = true;
      window.clearTimeout(printTimeout);
    };
  }, [isBootstrapping, runtimeMode, startupAnimationEnabled]);

  useEffect(() => {
    if (!startupAnimationEnabled || runtimeMode !== "single-window" || isBootstrapping || phase !== "loading") return;
    const timeout = window.setTimeout(() => {
      const fallbackReveal = createFallbackStartupReveal(prefersReducedMotion);
      setTiming(createStartupIntroTiming({ reducedMotion: prefersReducedMotion }));
      setReveal(fallbackReveal);
      setPhase("handoff-ready");
    }, startupIntroRemainingMinRectMs(introStartedAtRef.current, prefersReducedMotion));
    return () => window.clearTimeout(timeout);
  }, [isBootstrapping, phase, prefersReducedMotion, runtimeMode, startupAnimationEnabled]);

  useEffect(() => {
    if (phase !== "handoff-ready") return;
    if (runtimeMode === "main-window") return;
    let cancelled = false;
    let timeout: number | undefined;
    void waitForStartupIntroAnimationFrames(STARTUP_INTRO_HANDOFF_PAINT_FRAMES).then(() => {
      if (cancelled) return;
      timeout = window.setTimeout(() => {
        if (!cancelled) setPhase("expanding");
      }, prefersReducedMotion ? 0 : STARTUP_INTRO_HANDOFF_HOLD_MS);
    });
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [phase, prefersReducedMotion, reveal?.nativeExpanded, runtimeMode]);

  useEffect(() => {
    if (phase !== "title-handoff" || runtimeMode !== "main-window" || reveal?.nativeExpanded !== true) return;
    if (handoffVisibleNotifiedRef.current) return;
    const handoffVisibleMs = startupIntroMainHandoffVisibleMs(timing);
    const timeout = window.setTimeout(() => {
      handoffVisibleNotifiedRef.current = true;
      window.agentarborDesktop?.notifyStartupMainHandoffVisible();
    }, handoffVisibleMs);
    return () => window.clearTimeout(timeout);
  }, [phase, reveal?.nativeExpanded, runtimeMode, timing]);

  useEffect(() => {
    if (phase !== "expanding") return;
    const timeout = window.setTimeout(() => setPhase("title-ready"), timing.shellExpandDurationMs);
    return () => window.clearTimeout(timeout);
  }, [phase, timing.shellExpandDurationMs]);

  useEffect(() => {
    if (phase !== "title-ready") return;
    let cancelled = false;
    void waitForStartupIntroAnimationFrames(STARTUP_INTRO_TITLE_READY_PAINT_FRAMES).then(() => {
      if (!cancelled) setPhase("title-handoff");
    });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "title-handoff") return;
    const timeout = window.setTimeout(() => {
      notifyStartupRendererFrameStats();
      setPhase("done");
    }, timing.phaseDurationMs);
    return () => window.clearTimeout(timeout);
  }, [phase, runtimeMode, timing.phaseDurationMs]);

  useEffect(() => {
    if (runtimeMode !== "main-window" || !startupAnimationEnabled) return;
    if (phase === "expanding" && rendererFrameProbeRef.current === undefined) {
      rendererFrameProbeRef.current = createStartupIntroRendererFrameProbe({
        collectVisualStats: readStartupSmokeMode(),
        titleHandoffSettleMs: startupIntroTitleHandoffSettleMs(timing),
      });
    }
    if (
      phase === "title-handoff" &&
      rendererFrameProbeRef.current !== undefined &&
      rendererFrameStatsRef.current === undefined
    ) {
      let cancelled = false;
      let settleTimeout: number | undefined;
      const handoffSettleMs = startupIntroTitleHandoffSettleMs(timing);
      settleTimeout = window.setTimeout(() => {
        void waitForStartupIntroAnimationFrames(STARTUP_INTRO_TITLE_HANDOFF_SAMPLE_FRAMES).then(() => {
          if (cancelled || rendererFrameStatsRef.current !== undefined) return;
          rendererFrameStatsRef.current = rendererFrameProbeRef.current?.finish();
        });
      }, handoffSettleMs);
      return () => {
        cancelled = true;
        if (settleTimeout !== undefined) window.clearTimeout(settleTimeout);
      };
    }
    if (phase !== "done") return;
    notifyStartupRendererFrameStats();
  }, [phase, runtimeMode, startupAnimationEnabled, timing]);

  const effectiveReveal = startupAnimationEnabled
    ? reveal ?? (runtimeMode === "main-window" ? createFallbackStartupReveal(prefersReducedMotion) : undefined)
    : undefined;
  const overlayPhase =
    startupAnimationEnabled && phase !== "done" && (effectiveReveal !== undefined || runtimeMode === "main-window")
      ? phase
      : undefined;
  return {
    phase,
    overlayPhase,
    timing,
    reveal: effectiveReveal,
  };
}

function notifyDesktopStartupMainHandoffVisible(): void {
  window.agentarborDesktop?.notifyStartupMainHandoffVisible();
}

export function StartupIntroOverlay(props: {
  readonly phase: StartupIntroVisiblePhase;
  readonly timing: StartupIntroTiming;
  readonly sidebarCollapsed: boolean;
  readonly reveal: StartupIntroReveal;
}): React.ReactElement {
  useStartupIntroOverlayReady();
  const style = useMemo(
    () => startupIntroOverlayStyle(props.timing, props.reveal) as StartupIntroOverlayStyle,
    [
      props.reveal.startupRect.height,
      props.reveal.startupRect.width,
      props.reveal.startupRect.x,
      props.reveal.startupRect.y,
      props.timing,
    ]
  );
  return (
    <div
      className="startup-intro-overlay"
      data-phase={props.phase}
      data-sidebar-collapsed={props.sidebarCollapsed ? "true" : "false"}
      role="status"
      aria-live="polite"
      style={style}
    >
      <div className="startup-intro-frame" />
      <StartupIntroWindowDetails sourceRect={props.reveal.startupRect} />
      <StartupIntroText
        phase={props.phase}
        timing={props.timing}
        sourceRect={props.reveal.startupRect}
      />
    </div>
  );
}

function StartupIntroWindowDetails(props: {
  readonly sourceRect: StartupIntroRect;
}): React.ReactElement {
  const detailStyle = useMemo(
    () => startupIntroContentStyle(props.sourceRect),
    [props.sourceRect.height, props.sourceRect.width, props.sourceRect.x, props.sourceRect.y]
  );
  return (
    <div className="startup-intro-window-ui" style={detailStyle} aria-hidden="true">
      <div className="startup-intro-window-topbar">
        <span />
        <span />
        <span />
      </div>
      <div className="startup-intro-window-rail">
        <span />
        <span />
        <span />
      </div>
      <div className="startup-intro-window-body">
        <span className="startup-intro-window-line startup-intro-window-line-wide" />
        <span className="startup-intro-window-line" />
        <span className="startup-intro-window-line startup-intro-window-line-short" />
      </div>
      <div className="startup-intro-window-composer" />
    </div>
  );
}

function useStartupIntroOverlayReady(): void {
  useEffect(() => {
    if (typeof window === "undefined" || window.agentarborDesktop === undefined) return;
    let cancelled = false;
    let fallbackTimeout: number | undefined;
    const notify = () => {
      if (cancelled) return;
      cancelled = true;
      if (fallbackTimeout !== undefined) window.clearTimeout(fallbackTimeout);
      window.agentarborDesktop?.notifyStartupOverlayReady();
    };
    const frame = window.requestAnimationFrame(notify);
    fallbackTimeout = window.setTimeout(notify, 80);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (fallbackTimeout !== undefined) window.clearTimeout(fallbackTimeout);
    };
  }, []);
}

function StartupIntroText(props: {
  readonly phase: StartupIntroVisiblePhase;
  readonly timing: StartupIntroTiming;
  readonly sourceRect: StartupIntroRect;
}): React.ReactElement {
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const titleCharacters = useMemo(() => Array.from(STARTUP_INTRO_TEXT), []);
  const contentStyle = useMemo(
    () => startupIntroContentStyle(props.sourceRect),
    [props.sourceRect.height, props.sourceRect.width, props.sourceRect.x, props.sourceRect.y]
  );
  useStartupIntroTitleBridgeStyle(textRef, props.phase, props.timing);
  return (
    <div className="startup-intro-content" style={contentStyle}>
      <p
        ref={textRef}
        className="startup-intro-text"
        aria-label={STARTUP_INTRO_TEXT}
      >
        <span className="startup-intro-solid-text" aria-hidden="true">
          {STARTUP_INTRO_TEXT}
        </span>
        <span className="startup-intro-print-text" aria-hidden="true">
          {titleCharacters.map((character, index) => (
            <span
              key={`${character}-${index}`}
              className="startup-intro-char"
              style={startupIntroCharStyle(index)}
            >
              {character === " " ? "\u00a0" : character}
            </span>
          ))}
        </span>
      </p>
    </div>
  );
}

function startupIntroCharStyle(index: number): StartupIntroCharStyle {
  return {
    "--startup-intro-char-delay": ms(STARTUP_INTRO_CHAR_ENTER_DELAY_MS + index * STARTUP_INTRO_CHAR_ENTER_STAGGER_MS),
  };
}

function startupIntroContentStyle(sourceRect: StartupIntroRect): StartupIntroContentStyle {
  return {
    "--startup-intro-source-x": px(Math.max(0, sourceRect.x)),
    "--startup-intro-source-y": px(Math.max(0, sourceRect.y)),
    "--startup-intro-source-width": px(Math.max(1, sourceRect.width)),
    "--startup-intro-source-height": px(Math.max(1, sourceRect.height)),
  };
}

function readStartupRuntimeMode(): StartupRuntimeMode {
  if (typeof window === "undefined") return "single-window";
  const mode = new URLSearchParams(window.location.search).get("agentarborStartup");
  if (mode === "main") return "main-window";
  return "single-window";
}

function readStartupSmokeMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("agentarborStartupSmoke") === "1";
}

function createStartupIntroTiming(
  options: { readonly reducedMotion?: boolean } = {}
): StartupIntroTiming {
  if (options.reducedMotion === true) {
    return createReducedMotionStartupIntroTiming();
  }
  return {
    textPrintDurationMs: STARTUP_INTRO_TEXT_PRINT_DURATION_MS,
    shellExpandDurationMs: STARTUP_INTRO_DEFAULT_EXPAND_MS,
    surfaceOutDelayMs: STARTUP_INTRO_TIMING.surfaceOutDelayMs,
    surfaceOutDurationMs: STARTUP_INTRO_TIMING.surfaceOutDurationMs,
    appRevealDurationMs: STARTUP_INTRO_TIMING.appRevealDurationMs,
    sidebarRevealDelayMs: STARTUP_INTRO_TIMING.sidebarRevealDelayMs,
    workbenchRevealDelayMs: STARTUP_INTRO_TIMING.workbenchRevealDelayMs,
    topbarRevealDelayMs: STARTUP_INTRO_TIMING.topbarRevealDelayMs,
    mainRevealDelayMs: STARTUP_INTRO_TIMING.mainRevealDelayMs,
    composerSettleDelayMs: STARTUP_INTRO_TIMING.composerSettleDelayMs,
    titleBridgeDurationMs: STARTUP_INTRO_TIMING.titleBridgeDurationMs,
    phaseDurationMs: STARTUP_INTRO_TITLE_HANDOFF_SETTLE_MS,
  };
}

function createReducedMotionStartupIntroTiming(): StartupIntroTiming {
  return {
    textPrintDurationMs: 1,
    shellExpandDurationMs: REDUCED_MOTION_EXPAND_MS,
    surfaceOutDelayMs: 0,
    surfaceOutDurationMs: 1,
    appRevealDurationMs: 1,
    sidebarRevealDelayMs: 0,
    workbenchRevealDelayMs: 0,
    topbarRevealDelayMs: 0,
    mainRevealDelayMs: 0,
    composerSettleDelayMs: 0,
    titleBridgeDurationMs: 1,
    phaseDurationMs: REDUCED_MOTION_TITLE_HANDOFF_SETTLE_MS,
  };
}

export function startupIntroTimingStyle(timing: StartupIntroTiming): React.CSSProperties {
  return {
    "--startup-intro-text-print-duration": ms(timing.textPrintDurationMs),
    "--startup-intro-char-print-duration": ms(STARTUP_INTRO_CHAR_ENTER_DURATION_MS),
    "--startup-intro-shell-expand-duration": ms(timing.shellExpandDurationMs),
    "--startup-intro-surface-out-delay": ms(timing.surfaceOutDelayMs),
    "--startup-intro-surface-out-duration": ms(timing.surfaceOutDurationMs),
    "--startup-intro-app-reveal-duration": ms(timing.appRevealDurationMs),
    "--startup-intro-sidebar-reveal-delay": ms(timing.sidebarRevealDelayMs),
    "--startup-intro-workbench-reveal-delay": ms(timing.workbenchRevealDelayMs),
    "--startup-intro-topbar-reveal-delay": ms(timing.topbarRevealDelayMs),
    "--startup-intro-main-reveal-delay": ms(timing.mainRevealDelayMs),
    "--startup-intro-composer-settle-delay": ms(timing.composerSettleDelayMs),
    "--startup-intro-title-bridge-duration": ms(timing.titleBridgeDurationMs),
  } as React.CSSProperties;
}

function startupIntroTitleHandoffSettleMs(timing: StartupIntroTiming): number {
  return Math.max(
    timing.surfaceOutDelayMs + timing.surfaceOutDurationMs,
    timing.titleBridgeDurationMs + STARTUP_INTRO_TITLE_BRIDGE_SETTLE_BUFFER_MS
  );
}

function startupIntroMainHandoffVisibleMs(timing: StartupIntroTiming): number {
  return Math.max(
    timing.surfaceOutDelayMs + timing.surfaceOutDurationMs,
    Math.min(timing.titleBridgeDurationMs, timing.appRevealDurationMs)
  );
}

function startupIntroOverlayStyle(
  timing: StartupIntroTiming,
  reveal: StartupIntroReveal
): React.CSSProperties {
  return {
    ...startupIntroTimingStyle(timing),
    "--startup-intro-source-x": px(Math.max(0, reveal.startupRect.x)),
    "--startup-intro-source-y": px(Math.max(0, reveal.startupRect.y)),
    "--startup-intro-source-width": px(Math.max(1, reveal.startupRect.width)),
    "--startup-intro-source-height": px(Math.max(1, reveal.startupRect.height)),
  } as React.CSSProperties;
}

function useStartupIntroTitleBridgeStyle(
  textRef: React.RefObject<HTMLParagraphElement | null>,
  phase: StartupIntroVisiblePhase,
  timing: StartupIntroTiming
): void {
  const titleAnimationRef = useRef<StartupIntroTitleBridgeAnimation | undefined>(undefined);
  useBrowserLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const source = textRef.current;
    if (source === null) return;
    if (phase === "loading" || phase === "handoff-ready" || phase === "expanding") {
      titleAnimationRef.current?.cancel();
      titleAnimationRef.current = undefined;
      resetStartupIntroTitleHandoffStyle(source);
      return;
    }

    if (phase === "title-ready") {
      titleAnimationRef.current?.cancel();
      titleAnimationRef.current = undefined;
      resetStartupIntroTitleHandoffStyle(source);
      return;
    }

    if (phase === "title-handoff") {
      titleAnimationRef.current?.cancel();
      titleAnimationRef.current = undefined;
      resetStartupIntroTitleHandoffStyle(source);
      const target = readStartupIntroTitleBridgeTarget(source);
      if (target === undefined) {
        return;
      }
      const animation = startStartupIntroTitleBridgeAnimation(
        source,
        target,
        timing.titleBridgeDurationMs,
        () => {
          titleAnimationRef.current = undefined;
        }
      );
      titleAnimationRef.current = animation;
      return () => {
        animation.cancel();
        if (titleAnimationRef.current === animation) {
          titleAnimationRef.current = undefined;
        }
      };
    }
  }, [phase, textRef, timing.titleBridgeDurationMs]);
}

function resetStartupIntroTitleHandoffStyle(source: HTMLElement): void {
  source.style.transform = STARTUP_INTRO_TITLE_STATIC_TRANSFORM;
  source.style.opacity = "1";
}

function readStartupIntroTitleBridgeTarget(source: HTMLElement): StartupIntroTitleBridgeTarget | undefined {
  const target = document.querySelector<HTMLElement>("[data-startup-title-anchor]");
  if (target === null) {
    return undefined;
  }
  const sourceRect = readElementLayoutBox(source);
  const targetRect = readElementLayoutBox(target);
  if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
    return undefined;
  }
  return {
    translateX: centerX(targetRect) - centerX(sourceRect),
    translateY: centerY(targetRect) - centerY(sourceRect),
    scaleX: targetRect.width / sourceRect.width,
    scaleY: targetRect.height / sourceRect.height,
  };
}

function startupIntroTitleBridgeTransform(target: StartupIntroTitleBridgeTarget, progress = 1): string {
  const easedProgress = minimumJerkStartupIntroProgress(progress);
  const translateX = target.translateX * easedProgress;
  const translateY = target.translateY * easedProgress;
  const scaleX = 1 + (target.scaleX - 1) * easedProgress;
  const scaleY = 1 + (target.scaleY - 1) * easedProgress;
  return `translate3d(${roundCssNumber(translateX)}px, ${roundCssNumber(translateY)}px, 0) scale(${roundCssNumber(scaleX)}, ${roundCssNumber(scaleY)})`;
}

function startStartupIntroTitleBridgeAnimation(
  source: HTMLElement,
  target: StartupIntroTitleBridgeTarget,
  durationMs: number,
  onFinish: () => void
): StartupIntroTitleBridgeAnimation {
  if (durationMs <= 1) {
    source.style.transform = startupIntroTitleBridgeTransform(target);
    onFinish();
    return { cancel: () => undefined };
  }
  return typeof source.animate === "function"
    ? startStartupIntroTitleBridgeWebAnimation(source, target, durationMs, onFinish)
    : startStartupIntroTitleBridgeFrameAnimation(source, target, durationMs, onFinish);
}

function startStartupIntroTitleBridgeWebAnimation(
  source: HTMLElement,
  target: StartupIntroTitleBridgeTarget,
  durationMs: number,
  onFinish: () => void
): StartupIntroTitleBridgeAnimation {
  let cancelled = false;
  const sourceAnimation = source.animate([
    {
      offset: 0,
      opacity: 1,
      transform: STARTUP_INTRO_TITLE_STATIC_TRANSFORM,
    },
    {
      offset: 1,
      opacity: 1,
      transform: startupIntroTitleBridgeTransform(target),
    },
  ], {
    duration: durationMs,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    fill: "forwards",
  });
  void sourceAnimation.finished.then(() => {
    if (cancelled) return;
    onFinish();
  }, () => undefined);

  return {
    cancel: () => {
      cancelled = true;
      sourceAnimation.cancel();
    },
  };
}

function startStartupIntroTitleBridgeFrameAnimation(
  source: HTMLElement,
  target: StartupIntroTitleBridgeTarget,
  durationMs: number,
  onFinish: () => void
): StartupIntroTitleBridgeAnimation {
  let cancelled = false;
  let startedAt: number | undefined;

  const tick = () => {
    if (cancelled) return;
    const now = readStartupIntroNow();
    startedAt ??= now;
    const progress = clamp((now - startedAt) / durationMs, 0, 1);
    source.style.transform = startupIntroTitleBridgeTransform(target, progress);
    source.style.opacity = "1";
    if (progress >= 1) {
      onFinish();
      return;
    }
    requestStartupIntroAnimationFrame(tick);
  };

  requestStartupIntroAnimationFrame(tick);
  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

function minimumJerkStartupIntroProgress(progress: number): number {
  const t = clamp(progress, 0, 1);
  return t * t * t * (10 + t * (-15 + t * 6));
}

function px(value: number): string {
  return `${roundCssNumber(value)}px`;
}

function normalizeStartupExpansionReveal(
  expansion: StartupIntroWindowExpansion,
  reducedMotion: boolean
): StartupIntroReveal {
  const fallback = createFallbackStartupReveal(reducedMotion);
  return {
    reducedMotion,
    nativeExpanded: expansion.nativeExpanded === true,
    startupRect: {
      x: normalizeFiniteNumber(expansion.startupRect?.x, fallback.startupRect.x),
      y: normalizeFiniteNumber(expansion.startupRect?.y, fallback.startupRect.y),
      width: normalizePositiveNumber(expansion.startupRect?.width, fallback.startupRect.width),
      height: normalizePositiveNumber(expansion.startupRect?.height, fallback.startupRect.height),
    },
    targetWindow: {
      width: normalizePositiveNumber(expansion.targetWindow?.width, fallback.targetWindow.width),
      height: normalizePositiveNumber(expansion.targetWindow?.height, fallback.targetWindow.height),
    },
  };
}

function createFallbackStartupReveal(reducedMotion: boolean): StartupIntroReveal {
  const targetWindow = typeof window === "undefined"
    ? { width: 1440, height: 960 }
    : { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
  const size = typeof window === "undefined"
    ? createStartupIntroDefaultWindowSize()
    : createStartupIntroWindowSize(targetWindow.width, targetWindow.height, readStartupIntroTextBox());
  return {
    reducedMotion,
    nativeExpanded: false,
    startupRect: {
      x: Math.round((targetWindow.width - size.width) / 2),
      y: Math.round((targetWindow.height - size.height) / 2),
      width: size.width,
      height: size.height,
    },
    targetWindow,
  };
}

function readStartupIntroTextBox(): StartupIntroLayoutBox | undefined {
  const source = document.querySelector<HTMLElement>(".startup-intro-text");
  if (source === null) {
    return undefined;
  }
  const box = readElementLayoutBox(source);
  return box.width > 0 && box.height > 0 ? box : undefined;
}

function readElementLayoutBox(element: HTMLElement): StartupIntroLayoutBox {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function requestStartupIntroAnimationFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }
  window.setTimeout(callback, 16);
}

function waitForStartupIntroAnimationFrames(count: number): Promise<void> {
  if (typeof window === "undefined" || count <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestStartupIntroAnimationFrame(tick);
    };
    requestStartupIntroAnimationFrame(tick);
  });
}

function createStartupIntroRendererFrameProbe(
  options: StartupIntroRendererFrameProbeOptions = {}
): StartupIntroRendererFrameProbe {
  const startedAt = readStartupIntroNow();
  let active = true;
  let frameCount = 0;
  let lastFrameAt = startedAt;
  let maxFrameMs = 0;
  let maxFrameAtMs = 0;
  let totalFrameMs = 0;
  const visualStats = options.collectVisualStats === true ? createStartupIntroRendererVisualStatsDraft() : undefined;
  const tick = () => {
    if (!active) return;
    const now = readStartupIntroNow();
    if (frameCount > 0) {
      const frameMs = now - lastFrameAt;
      if (frameMs > maxFrameMs) {
        maxFrameMs = frameMs;
        maxFrameAtMs = now - startedAt;
      }
      totalFrameMs += frameMs;
    }
    lastFrameAt = now;
    frameCount += 1;
    if (visualStats !== undefined) {
      sampleStartupIntroVisualState(visualStats, {
        nowMs: now,
        titleHandoffSettleMs: options.titleHandoffSettleMs ?? 0,
      });
    }
    requestStartupIntroAnimationFrame(tick);
  };
  requestStartupIntroAnimationFrame(tick);
  return {
    finish: () => {
      active = false;
      return createStartupIntroRendererFrameStats(
        frameCount,
        maxFrameMs,
        maxFrameAtMs,
        totalFrameMs,
        readStartupIntroNow() - startedAt,
        visualStats === undefined ? undefined : finishStartupIntroRendererVisualStats(visualStats)
      );
    },
  };
}

function createStartupIntroRendererFrameStats(
  frameCount: number,
  maxFrameMs: number,
  maxFrameAtMs: number,
  totalFrameMs: number,
  totalMs: number,
  visual?: StartupIntroRendererVisualStats
): StartupIntroRendererFrameStats {
  return {
    frameCount,
    maxFrameMs,
    maxFrameAtMs,
    averageFrameMs: frameCount > 1 ? totalFrameMs / (frameCount - 1) : 0,
    totalMs,
    ...(visual === undefined ? {} : { visual }),
  };
}

function createStartupIntroRendererVisualStatsDraft(): StartupIntroRendererVisualStatsDraft {
  return {
    sampleCount: 0,
    shellNodeMax: 0,
    missingOverlayCount: 0,
    missingFrameCount: 0,
    missingTextCount: 0,
    duplicateHeadingVisibleCount: 0,
    visibleChromeDuringExpansionCount: 0,
    overlayBackgroundOpaqueCount: 0,
    seenExpandingOpaqueSurface: false,
    seenExpandingTransparentSurface: false,
    titleHandoffSampleCount: 0,
    titleHandoffOpaqueSurfaceCount: 0,
    titleHandoffMaxCenterErrorPx: 0,
    titleHandoffMaxSizeErrorPx: 0,
    titleHandoffMinCenterErrorPx: Number.POSITIVE_INFINITY,
    titleHandoffLastCenterErrorPx: 0,
    titleHandoffLastSizeErrorPx: 0,
    titleHandoffStartedAtMs: undefined,
    lastVisualHeavySampleAtMs: undefined,
  };
}

function sampleStartupIntroVisualState(
  stats: StartupIntroRendererVisualStatsDraft,
  options: {
    readonly nowMs: number;
    readonly titleHandoffSettleMs: number;
  }
): void {
  stats.sampleCount += 1;
  stats.shellNodeMax = Math.max(stats.shellNodeMax, document.querySelectorAll(".startup-intro-shell").length);

  const overlay = document.querySelector<HTMLElement>(".startup-intro-overlay");
  if (overlay === null) {
    stats.missingOverlayCount += 1;
    return;
  }
  const frame = overlay.querySelector<HTMLElement>(".startup-intro-frame");
  const text = overlay.querySelector<HTMLElement>(".startup-intro-text");
  if (frame === null) {
    stats.missingFrameCount += 1;
  }
  if (text === null) {
    stats.missingTextCount += 1;
  }

  const phase = overlay.dataset.phase;
  if (phase === "title-handoff" && stats.titleHandoffStartedAtMs === undefined) {
    stats.titleHandoffStartedAtMs = options.nowMs;
  }
  const titleHandoffReadyForTargetSampling =
    phase === "title-handoff" &&
    stats.titleHandoffStartedAtMs !== undefined &&
    options.nowMs - stats.titleHandoffStartedAtMs >= options.titleHandoffSettleMs;
  const elapsedSinceHeavySample = stats.lastVisualHeavySampleAtMs === undefined
    ? Number.POSITIVE_INFINITY
    : options.nowMs - stats.lastVisualHeavySampleAtMs;
  const shouldRunHeavySample = phase === "title-handoff"
    ? titleHandoffReadyForTargetSampling
    : elapsedSinceHeavySample >= STARTUP_INTRO_VISUAL_SAMPLE_INTERVAL_MS;
  if (!shouldRunHeavySample) {
    return;
  }
  stats.lastVisualHeavySampleAtMs = options.nowMs;

  const overlayAlpha = readCssColorAlpha(window.getComputedStyle(overlay).backgroundColor);
  if (overlayAlpha > 0.05) {
    stats.overlayBackgroundOpaqueCount += 1;
  }

  if (frame !== null) {
    const frameStyle = window.getComputedStyle(frame);
    const frameAlpha = readCssColorAlpha(frameStyle.backgroundColor) * readElementVisibleOpacity(frame);
    if (phase === "expanding") {
      if (frameAlpha > 0.95) stats.seenExpandingOpaqueSurface = true;
      if (frameAlpha < 0.05) stats.seenExpandingTransparentSurface = true;
    } else if (phase === "title-handoff") {
      if (frameAlpha > 0.05) {
        stats.titleHandoffOpaqueSurfaceCount += 1;
      }
    }
  }

  const heading = document.querySelector<HTMLElement>("[data-startup-title-anchor]");
  const titleForTargetSampling = text;
  const hasDuplicateVisibleHeading =
    heading !== null &&
    text !== null &&
    readElementVisibleOpacity(heading) > 0.05 &&
    readElementVisibleOpacity(text) > 0.05;
  if (hasDuplicateVisibleHeading) {
    stats.duplicateHeadingVisibleCount += 1;
  }

  if (phase === "expanding" && isStartupIntroChromeVisible()) {
    stats.visibleChromeDuringExpansionCount += 1;
  }

  if (titleHandoffReadyForTargetSampling && heading !== null && titleForTargetSampling !== null) {
    stats.titleHandoffSampleCount += 1;
    const headingRect = readElementLayoutBox(heading);
    const textRect = readElementLayoutBox(titleForTargetSampling);
    const centerDeltaX = centerX(headingRect) - centerX(textRect);
    const centerDeltaY = centerY(headingRect) - centerY(textRect);
    const centerError = Math.hypot(centerDeltaX, centerDeltaY);
    const sizeError = Math.max(
      Math.abs(headingRect.width - textRect.width),
      Math.abs(headingRect.height - textRect.height)
    );
    stats.titleHandoffMaxCenterErrorPx = Math.max(
      stats.titleHandoffMaxCenterErrorPx,
      centerError
    );
    stats.titleHandoffMaxSizeErrorPx = Math.max(
      stats.titleHandoffMaxSizeErrorPx,
      sizeError
    );
    stats.titleHandoffMinCenterErrorPx = Math.min(stats.titleHandoffMinCenterErrorPx, centerError);
    stats.titleHandoffLastCenterErrorPx = centerError;
    stats.titleHandoffLastSizeErrorPx = sizeError;
  }
}

function finishStartupIntroRendererVisualStats(
  stats: StartupIntroRendererVisualStatsDraft
): StartupIntroRendererVisualStats {
  return {
    sampleCount: stats.sampleCount,
    shellNodeMax: stats.shellNodeMax,
    missingOverlayCount: stats.missingOverlayCount,
    missingFrameCount: stats.missingFrameCount,
    missingTextCount: stats.missingTextCount,
    duplicateHeadingVisibleCount: stats.duplicateHeadingVisibleCount,
    visibleChromeDuringExpansionCount: stats.visibleChromeDuringExpansionCount,
    overlayBackgroundOpaqueCount: stats.overlayBackgroundOpaqueCount,
    seenExpandingOpaqueSurface: stats.seenExpandingOpaqueSurface,
    seenExpandingTransparentSurface: stats.seenExpandingTransparentSurface,
    titleHandoffSampleCount: stats.titleHandoffSampleCount,
    titleHandoffOpaqueSurfaceCount: stats.titleHandoffOpaqueSurfaceCount,
    titleHandoffMaxCenterErrorPx: roundCssNumber(stats.titleHandoffMaxCenterErrorPx),
    titleHandoffMaxSizeErrorPx: roundCssNumber(stats.titleHandoffMaxSizeErrorPx),
    titleHandoffMinCenterErrorPx: Number.isFinite(stats.titleHandoffMinCenterErrorPx)
      ? roundCssNumber(stats.titleHandoffMinCenterErrorPx)
      : 0,
    titleHandoffLastCenterErrorPx: roundCssNumber(stats.titleHandoffLastCenterErrorPx),
    titleHandoffLastSizeErrorPx: roundCssNumber(stats.titleHandoffLastSizeErrorPx),
  };
}

function isStartupIntroChromeVisible(): boolean {
  const chromeNodes = document.querySelectorAll<HTMLElement>(
    ".app-root[data-startup-intro] > .app-sidebar, " +
    ".app-root[data-startup-intro] > .app-workbench, " +
    ".app-root[data-startup-intro] .app-workbench-header, " +
    ".app-root[data-startup-intro] .chat-input-floating"
  );
  for (const node of chromeNodes) {
    if (readElementVisibleOpacity(node) > 0.05) {
      return true;
    }
  }
  return false;
}

function readElementVisibleOpacity(element: HTMLElement): number {
  let opacity = 1;
  let current: HTMLElement | null = element;
  while (current !== null) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      return 0;
    }
    const parsedOpacity = Number(style.opacity);
    opacity *= Number.isFinite(parsedOpacity) ? parsedOpacity : 1;
    current = current.parentElement;
  }
  return clamp(opacity, 0, 1);
}

function readCssColorAlpha(color: string): number {
  const normalized = color.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "transparent") return 0;
  const slashAlpha = normalized.match(/\/\s*([0-9.]+%?)/);
  if (slashAlpha?.[1] !== undefined) {
    return normalizeCssAlpha(slashAlpha[1]);
  }
  const rgba = normalized.match(/^rgba?\((.*)\)$/);
  if (rgba?.[1] === undefined) return 1;
  const parts = rgba[1].split(",").map((part) => part.trim());
  if (parts.length >= 4 && parts[3] !== undefined) {
    return normalizeCssAlpha(parts[3]);
  }
  return 1;
}

function normalizeCssAlpha(value: string): number {
  if (value.endsWith("%")) {
    const parsedPercent = Number(value.slice(0, -1));
    return Number.isFinite(parsedPercent) ? clamp(parsedPercent / 100, 0, 1) : 1;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 1;
}

function startupIntroRemainingMinRectMs(startedAt: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.max(0, STARTUP_INTRO_MIN_RECT_MS - (readStartupIntroNow() - startedAt));
}

function readStartupIntroNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function readPrefersReducedMotion(): boolean {
  return isReducedMotionEffective();
}

async function requestDesktopStartupWindowExpansion(
  options: { readonly reducedMotion: boolean }
): Promise<StartupIntroWindowExpansion | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const expansion = window.agentarborDesktop?.expandStartupWindow(options);
    if (expansion === undefined) return undefined;
    return await withTimeout(expansion, STARTUP_INTRO_EXPANSION_RESPONSE_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

async function requestDesktopStartupWindowBeginExpansion(): Promise<
  { readonly started: boolean; readonly durationMs: number } | undefined
> {
  if (typeof window === "undefined") return undefined;
  try {
    const beginResult = window.agentarborDesktop?.beginStartupWindowExpansion();
    if (beginResult === undefined) return undefined;
    return await withTimeout(beginResult, STARTUP_INTRO_EXPANSION_RESPONSE_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      resolve(undefined);
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(undefined);
      }
    );
  });
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

function normalizeFiniteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined ? value : fallback;
}

function ms(value: number): string {
  return `${Math.max(0, Math.round(value))}ms`;
}

function roundCssNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function centerX(rect: StartupIntroLayoutBox): number {
  return rect.left + rect.width / 2;
}

function centerY(rect: StartupIntroLayoutBox): number {
  return rect.top + rect.height / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
