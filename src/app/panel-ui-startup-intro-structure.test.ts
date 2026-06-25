import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readAppSource, readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("startup intro expands one real desktop window before app reveal", async () => {
  const [
    app,
    startupIntro,
    startupIntroGeometry,
    styleEntry,
    rawStartupIntroStyles,
    rawAppStates,
    panelDesktop,
    panelDesktopLauncher,
    preload,
    mainEntry,
    chatEmpty,
    chatLayoutStyles,
  ] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource("app-startup-intro.tsx"),
    readAppSource("panel-startup-intro-geometry.ts"),
    readPanelUiSource("styles.css"),
    readPanelUiStyle("startup-intro.css"),
    readPanelUiStyle("app-states.css"),
    readAppSource("panel-desktop.ts"),
    readAppSource("panel-desktop-launcher.ts"),
    readAppSource("panel-desktop-preload.cts"),
    readPanelUiSource("main.tsx"),
    readPanelUiSource(join("components", "chat-empty.tsx")),
    readPanelUiStyle("chat-layout.css"),
  ]);
  const startupIntroStyles = normalizeLineEndings(rawStartupIntroStyles);
  const appStates = normalizeLineEndings(rawAppStates);

  assertNoOldWindowHandoff(startupIntro, startupIntroStyles, panelDesktop, panelDesktopLauncher, preload, mainEntry);
  assertWindowSmokeScript();
  assertNativeWindowExpansion(panelDesktop, preload);
  assertRendererHandoff(app, startupIntro, startupIntroStyles, chatEmpty, chatLayoutStyles);
  assertStartupThemeAndEntry(startupIntroGeometry, styleEntry, appStates, preload, mainEntry, startupIntroStyles);
  assertPrintedTextStructure(startupIntroStyles);
  assertSingleStartupSurface(startupIntroStyles);
  assertNoOuterEffects(startupIntroStyles);
});

function assertNoOldWindowHandoff(
  startupIntro: string,
  startupIntroStyles: string,
  panelDesktop: string,
  panelDesktopLauncher: string,
  preload: string,
  mainEntry: string
): void {
  for (const source of [startupIntro, startupIntroStyles, panelDesktop, panelDesktopLauncher, preload, mainEntry]) {
    assert.equal(source.includes("StartupTextWindow"), false);
    assert.equal(source.includes("StartupWindowApp"), false);
    assert.equal(source.includes("startupTextWindow"), false);
    assert.equal(source.includes("startup-text-window"), false);
    assert.equal(source.includes('mode === "text"'), false);
    assert.equal(source.includes('withStartupMode(url, "text")'), false);
    assert.equal(source.includes('withStartupMode(url, "startup")'), false);
    assert.equal(source.includes("onStartupReveal"), false);
    assert.equal(source.includes("agentarbor:startup-main-reveal"), false);
    assert.equal(source.includes("STARTUP_MAIN_REVEAL_CHANNEL"), false);
    assert.equal(source.includes("showStartupMainBackdropIfReady"), false);
    assert.equal(source.includes("revealMainWindowIfReady"), false);
    assert.equal(source.includes("mainBackdropShown"), false);
    assert.equal(source.includes("showInactive"), false);
  }
  assert.equal(panelDesktopLauncher.includes("animationMs"), false);
  assert.equal(mainEntry.includes('startupMode === "startup"'), false);
  assert.equal(mainEntry.includes('startupMode === "main"'), true);
}

