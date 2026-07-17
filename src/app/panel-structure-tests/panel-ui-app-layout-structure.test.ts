import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assert,
  assertExcludesAll,
  assertIncludesAll,
  listPanelUiSourceFiles,
  readPanelUiAppStructureSources,
} from "./panel-ui-app-structure-sources.js";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("panel UI app shell keeps layout and style ownership split", async () => {
  const {
    entry,
    app,
    api,
    text,
    appRuntimeControls,
    appAttachments,
    appBootstrap,
    appConfigActions,
    appUpdateActions,
    appConfigProjection,
    appConversationRefresh,
    conversationRefresh,
    submitFlow,
    appObservedRunReadModel,
    appRunProjection,
    panelContextWindowUsage,
    appRunController,
    appConversationSession,
    appTaskSubmission,
    appLiveRunUpdates,
    transcriptStore,
    appSettingsController,
    appState,
    chatEmpty,
    workbenchShell,
    workbenchMain,
    chatTranscriptChain,
    transcriptTimeline,
    sidebar,
    settingsDialog,
    workbenchSettingsDialog,
    capabilitySettings,
    skillSettings,
    workspaceSettings,
    deepView,
    deepViewModel,
    deepTranscriptModel,
    deepWorkDetailModel,
    deepRunTree,
    deepConclusion,
    multiAgentWorkspace,
    appDeepEntry,
    appDeepTaskController,
    appSidebarConversationController,
    appComposerController,
    appFormStateSync,
    appWorkbenchConfigState,
    appShellEffects,
    appShellState,
    appWorkbenchShellProps,
    appWorkbenchRuntime,
    appWorkbenchTaskState,
    appQueuedMessageState,
    appWorkbenchInputProps,
    appDeepLiveUpdates,
    appDeepControl,
    appDeepIntake,
    appDeepHistory,
    deepStyles,
    shellStyles,
    chatComposerStyles,
    chatMessageStyles,
    motionResponsiveStyles,
    workspaceStyles,
    appModelUsageDisplay,
  } = await readPanelUiAppStructureSources();

  assert.equal(deepStyles.includes(".multi-agent-workspace"), true);
  assertIncludesAll(deepStyles, [
    ".multi-agent-body",
    ".multi-agent-primary",
    ".multi-agent-reading-shell",
    ".multi-agent-stage",
    ".multi-agent-commandbar",
    ".with-work-detail",
    "grid-template-columns: minmax(0, 1fr) clamp",
    ".deep-chat-view",
    ".deep-chat-thread",
    ".assistant-message",
    ".assistant-answer",
    ".user-message-wrap",
    ".deep-plan-confirmation",
    ".deep-run-transcript",
    ".deep-run-transcript-thread",
    ".deep-run-child-list",
    ".deep-run-child-list-item",
    ".deep-work-detail-panel",
    ".deep-work-detail-actionbar",
    ".deep-work-detail-composer",
    ".deep-child-task-approval",
  ]);
  assertExcludesAll(deepStyles, [
    ".multi-agent-missionbar",
    ".multi-agent-inspector",
    ".with-task-sidebar",
    ".with-workflow-detail",
    ".with-side-panel",
    ".deep-panel-view",
    ".deep-panel-scroll",
    ".deep-result-canvas",
    ".deep-result-head",
    ".deep-run-transcript-activity-block",
    ".deep-run-counters",
    ".deep-progress-log",
    ".deep-run-console",
    ".deep-run-workflow",
    ".deep-run-console-kicker",
    ".deep-run-console-goal-icon",
    ".deep-run-workflow .agent-activity-chip.meta",
    ".deep-workboard-result",
    ".deep-workboard-objective",
    ".deep-tree-live-map",
    ".deep-tree-live-node",
    ".multi-agent-history-list",
    ".multi-agent-run-facts",
    "flex: 0 0 280px",
    ".deep-task-sidebar",
    ".deep-task-sidebar-plan",
    ".deep-task-sidebar-child",
    ".deep-task-sidebar-actionbar",
    ".deep-task-sidebar-composer",
    ".deep-run-child-card",
    ".deep-run-child-grid",
    ".deep-run-child-section",
    ".deep-run-result",
    ".deep-chat-child-strip",
    ".deep-chat-child-card",
    ".deep-flow-canvas",
    ".deep-focus-output",
    ".deep-stage-navigator",
    ".deep-run-workflow-item",
    ".deep-workline-title",
    ".deep-workline-spin",
  ]);
  assert.equal(deepStyles.includes(".deep-child-node-followup-toggle"), false);
  assert.equal(deepStyles.includes("min-height: 0"), true);
  assert.equal(deepStyles.includes("overflow-y: auto"), true);
  assert.equal(deepStyles.includes("flex-direction: column"), true);
  assert.equal(deepStyles.includes("@media (prefers-reduced-motion: reduce)"), true);
  assert.equal(app.includes("sidebarCollapsed"), true);
  assert.equal(app.includes("onToggleSidebar"), true);
  assert.equal(app.includes("PanelLeftClose"), false);
  assert.equal(app.includes("PanelLeftOpen"), false);
  assert.equal(workbenchShell.includes("data-startup-intro"), true);
  assert.equal(workbenchShell.includes("data-sidebar-collapsed"), true);
  assert.equal(workbenchShell.includes("app-workbench-header"), true);
  assert.equal(workbenchShell.includes("onToggleSidebar"), true);
  assert.equal(workbenchShell.includes("PanelLeftClose"), true);
  assert.equal(workbenchShell.includes("PanelLeftOpen"), true);
  assert.equal(sidebar.includes("onToggleCollapsed"), false);
  assert.equal(sidebar.includes("PanelLeftClose"), false);
  assert.equal(sidebar.includes("PanelLeftOpen"), false);
  assert.equal(shellStyles.includes(".app-workbench-sidebar-toggle"), true);
  assert.equal(app.includes("Maximize2"), false);
  assert.equal(app.includes("Minimize2"), false);
  assert.equal(app.includes("getWindowState"), false);
  assert.equal(app.includes("onWindowStateChanged"), false);
  assert.equal(workbenchShell.includes("Maximize2"), true);
  assert.equal(workbenchShell.includes("Minimize2"), true);
  assert.equal(workbenchShell.includes("getWindowState"), true);
  assert.equal(workbenchShell.includes("onWindowStateChanged"), true);
  assert.equal(workbenchShell.includes("app-window-controls"), true);
  assert.equal(app.includes("Square"), false);
  assert.equal(shellStyles.includes('data-window-animating="true"'), true);
  assert.equal(app.includes("window.confirm"), false);
  assert.equal(app.includes("(response.conversations ?? previous.conversations).filter"), false);
  assert.equal(appSidebarConversationController.includes("(response.conversations ?? previous.conversations).filter"), true);
  assert.equal(shellStyles.includes(".topbar"), false);
  assert.equal(shellStyles.includes(".topbar-sidebar-button"), false);
  assert.equal(shellStyles.includes(".topbar-chip"), false);
  assert.equal(shellStyles.includes(".app-mode-switch"), false);
  assert.equal(shellStyles.includes(".app-mode-switch-button"), false);
  assert.equal(shellStyles.includes(".app-workbench-brand"), false);
  assert.equal(shellStyles.includes(".sidebar-agent-cluster-button"), true);
  assert.equal(motionResponsiveStyles.includes(".topbar-chip"), false);
  assert.equal(chatEmpty.includes("composer-options-button"), true);
  assert.equal(chatEmpty.includes("composer-options-popover"), true);
  assert.equal(chatEmpty.includes("composer-workspace-button"), true);
  assert.equal(chatEmpty.includes("workspace-pill"), false);
  assert.equal(chatEmpty.includes("onClearWorkspaceDirectory"), false);
  assert.equal(chatEmpty.includes("当前工作区"), false);
  assert.equal(chatEmpty.includes("attachmentMediaPreview"), true);
  assert.equal(chatEmpty.includes("attachment-image-thumbnail"), true);
  assert.equal(chatTranscriptChain.includes("UserMessageAttachments"), true);
  assert.equal(chatTranscriptChain.includes("user-message-image-attachment"), true);
  assert.equal(chatEmpty.includes("model-select-button"), false);
  assert.equal(chatComposerStyles.includes(".composer-options-button"), true);
  assert.equal(chatComposerStyles.includes(".composer-options-popover"), true);
  assert.equal(chatComposerStyles.includes(".composer-workspace-button"), true);
  assert.equal(chatComposerStyles.includes(".attachment-image-card"), true);
  assert.equal(chatComposerStyles.includes(".attachment-image-thumbnail"), true);
  assert.equal(chatMessageStyles.includes(".user-message-image-attachment"), true);
  assert.equal(chatComposerStyles.includes(".model-select-button"), false);
  assert.equal(motionResponsiveStyles.includes(".model-select-button"), false);
  assert.equal(workspaceStyles.includes(".skill-card"), false);
  assert.equal(workspaceStyles.includes(".tool-row"), false);
  assert.equal(workspaceStyles.includes(".workspace-tabs"), false);
  assert.equal(workspaceStyles.includes(".workspace-search"), false);
  assert.equal(workspaceStyles.includes(".service-settings-stack"), true);
  assert.equal(workspaceStyles.includes(".model-info-card"), true);
  assert.equal(workspaceStyles.includes(".model-info-grid"), true);
  assert.equal(workspaceStyles.includes(".capability-settings-stack"), false);
  assert.equal(workspaceStyles.includes(".capability-toggle"), true);
  assert.equal(workspaceStyles.includes(".mcp-service-card"), true);
  assert.equal(workspaceStyles.includes(".mcp-form-grid"), true);
  assert.equal(workspaceStyles.includes(".settings-capabilities"), false);
  assert.equal(workspaceStyles.includes(".service-config-grid"), true);
});
test("panel UI native title tooltips stay limited to compact inspection targets", async () => {
  const sourceRoot = path.join(process.cwd(), "src", "app", "panel-ui", "src");
  const files = await listPanelUiSourceFiles(sourceRoot);
  const nativeElementPattern = /<([a-z][\w.-]*)(?=[\s>/])[^>]*>/gms;
  const findings: {
    file: string;
    tag: string;
    tagSource: string;
  }[] = [];

  await Promise.all(files.map(async (file) => {
    const source = await fs.readFile(file, "utf8");
    let match: RegExpExecArray | null;
    while ((match = nativeElementPattern.exec(source)) !== null) {
      if (!/\btitle\s*=/u.test(match[0])) {
        continue;
      }
      findings.push({
        file: path.relative(sourceRoot, file).replaceAll("\\", "/"),
        tag: match[1],
        tagSource: match[0],
      });
    }
  }));

  assert.deepEqual(findings.filter((finding) => !isAllowedNativeTitleTooltip(finding)), []);
});

function isAllowedNativeTitleTooltip(finding: {
  readonly file: string;
  readonly tag: string;
  readonly tagSource: string;
}): boolean {
  if (
    finding.file === "components/chat-empty.tsx" &&
    finding.tag === "span" &&
    finding.tagSource.includes('className="composer-context-usage"')
  ) {
    return true;
  }
  if (finding.file === "components/activity-evidence.tsx") {
    return finding.tag === "span" && finding.tagSource.includes("title={item.label}");
  }
  return finding.file === "components/copy-action-button.tsx" &&
    finding.tag === "button" &&
    finding.tagSource.includes("copy-action-button");
}