function assertNativeWindowExpansion(panelDesktop: string, preload: string): void {
  assert.equal(countOccurrences(panelDesktop, "new BrowserWindow("), 1);
  assert.equal(panelDesktop.includes("const STARTUP_WINDOW_EXPAND_MS = 720"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_BEGIN_EXPAND_CHANNEL"), true);
  assert.equal(panelDesktop.includes("DesktopStartupWindowBeginResult"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_RENDERER_SETTLE_MS"), true);
  assert.equal(panelDesktop.includes("STARTUP_OVERLAY_READY_CHANNEL"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_INITIAL_SHOW_FALLBACK_MS"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_BOUNDS_FRAME_MS"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_NATIVE_CONTROL_RESTORE_DELAY_MS"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_SMOKE_MAX_BOUNDS_FRAME_MS"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_SMOKE_MAX_BOUNDS_STEP_PX"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_SMOKE_MAX_CENTER_DRIFT_PX"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_SMOKE_MIN_BOUNDS_FRAMES"), true);
  assert.equal(panelDesktop.includes("STARTUP_RENDERER_FRAME_STATS_CHANNEL"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_SMOKE_MAX_RENDERER_FRAME_MS"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_SMOKE_MIN_RENDERER_FRAMES"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_SMOKE_MAX_TITLE_CENTER_ERROR_PX"), true);
  assert.equal(panelDesktop.includes("STARTUP_WINDOW_SMOKE_MAX_TITLE_SIZE_ERROR_PX"), true);
  assert.equal(panelDesktop.includes("const STARTUP_WINDOW_SMOKE_MAX_BOUNDS_FRAME_MS = 64"), true);
  assert.equal(panelDesktop.includes("const STARTUP_WINDOW_SMOKE_MAX_BOUNDS_STEP_PX = 96"), true);
  assert.equal(panelDesktop.includes("const STARTUP_WINDOW_SMOKE_MAX_CENTER_DRIFT_PX = 1"), true);
  assert.equal(panelDesktop.includes("const STARTUP_WINDOW_SMOKE_MAX_RENDERER_FRAME_MS = 64"), true);
  assert.equal(panelDesktop.includes("const STARTUP_WINDOW_SMOKE_MAX_TITLE_SIZE_ERROR_PX = 2"), true);
  assert.equal(panelDesktop.includes("animateStartupWindowBounds"), false);
  assert.equal(panelDesktop.includes("animateStartupWindowShape"), false);
  assert.equal(panelDesktop.includes("DesktopStartupWindowBoundsFrameStats"), true);
  assert.equal(panelDesktop.includes("setStartupWindowShape(mainWindow, startupShape)"), false);
  assert.equal(panelDesktop.includes("startupWindowStates.set(mainWindow"), true);
  assert.equal(panelDesktop.includes("startupWindow: mainWindow"), true);
  assert.equal(panelDesktop.includes("readyToShow: false"), true);
  assert.equal(panelDesktop.includes("overlayReady: false"), true);
  assert.equal(panelDesktop.includes("showRequested: false"), true);
  assert.equal(panelDesktop.includes("showFallbackTimer: undefined"), true);
  assert.equal(panelDesktop.includes("showStartupWindowIfReady(mainWindow, state)"), true);
  assert.equal(panelDesktop.includes("scheduleStartupWindowInitialShowFallback(mainWindow, state)"), true);
  assert.equal(panelDesktop.includes("showWindowIfAlive(mainWindow)"), true);
  assert.equal(panelDesktop.includes("recordStartupWindowSmokeEvent(\"overlay-ready\")"), true);
  assertOrder(
    panelDesktop,
    "state.showRequested = true",
    "scheduleStartupWindowInitialShowFallback(mainWindow, state);\n      showStartupWindowIfReady(mainWindow, state)"
  );
  assertOrder(panelDesktop, "ipcMain.on(STARTUP_OVERLAY_READY_CHANNEL", "showStartupWindowIfReady(window, startupState)");
  assertOrder(panelDesktop, '"overlay-ready"', '"show"');
  assert.equal(panelDesktop.includes("startStartupWindowExpansionIfReady"), true);
  assert.equal(panelDesktop.includes("prepareStartupWindowExpansion"), true);
  assert.equal(panelDesktop.includes("beginStartupWindowExpansion"), true);
  assert.equal(panelDesktop.includes("createNoopStartupWindowBeginResult"), true);
  assert.equal(panelDesktop.includes("cubicBezierAtX"), false);
  assert.equal(panelDesktop.includes("waitForStartupWindowExpansionStart"), false);
  assert.equal(panelDesktop.includes("state.expansionStarted = true"), true);
  assert.equal(panelDesktop.includes("state.expansionFinished = true"), true);
  assert.equal(panelDesktop.includes("handoffVisible"), true);
  assert.equal(panelDesktop.includes("requestStartupMainHandoffCompletion"), true);
  assert.equal(panelDesktop.includes("scheduleStartupWindowNativeControlRestore(startupWindow, state)"), true);
  assert.equal(panelDesktop.includes("validateStartupWindowSmokeTimeline"), true);
  assert.equal(panelDesktop.includes("recordStartupWindowSmokeBoundsFrameStats"), true);
  assert.equal(panelDesktop.includes("recordStartupWindowSmokeRendererFrameStats"), true);
  assert.equal(panelDesktop.includes("bounds-frames:"), true);
  assert.equal(panelDesktop.includes(":center-drift-${roundSmokeNumber(stats.maxCenterDriftPx)}px:"), true);
  assert.equal(panelDesktop.includes("renderer-frames:"), true);
  assert.equal(panelDesktop.includes("visual-samples:"), true);
  assert.equal(panelDesktop.includes(":at-${Math.round(stats.maxFrameAtMs)}ms:"), true);
  assert.equal(panelDesktop.includes('"expansion-finished"'), true);
  assert.equal(panelDesktop.includes('"handoff-complete"'), true);
  assert.equal(panelDesktop.includes("scheduleStartupMainHandoffFallback(startupWindow, state)"), true);
  assert.equal(panelDesktop.includes("startupWindow.setShape("), false);
  assert.equal(panelDesktop.includes("startupWindow.setBounds(state.targetBounds)"), false);
  assert.equal(panelDesktop.includes("startupWindow.setBounds(targetBounds)"), false);
  assert.equal(panelDesktop.includes("const nextBounds = interpolateBounds(startBounds, targetBounds, easedProgress)"), false);
  assert.equal(panelDesktop.includes("boundsCenterDrift(appliedBounds, targetBounds)"), false);
  assert.equal(panelDesktop.includes("notifyStartupWindowBoundsFrame(startupWindow, appliedBounds, targetBounds)"), false);
  assert.equal(panelDesktop.includes("centerCorrectionX: centerOfBounds(targetBounds, \"x\") - centerOfBounds(appliedBounds, \"x\")"), false);
  assert.equal(panelDesktop.includes("roundToParity(interpolateNumber(start.width, end.width, progress), end.width)"), false);
  assert.equal(panelDesktop.includes("centerOfBounds(end, \"x\")"), false);
  assert.equal(panelDesktop.includes("startupWindow.setBounds(nextBounds)"), false);
  assert.equal(panelDesktop.includes("waitForStartupWindowSurfaceExpansion(expansionResult.durationMs)"), true);
  assert.equal(panelDesktop.includes("startupWindow.setResizable(true)"), true);
  assert.equal(panelDesktop.includes("startupWindow.hide()"), false);
  assert.equal(panelDesktop.includes("startupWindow.close()"), false);
  assert.equal(panelDesktop.includes("startupWindow.moveTop()"), false);
  assert.equal(panelDesktop.includes("const startupWindow = new BrowserWindow"), false);
  assert.equal(panelDesktop.includes("smoothStartupWindowExpansionProgress"), false);
  assert.equal(panelDesktop.includes("smoothStartupWindowBoundsProgress"), false);
  assert.equal(panelDesktop.includes("createStartupWindowBoundsFrameStats"), true);
  assert.equal(panelDesktop.includes("startupWindowSmokeBoundsFrameStats.maxFrameMs > STARTUP_WINDOW_SMOKE_MAX_BOUNDS_FRAME_MS"), true);
  assert.equal(panelDesktop.includes("startupWindowSmokeBoundsFrameStats.maxBoundsStepPx > STARTUP_WINDOW_SMOKE_MAX_BOUNDS_STEP_PX"), true);
  assert.equal(panelDesktop.includes("startupWindowSmokeBoundsFrameStats.maxCenterDriftPx > STARTUP_WINDOW_SMOKE_MAX_CENTER_DRIFT_PX"), true);
  assert.equal(panelDesktop.includes("startupWindowSmokeBoundsFrameStats.frameCount < STARTUP_WINDOW_SMOKE_MIN_BOUNDS_FRAMES"), true);
  assert.equal(panelDesktop.includes("startupWindowSmokeBoundsFrameStats.reverseStepCount !== 0"), true);
  assert.equal(panelDesktop.includes("startupWindowSmokeRendererFrameStats.maxFrameMs > STARTUP_WINDOW_SMOKE_MAX_RENDERER_FRAME_MS"), true);
  assert.equal(panelDesktop.includes("startupWindowSmokeRendererFrameStats.frameCount < minRendererFrames"), true);
  assert.equal(panelDesktop.includes("readStartupRendererVisualStats"), true);
  assert.equal(panelDesktop.includes("missing startup visual stats"), true);
  assert.equal(panelDesktop.includes("saw an extra startup shell layer"), true);
  assert.equal(panelDesktop.includes("duplicate visible startup and real headings"), true);
  assert.equal(panelDesktop.includes("visibleChromeDuringExpansionCount"), true);
  assert.equal(panelDesktop.includes("saw app chrome during startup expansion"), true);
  assert.equal(panelDesktop.includes("did not observe the renderer startup surface during expansion"), true);
  assert.equal(panelDesktop.includes("saw the startup surface disappear during expansion"), true);
  assert.equal(panelDesktop.includes("saw an opaque startup surface during title handoff"), false);
  assert.equal(panelDesktop.includes("title handoff missed target center"), true);
  assert.equal(panelDesktop.includes("title handoff size differs"), true);
  assert.equal(panelDesktop.includes('withStartupMode(url, startupWindowSmokeRequested)'), true);
  assert.equal(panelDesktop.includes('agentarborStartupSmoke", "1"'), true);
  assert.equal(panelDesktop.includes("readStartupMainReadyPayload"), false);
  assert.equal(panelDesktop.includes("DesktopStartupTitleTarget"), false);
  assert.equal(panelDesktop.includes("startupRect: {"), true);
  assert.equal(panelDesktop.includes("x: 0"), true);
  assert.equal(panelDesktop.includes("width: state.startupBounds.width"), true);
  assert.equal(panelDesktop.includes("resolveStartupWindowExpansionStartWaiters"), false);
  assertOrder(panelDesktop, "prepareStartupWindowExpansion(window, reducedMotion)", "ipcMain.handle(STARTUP_WINDOW_BEGIN_EXPAND_CHANNEL");
  assertOrder(panelDesktop, "beginStartupWindowExpansion(window)", "startStartupWindowExpansionIfReady(startupWindow, state)");
  assertOrder(panelDesktop, "state.expansionFinished = true", "scheduleStartupMainHandoffFallback(startupWindow, state)");
  assertOrder(panelDesktop, "state.expansionFinished = true", "completeStartupMainHandoff(startupWindow, state)");

  assert.equal(preload.includes("nativeExpanded"), true);
  assert.equal(preload.includes("DesktopStartupTitleTarget"), false);
  assert.equal(preload.includes("startupRect"), true);
  assert.equal(preload.includes("beginStartupWindowExpansion"), true);
  assert.equal(preload.includes("DesktopStartupWindowBeginResult"), true);
  assert.equal(preload.includes("agentarbor:startup-window-begin-expand"), true);
  assert.equal(preload.includes("notifyStartupOverlayReady: ()"), true);
  assert.equal(preload.includes("agentarbor:startup-overlay-ready"), true);
  assert.equal(preload.includes("notifyStartupMainReady: ()"), true);
  assert.equal(preload.includes("notifyStartupMainHandoffVisible"), true);
  assert.equal(preload.includes("notifyStartupRendererFrameStats"), true);
  assert.equal(preload.includes("agentarbor:startup-renderer-frame-stats"), true);
  assert.equal(preload.includes("DesktopStartupRendererVisualStats"), true);
  assert.equal(preload.includes("duplicateHeadingVisibleCount"), true);
  assert.equal(preload.includes("visibleChromeDuringExpansionCount"), true);
}

function assertWindowSmokeScript(): void {
  const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
  assert.equal(packageJson.includes('"panel:desktop:window-smoke"'), true);
  assert.equal(packageJson.includes("--window-smoke"), true);
}

function assertRendererHandoff(
  app: string,
  startupIntro: string,
  styles: string,
  chatEmpty: string,
  chatLayoutStyles: string
): void {
  assert.equal(app.includes("useAnimate"), false);
  assert.equal(app.includes("useLayoutEffect"), false);
  assert.equal(app.includes("useBrowserLayoutEffect"), false);
  assert.equal(app.includes('from "motion/react"'), false);
  assert.equal(app.includes("startupIntroLayerMotion"), false);
  assert.equal(app.includes("STARTUP_INTRO_MOTION_TARGETS"), false);
  assert.equal(app.includes('main: ".app-main"'), false);
  assert.equal(app.includes("animateStartupIntro"), false);
  assert.equal(app.includes("StartupIntroRootStyle"), true);
  assert.equal(app.includes('"--startup-intro-target-width"'), true);
  assert.equal(app.includes('"--startup-intro-target-height"'), true);
  assert.equal(app.includes('"--startup-intro-empty-grid-top-padding"'), true);
  assert.equal(app.includes("startupIntroEmptyGridTopPadding(startupIntro.reveal.targetWindow.height)"), true);
  assert.equal(app.includes("startupIntro.reveal.targetWindow.width"), true);
  assert.equal(app.includes("startupIntro.reveal.targetWindow.height"), true);
  assert.equal(app.includes("data-startup-app-reveal"), false);
  assert.equal(app.includes("appRevealActive"), false);
  assert.equal(app.includes("startupIntroActive = startupIntro.overlayPhase !== undefined && startupIntro.reveal !== undefined"), true);
  assert.equal(app.includes("data-startup-title-slide"), false);
  assert.equal(app.includes("reveal={startupIntro.reveal}"), true);
  assert.equal(app.includes("autoFocus={!startupIntroActive}"), true);

  assert.equal(chatEmpty.includes("data-startup-title-anchor"), true);
  assert.equal(chatEmpty.includes("chat-empty-heading-title"), true);
  assert.equal(chatLayoutStyles.includes(".chat-empty-heading-title"), true);
  assert.equal(chatLayoutStyles.includes("display: inline-block"), true);

  assert.equal(startupIntro.includes('from "motion/react"'), false);
  assert.equal(startupIntro.includes("useStartupIntroOverlayReady"), true);
  assert.equal(startupIntro.includes("notifyStartupOverlayReady"), true);
  assertOrder(startupIntro, "useStartupIntroOverlayReady();", "startupIntroOverlayStyle(props.timing, props.reveal)");
  assert.equal(startupIntro.includes("notifyStartupMainReady"), true);
  assert.equal(startupIntro.includes("notifyStartupMainHandoffVisible"), true);
  assert.equal(startupIntro.includes("nativeExpanded"), true);
  assert.equal(startupIntro.includes("initialSize"), false);
  assert.equal(startupIntro.includes("startupRect"), true);
  assert.equal(startupIntro.includes("targetWindow"), true);
  assert.equal(startupIntro.includes("startupIntroFrameScale"), false);
  assert.equal(startupIntro.includes("startupIntroShellInitialTransform"), false);
  assert.equal(startupIntro.includes("startupIntroChromeMotion"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_NATIVE_EXPAND_LAG_MS"), false);
  assert.equal(startupIntro.includes("readStartupIntroMainTitleTarget"), false);
  assert.equal(startupIntro.includes("normalizeStartupExpansionReveal"), true);
  assert.equal(startupIntro.includes("requestDesktopStartupWindowExpansion"), true);
  assert.equal(startupIntro.includes("requestDesktopStartupWindowBeginExpansion"), true);
  assert.equal(startupIntro.includes("onStartupWindowBoundsFrame"), false);
  assert.equal(startupIntro.includes("writeStartupWindowCenterCorrection"), false);
  assert.equal(startupIntro.includes("--startup-intro-window-center-correction-x"), false);
  assert.equal(startupIntro.includes("createStartupIntroRendererFrameProbe"), true);
  assert.equal(startupIntro.includes("rendererFrameStatsRef"), true);
  assert.equal(startupIntro.includes("collectVisualStats: readStartupSmokeMode()"), true);
  assert.equal(startupIntro.includes("readStartupSmokeMode"), true);
  assert.equal(startupIntro.includes("agentarborStartupSmoke"), true);
  assert.equal(startupIntro.includes("sampleStartupIntroVisualState"), true);
  assert.equal(startupIntro.includes("querySelectorAll(\".startup-intro-shell\")"), true);
  assert.equal(startupIntro.includes("duplicateHeadingVisibleCount"), true);
  assert.equal(startupIntro.includes("visibleChromeDuringExpansionCount"), true);
  assert.equal(startupIntro.includes("isStartupIntroChromeVisible"), true);
  assert.equal(startupIntro.includes("titleHandoffOpaqueSurfaceCount"), true);
  assert.equal(startupIntro.includes("notifyStartupRendererFrameStats"), true);
  assert.equal(startupIntro.includes("maxFrameAtMs"), true);
  assert.equal(startupIntro.includes('phase === "expanding" && rendererFrameProbeRef.current === undefined'), true);
  assert.equal(startupIntro.includes('phase === "title-handoff"'), true);
  assert.equal(startupIntro.includes("waitForStartupIntroAnimationFrames(STARTUP_INTRO_HANDOFF_PAINT_FRAMES)"), true);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_READY_PAINT_FRAMES"), true);
  assert.equal(startupIntro.includes('setPhase("title-ready")'), true);
  assert.equal(startupIntro.includes('phase !== "title-ready"'), true);
  assertOrder(startupIntro, 'setPhase("title-ready")', 'setPhase("title-handoff")');
  assert.equal(startupIntro.includes('if (phase !== "done") return;'), true);
  assert.equal(startupIntro.includes("startupIntroRemainingMinRectMs"), true);
  assert.equal(startupIntro.includes("introStartedAtRef"), true);
  assert.equal(startupIntro.includes("readStartupIntroNow"), true);
  assert.equal(startupIntro.includes('runtimeMode !== "main-window" || isBootstrapping || phase !== "loading"'), true);
  assert.equal(startupIntro.includes('if (runtimeMode === "main-window") return;'), true);
  assertOrder(startupIntro, "requestDesktopStartupWindowExpansion", 'setPhase("handoff-ready")');
  assertOrder(startupIntro, "requestDesktopStartupWindowBeginExpansion()", 'setPhase("expanding")');
  assert.equal(startupIntro.includes('phase !== "title-handoff" || runtimeMode !== "main-window" || reveal?.nativeExpanded !== true'), true);
  assert.equal(startupIntro.includes("window.agentarborDesktop?.notifyStartupMainHandoffVisible()"), true);
  assertOrder(
    startupIntro,
    "const timeout = window.setTimeout(() =>",
    "window.agentarborDesktop?.notifyStartupMainHandoffVisible()"
  );

  assert.equal(startupIntro.includes("contentOutDelayMs"), false);
  assert.equal(startupIntro.includes("contentOutDurationMs"), false);
  assert.equal(startupIntro.includes("surfaceOutDelayMs: 220"), true);
  assert.equal(startupIntro.includes("surfaceOutDurationMs: 520"), true);
  assert.equal(startupIntro.includes("appRevealDurationMs: 520"), true);
  assert.equal(startupIntro.includes("titleBridgeDurationMs: STARTUP_INTRO_TITLE_BRIDGE_DURATION_MS"), true);
  assert.equal(startupIntro.includes("const STARTUP_INTRO_TITLE_HANDOFF_SETTLE_MS = 980"), true);
  assert.equal(startupIntro.includes("const STARTUP_INTRO_TITLE_BRIDGE_DURATION_MS = 760"), true);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_BRIDGE_SETTLE_BUFFER_MS = 120"), true);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_CROSSFADE_MS"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_SOURCE_FADE_MS"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_REAL_TITLE_IN_DELAY_MS"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_REAL_TITLE_VISIBLE_OPACITY_MS"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_REAL_TITLE_SLIDE_ARM_FRAMES"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_REAL_TITLE_SLIDE_SETTLE_BUFFER_MS"), false);
  assert.equal(startupIntro.includes("StartupIntroTitleSlideState"), false);
  assert.equal(startupIntro.includes("titleSlide"), false);
  assert.equal(startupIntro.includes("setTitleSlide"), false);
  assert.equal(startupIntro.includes("startupIntroMainHandoffVisibleMs(timing)"), true);
  assertOrder(startupIntro, "const handoffVisibleMs = startupIntroMainHandoffVisibleMs(timing)", "window.agentarborDesktop?.notifyStartupMainHandoffVisible()");
  assert.equal(startupIntro.includes("startupIntroRealTitleInDelayMs"), false);
  assert.equal(startupIntro.includes("startupIntroRealTitleInOpacityDurationMs"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_STATIC_TRANSFORM"), true);
  assert.equal(startupIntro.includes('"--startup-intro-content-out-delay"'), false);
  assert.equal(startupIntro.includes('"--startup-intro-content-out-duration"'), false);
  assert.equal(startupIntro.includes('"--startup-intro-surface-out-delay"'), true);
  assert.equal(startupIntro.includes('"--startup-intro-surface-out-duration"'), true);
  assert.equal(startupIntro.includes('"--startup-intro-app-reveal-duration"'), true);
  assert.equal(startupIntro.includes('"--startup-intro-title-bridge-duration"'), true);
  assert.equal(startupIntro.includes('"--startup-intro-real-title-in-duration"'), false);
  assert.equal(startupIntro.includes('"--startup-intro-real-title-in-opacity-duration"'), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_TARGET_IN_DELAY_MS"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_TARGET_IN_MS"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_APPROACH_MAX_PX"), false);
  assert.equal(startupIntro.includes("useStartupIntroTitleBridgeStyle"), true);
  assert.equal(startupIntro.includes("lockedHandoffRef"), false);
  assert.equal(startupIntro.includes('phase === "loading" || phase === "handoff-ready" || phase === "expanding"'), true);
  assertOrder(
    startupIntro,
    'if (phase === "title-ready")',
    'if (phase === "title-handoff")'
  );
  assert.equal(startupIntro.includes("readStartupIntroTitleHandoffFromTextBox"), false);
  assert.equal(startupIntro.includes("writeStartupIntroTitleHandoffStyle"), false);
  assert.equal(startupIntro.includes("titleAnimationRef"), true);
  assert.equal(startupIntro.includes("readStartupIntroTitleBridgeTarget"), true);
  assert.equal(startupIntro.includes("document.querySelector<HTMLElement>(\"[data-startup-title-anchor]\")"), true);
  assert.equal(startupIntro.includes("startupIntroTitleBridgeTransform"), true);
  assert.equal(startupIntro.includes("startStartupIntroTitleBridgeAnimation"), true);
  assert.equal(startupIntro.includes("startStartupIntroTitleBridgeWebAnimation"), true);
  assert.equal(startupIntro.includes("startStartupIntroTitleBridgeFrameAnimation"), true);
  assert.equal(startupIntro.includes('typeof source.animate === "function"'), true);
  assert.equal(startupIntro.includes("source.animate(["), true);
  assert.equal(startupIntro.includes("targetTitle.animate(["), false);
  assert.equal(startupIntro.includes("writeStartupIntroTitleHandoffFrame"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TITLE_STATIC_TRANSFORM"), true);
  assert.equal(startupIntro.includes("startupIntroTitleTransform"), false);
  assert.equal(startupIntro.includes("ZERO_TITLE_HANDOFF"), false);
  assert.equal(startupIntro.includes("minimumJerkStartupIntroProgress"), true);
  assert.equal(startupIntro.includes("handoffTextRef"), false);
  assert.equal(startupIntro.includes('className="startup-intro-handoff-text"'), false);
  assert.equal(startupIntro.includes("applyStartupIntroTargetTitleStyle"), false);
  assert.equal(startupIntro.includes("startupIntroTargetTitleTransform"), false);
  assert.equal(startupIntro.includes("source.style.opacity = String(roundCssNumber(1 - sourceFadeProgress))"), false);
  assert.equal(startupIntro.includes("source.style.opacity = \"1\""), true);
  assert.equal(startupIntro.includes("targetTitle.style.opacity"), false);
  assert.equal(startupIntro.includes("readStartupIntroTargetTextStyle"), false);
  assert.equal(startupIntro.includes("createStartupIntroTitleApproach"), false);
  assert.equal(startupIntro.includes("targetRect.height * 0.24"), false);
  assert.equal(startupIntro.includes("titleHandoffCrossfadeStartMs"), false);
  assert.equal(startupIntro.includes('const shouldRunHeavySample = phase === "title-handoff"'), true);
  assert.equal(startupIntro.includes("? titleHandoffReadyForTargetSampling"), true);
  assert.equal(startupIntro.includes("requestStartupIntroAnimationFrame(tick)"), true);
  assert.equal(startupIntro.includes("timing.contentOutDelayMs"), false);
  assert.equal(startupIntro.includes("timing.contentOutDurationMs"), false);
  assert.equal(startupIntro.includes("window.setTimeout(startFade, delayMs)"), false);
  assert.equal(startupIntro.includes("window.requestAnimationFrame(update)"), false);
  assert.equal(startupIntro.includes("--startup-intro-title-x"), false);
  assert.equal(startupIntro.includes("--startup-intro-title-y"), false);
  assert.equal(startupIntro.includes("--startup-intro-title-scale"), false);
  assert.equal(startupIntro.includes("--startup-intro-real-title-in-delay"), false);
  assert.equal(startupIntro.includes("surfaceOutDelayMs"), true);
  assert.equal(startupIntro.includes("surfaceOutDurationMs"), true);
  assert.equal(startupIntro.includes("phaseDurationMs: STARTUP_INTRO_TITLE_HANDOFF_SETTLE_MS"), true);
  assert.equal(startupIntro.includes("overlayReleaseDelayMs"), false);
  assert.equal(startupIntro.includes("overlayReleaseDurationMs"), false);
  assert.equal(startupIntro.includes("showShell"), false);
  assert.equal(startupIntro.includes("showText"), false);
  assert.equal(startupIntro.includes("releaseShell"), false);
  assert.equal(startupIntro.includes("createStartupWindowTitleHandoff"), false);
  assert.equal(startupIntro.includes("createStartupWindowStaticReveal"), false);
  assert.equal(startupIntro.includes("--startup-intro-static-width"), false);
  assert.equal(startupIntro.includes("--startup-intro-static-height"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TARGET_MEASUREMENT_SELECTORS"), false);
  assert.equal(startupIntro.includes("STARTUP_INTRO_TARGET_MEASUREMENT_TRANSFORM_PROPERTIES"), false);
  assert.equal(startupIntro.includes("readStableStartupIntroTargetLayoutBox"), false);
  assert.equal(startupIntro.includes("readStartupIntroSourceIntrinsicBox"), false);
  assert.equal(startupIntro.includes("readStableStartupIntroSourceLayoutBox(source)"), false);
  assert.equal(startupIntro.includes("targetRect.width / sourceRect.width"), true);
  assert.equal(startupIntro.includes("readCssPixelValue"), false);
  assert.equal(startupIntro.includes("neutralizeStartupIntroTargetMeasurementTransforms"), false);
  assert.equal(startupIntro.includes("neutralizeStartupIntroMeasurementTransforms([source])"), false);
  assert.equal(startupIntro.includes('element.style.setProperty(property, "none")'), false);
  assert.equal(startupIntro.includes("restoreStartupIntroInlineStyleSnapshots"), false);

  assert.equal(startupIntro.includes("width: roundCssNumber(Math.max(1, reveal.startupRect.width))"), false);
  assert.equal(startupIntro.includes("height: roundCssNumber(Math.max(1, reveal.startupRect.height))"), false);
  assert.equal(startupIntro.includes("const targetWindow = typeof window"), true);
  assert.equal(startupIntro.includes("targetWindow,"), true);
  assert.equal(startupIntro.includes("const full = { opacity: 1 };"), false);
  assert.equal(startupIntro.includes("startupIntroTitleMotion"), false);
  assert.equal(startupIntro.includes("startupIntroFrameMotion"), false);
  assert.equal(startupIntro.includes("scaleX"), true);
  assert.equal(startupIntro.includes("scaleY"), true);
  assert.equal(startupIntro.includes("readonly width?: number"), false);
  assert.equal(startupIntro.includes("readonly height?: number"), false);
  assert.equal(startupIntro.includes("startupIntroTextContentBox"), false);
  assert.equal(startupIntro.includes("return reveal.startupRect;"), false);
  assert.equal(startupIntro.includes("centerX(targetRect) - targetWindow.width / 2"), false);
  assert.equal(startupIntro.includes("centerY(targetRect) - targetWindow.height / 2"), false);
  assert.equal(startupIntro.includes("startupIntroViewportCenterDelta"), false);
  assert.equal(startupIntro.includes("const translationScaleCompensation = 1"), false);
  assert.equal(startupIntro.includes("startup-title-measure"), false);
  assert.equal(startupIntro.includes("startup-title-sample"), false);
  assert.equal(startupIntro.includes("centerX(sourceRect)"), true);
  assert.equal(startupIntro.includes("centerY(sourceRect)"), true);
  assert.equal(startupIntro.includes("window.innerWidth / 2"), false);
  assert.equal(startupIntro.includes("window.innerHeight / 2"), false);
  assert.equal(countOccurrences(startupIntro, 'className="startup-intro-text"'), 1);
  assert.equal(countOccurrences(startupIntro, 'className="startup-intro-window-ui"'), 1);
  assert.equal(startupIntro.includes("function StartupIntroWindowDetails"), true);
  assert.equal(countOccurrences(startupIntro, 'className="startup-intro-handoff-text"'), 0);

  assert.equal(styles.includes("@keyframes startup-intro-title-handoff"), false);
  assert.equal(styles.includes("@keyframes startup-intro-real-heading-reveal"), false);
  assert.equal(styles.includes("@keyframes startup-intro-frame-expand"), false);
  assert.equal(styles.includes("@keyframes startup-intro-frame-fade"), false);
  assert.equal(styles.includes("@keyframes startup-intro-overlay-release"), false);
  assert.equal(styles.includes("@keyframes startup-intro-sidebar-reveal"), false);
  assert.equal(styles.includes("@keyframes startup-intro-workbench-reveal"), false);
  assert.equal(styles.includes("@keyframes startup-intro-topbar-reveal"), false);
  assert.equal(styles.includes("@keyframes startup-intro-main-reveal"), false);
  assert.equal(styles.includes("clip-path"), false);
  assert.equal(styles.includes("--startup-intro-frame-width"), false);
  assert.equal(styles.includes("--startup-intro-frame-height"), false);
  assert.equal(styles.includes("--startup-intro-chrome-width"), false);
  assert.equal(styles.includes("--startup-intro-chrome-height"), false);
  assert.equal(styles.includes("--startup-intro-static-width"), false);
  assert.equal(styles.includes("--startup-intro-static-height"), false);
  assert.equal(styles.includes(".startup-intro-chrome"), false);
  assert.equal(styles.includes(".startup-window-root"), false);
  assert.equal(styles.includes("transform-origin: 0 0"), false);
  assert.equal(styles.includes("inset: 0"), true);
  assert.equal(styles.includes("will-change: opacity;"), true);
  assert.equal(styles.includes("will-change: transform, opacity;"), false);
  assert.equal(styles.includes(".startup-intro-text {\n  will-change: opacity, transform;"), false);
  assert.equal(styles.includes("--startup-intro-window-center-correction-x"), false);
  assert.equal(styles.includes("--startup-intro-window-center-correction-y"), false);
  assert.equal(styles.includes("--startup-intro-source-width"), true);
  assert.equal(styles.includes("--startup-intro-source-height"), true);
  assert.equal(styles.includes("transition:"), true);
  assert.equal(styles.includes("cubic-bezier(0.2, 0.74, 0.18, 1)"), true);
  assert.equal(styles.includes(".startup-intro-overlay[data-phase=\"title-handoff\"] .startup-intro-shell"), false);
  assert.equal(styles.includes('.app-root[data-startup-intro][data-startup-app-reveal="active"] > .app-sidebar'), false);
  assert.equal(styles.includes(".startup-intro-shell-base"), false);
  assert.equal(styles.includes(".startup-intro-shell"), false);
  assert.equal(styles.includes("--startup-intro-content-x"), false);
  assert.equal(styles.includes("startup-intro-shell-static"), false);
  assert.equal(styles.includes(".startup-intro-frame > .startup-intro-content"), false);
  assert.equal(styles.includes("html[data-desktop-startup-mode=\"main\"] body"), true);
  assert.equal(styles.includes("html[data-desktop-startup-mode=\"main\"][data-style] body"), true);
  assert.equal(styles.includes("html[data-desktop-startup-mode=\"startup\"]"), false);
  assert.equal(styles.includes("html[data-desktop-shell=\"true\"] .app-root[data-startup-intro]"), true);
  assert.equal(styles.includes("width: var(--startup-intro-target-width, 100%)"), true);
  assert.equal(styles.includes("height: var(--startup-intro-target-height, 100vh)"), true);
  assert.equal(styles.includes('data-sidebar-collapsed="false"'), true);
  assert.equal(styles.includes("width: var(--sidebar-width) !important"), true);
  assert.equal(styles.includes('data-sidebar-collapsed="true"'), true);
  assert.equal(styles.includes("width: var(--sidebar-compact-width) !important"), true);
  assert.equal(styles.includes("background: transparent"), true);
  assert.equal(styles.includes('.startup-intro-overlay[data-phase="title-handoff"]'), true);
  assert.equal(styles.includes("color-mix(in oklch, var(--startup-intro-shell-bg) 0%, transparent)"), false);
  assert.equal(styles.includes('transition-duration: 80ms'), false);
  assert.equal(styles.includes("--startup-intro-content-out-delay"), false);
  assert.equal(styles.includes("--startup-intro-content-out-duration"), false);
  assert.equal(styles.includes("--startup-intro-surface-out-delay: 220ms"), true);
  assert.equal(styles.includes("--startup-intro-surface-out-duration: 520ms"), true);
  assert.equal(styles.includes("--startup-intro-app-reveal-duration: 520ms"), true);
  assert.equal(styles.includes("--startup-intro-sidebar-reveal-delay: 220ms"), true);
  assert.equal(styles.includes("--startup-intro-workbench-reveal-delay: 0ms"), true);
  assert.equal(styles.includes("--startup-intro-topbar-reveal-delay: 140ms"), true);
  assert.equal(styles.includes("--startup-intro-main-reveal-delay: 0ms"), true);
  assert.equal(styles.includes("--startup-intro-composer-settle-delay: 320ms"), true);
  assert.equal(styles.includes("--startup-intro-title-bridge-duration: 760ms"), true);
  assert.equal(styles.includes("--startup-intro-real-title-in-delay"), false);
  assert.equal(styles.includes("--startup-intro-real-title-in-duration"), false);
  assert.equal(styles.includes("--startup-intro-real-title-in-opacity-duration"), false);
  assert.equal(styles.includes("--startup-intro-real-title-in-distance"), false);
  assert.equal(styles.includes("--startup-intro-overlay-release-delay"), false);
  assert.equal(styles.includes("--startup-intro-overlay-release-duration"), false);
  assert.equal(styles.includes("background-color: var(--startup-intro-shell-bg, var(--bg))"), true);
  assert.equal(styles.includes("background-image: none"), true);
  assert.equal(styles.includes("linear-gradient("), false);
  assert.equal(styles.includes(".startup-intro-window-ui"), true);
  assert.equal(styles.includes(".startup-intro-window-topbar"), true);
  assert.equal(styles.includes(".startup-intro-window-rail"), true);
  assert.equal(styles.includes(".startup-intro-window-composer"), true);
  assert.equal(styles.includes('.startup-intro-overlay[data-phase="title-ready"] .startup-intro-frame'), true);
  assert.equal(styles.includes('.startup-intro-overlay[data-phase="title-ready"] .startup-intro-text'), true);
  assert.equal(styles.includes("transition: none"), true);
  assert.equal(styles.includes(".startup-intro-handoff-text"), false);
  assert.equal(styles.includes("--startup-intro-title-x"), false);
  assert.equal(styles.includes("--startup-intro-title-y"), false);
  assert.equal(styles.includes("--startup-intro-title-scale"), false);
  assert.equal(styles.includes('.startup-intro-overlay[data-phase="title-handoff"] .startup-intro-frame'), true);
  assert.equal(styles.includes("opacity var(--startup-intro-surface-out-duration) cubic-bezier(0.2, 0.74, 0.18, 1) var(--startup-intro-surface-out-delay)"), true);
  assert.equal(styles.includes("--startup-intro-real-title-in-delay"), false);
  assert.equal(styles.includes("startup-intro-real-heading-slide var(--startup-intro-real-title-in-duration)"), false);
  assert.equal(styles.includes("startup-intro-real-heading-opacity var(--startup-intro-real-title-in-opacity-duration)"), false);
  assert.equal(styles.includes("animation-delay:\n    var(--startup-intro-real-title-in-delay),\n    var(--startup-intro-real-title-in-delay);"), false);
  assert.equal(styles.includes("transform var(--startup-intro-real-title-in-duration)"), false);
  assert.equal(styles.includes("opacity var(--startup-intro-real-title-in-opacity-duration)"), false);
  assert.equal(styles.includes("calc(var(--startup-intro-content-out-duration) - 180ms)"), false);
  assert.equal(styles.includes("transform: translate3d(0, 10px, 0)"), false);
  assert.equal(styles.includes("transform: translate3d(0, var(--startup-intro-real-title-in-distance), 0)"), false);
  assert.equal(styles.includes("transform: translate3d(0, calc(var(--startup-intro-real-title-in-distance) * 0.44), 0)"), false);
  assert.equal(styles.includes("transform: translate3d(0, calc(var(--startup-intro-real-title-in-distance) * 0.08), 0)"), false);
  assert.equal(styles.includes("transform: translate3d(0, calc(var(--startup-intro-real-title-in-distance) * 0.16), 0)"), false);
  assert.equal(styles.includes("transform: translate3d(0, calc(var(--startup-intro-real-title-in-distance) * 0.34), 0)"), false);
  assert.equal(styles.includes("transform: translate3d(0, 2px, 0)"), false);
  assert.equal(styles.includes("transform: translate3d(0, 0, 0)"), true);
  assert.equal(styles.includes("background-image: none"), true);
  assert.equal(styles.includes(".app-root[data-startup-intro] > .app-sidebar"), true);
  assert.equal(styles.includes('.app-root[data-startup-intro="title-ready"] > .app-sidebar'), true);
  assert.equal(styles.includes('.app-root[data-startup-intro="title-handoff"] > .app-sidebar'), true);
  assert.equal(styles.includes('.app-root[data-startup-intro="title-ready"] > .app-workbench'), true);
  assert.equal(styles.includes('.app-root[data-startup-intro="title-handoff"] > .app-workbench'), true);
  assert.equal(styles.includes(".app-root[data-startup-intro] .chat-empty-grid"), true);
  assert.equal(styles.includes("padding-block: var(--startup-intro-empty-grid-top-padding, 154px) 28px"), true);
  assert.equal(styles.includes("opacity: 0"), true);
  assert.equal(styles.includes("opacity: 1"), true);
  assert.equal(styles.includes(".app-root[data-startup-intro] .chat-empty-heading {\n  opacity: 0.001;\n  visibility: visible;"), true);
  assert.equal(styles.includes(".app-root[data-startup-intro] .chat-empty-heading"), true);
  assert.equal(styles.includes('.app-root[data-startup-intro="title-ready"] .chat-empty-heading'), true);
  assert.equal(styles.includes('.app-root[data-startup-intro="title-handoff"] .chat-empty-heading'), true);
  assert.equal(styles.includes('.app-root[data-startup-intro="title-handoff"][data-startup-title-slide="active"] .chat-empty-heading'), false);
  assert.equal(styles.includes("@keyframes startup-intro-real-heading-slide"), false);
  assert.equal(styles.includes("@keyframes startup-intro-real-heading-opacity"), false);
  assert.equal(styles.includes('.app-root[data-startup-intro][data-startup-app-reveal="active"] .chat-empty-heading'), false);
  assert.equal(styles.includes('.startup-intro-overlay:not([data-phase="loading"]) .startup-intro-char'), true);
}

function assertStartupThemeAndEntry(
  startupIntroGeometry: string,
  styleEntry: string,
  appStates: string,
  preload: string,
  mainEntry: string,
  styles: string
): void {
  assert.equal(styleEntry.includes('@import "./styles/startup-intro.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/app-states.css"'), true);
  assertOrder(styleEntry, '@import "./styles/theme-switcher.css"', '@import "./styles/startup-intro.css"');
  assert.equal(appStates.includes(".app-root[data-startup-intro]"), false);

  assert.equal(startupIntroGeometry.includes("STARTUP_INTRO_TEXT = \"今天想处理什么？\""), true);
  assert.equal(startupIntroGeometry.includes("STARTUP_INTRO_TEXT_FONT_SIZE_PX = 46"), true);
  assert.equal(startupIntroGeometry.includes("createStartupIntroDefaultWindowSize"), true);
  assert.equal(startupIntroGeometry.includes("estimateStartupIntroTextBox"), true);
  assert.equal(startupIntroGeometry.includes("createStartupIntroWindowSize"), true);
  assert.equal(startupIntroGeometry.includes("minimumSoftwareFrameWidth"), true);

  assert.equal(preload.includes("agentarbor:style"), true);
  assert.equal(preload.includes("agentarbor:color"), true);
  assert.equal(preload.includes("mainWindow"), true);
  assert.equal(mainEntry.includes("getStartupThemeSnapshot"), true);
  assert.equal(mainEntry.includes("StartupWindowApp"), false);
  assert.equal(mainEntry.includes('startupMode === "startup"'), false);
  assert.equal(mainEntry.includes('rootStyle.setProperty("--startup-intro-shell-bg", startupTheme.backgroundColor)'), true);
  assert.equal(mainEntry.includes("startupTheme.shellColor"), false);
  assert.equal(mainEntry.includes("--startup-intro-shell-bg"), true);
  assert.equal(mainEntry.includes("--startup-intro-border"), false);
  assert.equal(styles.includes("html[data-desktop-startup-mode=\"startup\"]"), false);
  assert.equal(styles.includes("html[data-desktop-startup-mode=\"main\"]"), true);
  assert.equal(styles.includes("--startup-intro-shell-bg"), true);
  assert.equal(styles.includes("--startup-intro-border"), false);
  assert.equal(styles.includes("--startup-intro-inner-line"), false);
  assert.equal(styles.includes("--startup-intro-shell-top-wash"), false);
  assert.equal(styles.includes("--startup-intro-shell-bg: var(--bg)"), true);
  assert.equal(styles.includes("var(--bg)"), true);
  assert.equal(styles.includes("var(--surface-highlight)"), false);
}

function assertPrintedTextStructure(styles: string): void {
  assert.equal(styles.includes(".startup-intro-char"), true);
  assert.equal(styles.includes(".startup-intro-char::after"), true);
  assert.equal(styles.includes(".startup-intro-caret"), false);
  assert.equal(styles.includes("@keyframes startup-intro-char-enter"), true);
  assert.equal(styles.includes("@keyframes startup-intro-print-head"), true);
  assert.equal(styles.includes("@keyframes startup-intro-caret-blink"), false);
  assert.equal(styles.includes("font-size: 46px"), true);
  assert.equal(styles.includes("font-size: 48px"), false);
  assert.equal(styles.includes("steps(2"), false);
  assert.equal(styles.includes("content: none"), true);
  assert.equal(styles.includes("contain: paint"), false);

  const textRule = readCssRule(styles, "\n.startup-intro-text");
  assert.equal(textRule.includes("overflow: visible"), true);
  const solidTextRule = readCssRule(styles, "\n.startup-intro-solid-text");
  assert.equal(solidTextRule.includes("overflow: visible"), true);
  const printTextRule = readCssRule(styles, "\n.startup-intro-print-text");
  assert.equal(printTextRule.includes("overflow: visible"), true);
  const charRule = readCssRule(styles, "\n.startup-intro-char");
  assert.equal(charRule.includes("overflow: visible"), true);

  const charEnter = readCssKeyframes(styles, "startup-intro-char-enter");
  assert.deepEqual(readCssPropertyValues(charEnter, "opacity").slice(0, 3), ["0", "0.96", "1"]);
  assert.equal(charEnter.includes("transform: translate3d(0, 0.16em, 0) scale(0.975)"), true);
  assert.equal(charEnter.includes("transform: translate3d(0, 0, 0) scale(1)"), true);
}

function assertSingleStartupSurface(styles: string): void {
  assert.equal(styles.includes("--startup-intro-frame-radius"), false);
  assert.equal(styles.includes("--startup-intro-border"), false);
  assert.equal(styles.includes("--startup-intro-inner-line"), false);
  assert.equal(styles.includes("--startup-intro-shell-top-wash"), false);
  assert.equal(styles.includes(".startup-intro-shell {"), false);
  assert.equal(styles.includes(".startup-intro-shell::before"), false);
  assert.equal(styles.includes(".startup-intro-shell::after"), false);
  assert.equal(styles.includes(".startup-intro-shell-base::before"), false);
  assert.equal(styles.includes(".startup-intro-frame::before"), false);
  assert.equal(styles.includes(".startup-intro-frame::after"), false);
  assert.equal(styles.includes(".startup-intro-overlay::before"), false);
  assert.equal(styles.includes(".startup-intro-overlay::after"), false);

  const appRootRule = readCssRule(styles, 'html[data-desktop-shell="true"] .app-root[data-startup-intro]');
  assert.equal(appRootRule.includes("background: transparent"), true);
  assert.equal(appRootRule.includes("background-image: none"), true);
  assert.equal(appRootRule.includes("border: 0"), true);
  assert.equal(appRootRule.includes("box-shadow: none"), true);
  const expandedSidebarRule = readCssRule(styles, 'html[data-desktop-shell="true"] .app-root[data-startup-intro][data-sidebar-collapsed="false"] .app-sidebar');
  assert.equal(expandedSidebarRule.includes("width: var(--sidebar-width) !important"), true);
  const collapsedSidebarRule = readCssRule(styles, 'html[data-desktop-shell="true"] .app-root[data-startup-intro][data-sidebar-collapsed="true"] .app-sidebar');
  assert.equal(collapsedSidebarRule.includes("width: var(--sidebar-compact-width) !important"), true);
  const chromeRule = readCssRule(
    styles,
    ".app-root[data-startup-intro] > .app-sidebar,\n.app-root[data-startup-intro] .app-workbench-header,\n.app-root[data-startup-intro] .chat-input-floating"
  );
  assert.equal(chromeRule.includes("opacity: 0.001"), true);
  assert.equal(chromeRule.includes("visibility: visible"), true);
  assert.equal(chromeRule.includes("transform:"), false);
  assert.equal(chromeRule.includes("will-change: opacity"), true);
  assert.equal(chromeRule.includes("transition: none"), true);
  const workbenchRule = readCssRule(styles, ".app-root[data-startup-intro] > .app-workbench");
  assert.equal(workbenchRule.includes("opacity: 0.001"), true);
  assert.equal(workbenchRule.includes("visibility: visible"), true);
  assert.equal(workbenchRule.includes("transition: none"), true);
  const workbenchPrepaintRule = readCssRule(styles, '.app-root[data-startup-intro="title-ready"] > .app-workbench');
  assert.equal(workbenchPrepaintRule.includes("opacity: 0.001"), true);
  assert.equal(workbenchPrepaintRule.includes("visibility: visible"), true);
  assert.equal(workbenchPrepaintRule.includes("transition: none"), true);
  const workbenchHandoffRule = readCssRule(styles, '.app-root[data-startup-intro="title-handoff"] > .app-workbench');
  assert.equal(workbenchHandoffRule.includes("opacity: 1"), true);
  assert.equal(workbenchHandoffRule.includes("visibility: visible"), true);
  assert.equal(workbenchHandoffRule.includes("opacity var(--startup-intro-app-reveal-duration)"), true);
  const chromePrepaintRule = readCssRule(
    styles,
    '.app-root[data-startup-intro="title-ready"] > .app-sidebar,\n.app-root[data-startup-intro="title-ready"] .app-workbench-header,\n.app-root[data-startup-intro="title-ready"] .chat-input-floating'
  );
  assert.equal(chromePrepaintRule.includes("opacity: 0.001"), true);
  assert.equal(chromePrepaintRule.includes("visibility: visible"), true);
  assert.equal(chromePrepaintRule.includes("transition: none"), true);
  assert.equal(styles.includes("transition-delay: var(--startup-intro-main-reveal-delay), 0ms"), false);
  assert.equal(styles.includes("transition-delay: var(--startup-intro-topbar-reveal-delay), 0ms"), true);
  assert.equal(styles.includes("transition-delay: var(--startup-intro-sidebar-reveal-delay), 0ms"), true);
  assert.equal(styles.includes("transition-delay: var(--startup-intro-composer-settle-delay), 0ms"), true);
  const headingRule = readCssRule(styles, ".app-root[data-startup-intro] .chat-empty-heading");
  assert.equal(headingRule.includes("opacity: 0.001"), true);
  assert.equal(headingRule.includes("visibility: visible"), true);
  assert.equal(headingRule.includes("transform: translate3d(0, 0, 0)"), true);
  assert.equal(headingRule.includes("transition: none"), true);
  assert.equal(headingRule.includes("will-change: opacity"), true);
  const headingHandoffRule = readCssRule(
    styles,
    '.app-root[data-startup-intro="title-ready"] .chat-empty-heading,\n.app-root[data-startup-intro="title-handoff"] .chat-empty-heading'
  );
  assert.equal(headingHandoffRule.includes("opacity: 0.001"), true);
  assert.equal(headingHandoffRule.includes("visibility: visible"), true);
  assert.equal(headingHandoffRule.includes("transform: translate3d(0, 0, 0)"), true);
  assert.equal(headingHandoffRule.includes("transition: none"), true);
  assert.equal(styles.includes('.app-root[data-startup-intro="title-handoff"][data-startup-title-slide="active"] .chat-empty-heading'), false);
  const frameRule = readCssRule(styles, ".startup-intro-frame");
  assert.equal(frameRule.includes("left: var(--startup-intro-source-x, 0px)"), true);
  assert.equal(frameRule.includes("top: var(--startup-intro-source-y, 0px)"), true);
  assert.equal(frameRule.includes("width: var(--startup-intro-source-width, 100%)"), true);
  assert.equal(frameRule.includes("height: var(--startup-intro-source-height, 100%)"), true);
  assert.equal(frameRule.includes("background-color: var(--startup-intro-shell-bg, var(--bg))"), true);
  assert.equal(frameRule.includes("background-image: none"), true);
  assert.equal(frameRule.includes("linear-gradient("), false);
  assert.equal(frameRule.includes("box-shadow:"), false);
  assert.equal(frameRule.includes("border:"), false);
  const windowUiRule = readCssRule(styles, ".startup-intro-window-ui");
  assert.equal(windowUiRule.includes("left: var(--startup-intro-source-x, 0px)"), true);
  assert.equal(windowUiRule.includes("top: var(--startup-intro-source-y, 0px)"), true);
  assert.equal(windowUiRule.includes("width: var(--startup-intro-source-width, 100%)"), true);
  assert.equal(windowUiRule.includes("height: var(--startup-intro-source-height, 100%)"), true);
  assert.equal(windowUiRule.includes("opacity: 0.42"), true);
  assert.equal(windowUiRule.includes("pointer-events: none"), true);
  const windowUiReleaseRule = readCssRule(
    styles,
    '.startup-intro-overlay[data-phase="expanding"] .startup-intro-window-ui,\n.startup-intro-overlay[data-phase="title-ready"] .startup-intro-window-ui,\n.startup-intro-overlay[data-phase="title-handoff"] .startup-intro-window-ui'
  );
  assert.equal(windowUiReleaseRule.includes("opacity: 0"), true);
  assert.equal(styles.includes('.startup-intro-overlay[data-phase="expanding"] .startup-intro-frame'), true);
  assert.equal(styles.includes('.startup-intro-overlay[data-phase="title-handoff"] .startup-intro-frame'), true);
}

function assertNoOuterEffects(styles: string): void {
  assert.equal(styles.includes(".startup-intro-glow"), false);
  assert.equal(styles.includes("glow"), false);
  assert.equal(styles.includes("drop-shadow"), false);
  assert.equal(styles.includes("radial-gradient("), false);
  assert.equal(styles.includes("blur("), false);
  assert.equal(styles.includes("backdrop-filter"), false);
  assert.equal(styles.includes("-webkit-filter"), false);
  assert.equal(styles.includes("text-shadow"), false);
  assert.equal(/\bfilter\s*:/.test(styles), false);

  const boxShadowValues = readCssDeclarationValues(styles, "box-shadow");
  assert.equal(boxShadowValues.length > 0, true);
  for (const value of boxShadowValues) {
    assert.equal(
      value === "none" || splitTopLevelComma(value).every((part) => part.trimStart().startsWith("inset")),
      true,
      `startup intro box-shadow must stay inset-only: ${value}`
    );
  }
}

function assertOrder(source: string, before: string, after: string): void {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.notEqual(beforeIndex, -1, `missing ${before}`);
  assert.notEqual(afterIndex, -1, `missing ${after}`);
  assert.equal(beforeIndex < afterIndex, true, `${before} should appear before ${after}`);
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function readCssRule(styles: string, selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS rule ${selector}`);
  const openingBrace = styles.indexOf("{", start);
  return readBalancedBlock(styles, openingBrace);
}

function readCssKeyframes(styles: string, name: string): string {
  const start = styles.indexOf(`@keyframes ${name} {`);
  assert.notEqual(start, -1, `missing @keyframes ${name}`);
  const openingBrace = styles.indexOf("{", start);
  return readBalancedBlock(styles, openingBrace);
}

function readBalancedBlock(source: string, openingBrace: number): string {
  assert.notEqual(openingBrace, -1, "missing opening brace");
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingBrace + 1, index);
      }
    }
  }
  assert.fail("missing closing brace");
}

function readCssPropertyValues(block: string, property: string): readonly string[] {
  const pattern = new RegExp(`${escapeRegExp(property)}:\\s*([^;]+);`, "g");
  return Array.from(block.matchAll(pattern), (match) => match[1]?.trim() ?? "");
}

function readCssDeclarationValues(block: string, property: string): readonly string[] {
  const values: string[] = [];
  const pattern = new RegExp(`${escapeRegExp(property)}:\\s*`, "g");
  for (const match of block.matchAll(pattern)) {
    const start = match.index + match[0].length;
    let depth = 0;
    for (let index = start; index < block.length; index += 1) {
      const character = block[index];
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
      } else if (character === ";" && depth === 0) {
        values.push(block.slice(start, index).trim());
        break;
      }
    }
  }
  return values;
}

function splitTopLevelComma(value: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
