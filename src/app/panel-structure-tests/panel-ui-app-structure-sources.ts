import nodeAssert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readAppSource, readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

export const assert = {
  equal(actual: unknown, expected: unknown, message?: string): void {
    nodeAssert.equal(actual, expected, message);
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    nodeAssert.deepEqual(actual, expected, message);
  },
};

export type PanelUiAppStructureSources = {
  readonly entry: string;
  readonly app: string;
  readonly api: string;
  readonly text: string;
  readonly appRuntimeControls: string;
  readonly appAttachments: string;
  readonly appBootstrap: string;
  readonly appConfigActions: string;
  readonly appUpdateActions: string;
  readonly appConfigProjection: string;
  readonly appConversationRefresh: string;
  readonly conversationRefresh: string;
  readonly submitFlow: string;
  readonly appObservedRunReadModel: string;
  readonly appRunProjection: string;
  readonly panelContextWindowUsage: string;
  readonly appRunController: string;
  readonly appConversationSession: string;
  readonly appTaskSubmission: string;
  readonly appLiveRunUpdates: string;
  readonly transcriptStore: string;
  readonly appSettingsController: string;
  readonly appState: string;
  readonly chatEmpty: string;
  readonly workbenchShell: string;
  readonly workbenchMain: string;
  readonly chatTranscriptChain: string;
  readonly transcriptTimeline: string;
  readonly sidebar: string;
  readonly settingsDialog: string;
  readonly workbenchSettingsDialog: string;
  readonly capabilitySettings: string;
  readonly skillSettings: string;
  readonly workspaceSettings: string;
  readonly deepView: string;
  readonly deepViewModel: string;
  readonly deepTranscriptModel: string;
  readonly deepWorkDetailModel: string;
  readonly deepRunTree: string;
  readonly deepConclusion: string;
  readonly multiAgentWorkspace: string;
  readonly appDeepEntry: string;
  readonly appDeepTaskController: string;
  readonly appSidebarConversationController: string;
  readonly appComposerController: string;
  readonly appFormStateSync: string;
  readonly appWorkbenchConfigState: string;
  readonly appShellEffects: string;
  readonly appShellState: string;
  readonly appWorkbenchShellProps: string;
  readonly appWorkbenchRuntime: string;
  readonly appWorkbenchTaskState: string;
  readonly appQueuedMessageState: string;
  readonly appWorkbenchInputProps: string;
  readonly appDeepLiveUpdates: string;
  readonly appDeepControl: string;
  readonly appDeepIntake: string;
  readonly appDeepHistory: string;
  readonly deepStyles: string;
  readonly shellStyles: string;
  readonly chatComposerStyles: string;
  readonly chatMessageStyles: string;
  readonly motionResponsiveStyles: string;
  readonly workspaceStyles: string;
  readonly appModelUsageDisplay: string;
};

export async function readPanelUiAppStructureSources(): Promise<PanelUiAppStructureSources> {
  const [
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
  ] = await Promise.all([
    readPanelUiSource("main.tsx"),
    readPanelUiSource("App.tsx"),
    readPanelUiSource("api.ts"),
    readPanelUiSource("text.ts"),
    readPanelUiSource("app-runtime-controls.ts"),
    readPanelUiSource("app-attachments.ts"),
    readPanelUiSource("app-bootstrap.ts"),
    readPanelUiSource("app-config-actions.ts"),
    readPanelUiSource("app-update-actions.ts"),
    readPanelUiSource("app-config-projection.ts"),
    readPanelUiSource("app-conversation-refresh.ts"),
    readPanelUiSource("conversation-refresh-policy.ts"),
    readPanelUiSource("app-task-submit-flow.ts"),
    readPanelUiSource("app-observed-run-read-model.ts"),
    readPanelUiSource("app-run-projection.ts"),
    readPanelUiSource("context-window-usage.ts"),
    readPanelUiSource("app-run-controller.ts"),
    readPanelUiSource("app-conversation-session.ts"),
    readPanelUiSource("app-task-submission.ts"),
    readPanelUiSource("app-live-run-updates.ts"),
    readPanelUiSource("panel-ui-transcript-store.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource("app-state.ts"),
    readPanelUiSource(path.join("components", "chat-empty.tsx")),
    readPanelUiSource(path.join("components", "workbench-shell.tsx")),
    readPanelUiSource(path.join("components", "workbench-main.tsx")),
    readPanelUiSource(path.join("components", "chat-transcript-chain.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline.tsx")),
    readPanelUiSource(path.join("components", "sidebar.tsx")),
    readPanelUiSource(path.join("components", "settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "workbench-settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "capability-settings.tsx")),
    readPanelUiSource(path.join("components", "skill-settings.tsx")),
    readPanelUiSource(path.join("components", "workspace-settings.tsx")),
    readPanelUiSource(path.join("components", "deep-view.tsx")),
    readPanelUiSource("deep-view-model.ts"),
    readPanelUiSource("deep-transcript-model.ts"),
    readPanelUiSource("deep-work-detail-model.ts"),
    readPanelUiSource(path.join("components", "deep-run-tree.tsx")),
    readPanelUiSource(path.join("components", "deep-conclusion.tsx")),
    readPanelUiSource(path.join("components", "multi-agent-workspace.tsx")),
    readPanelUiSource("app-deep-entry.ts"),
    readPanelUiSource("app-deep-task-controller.ts"),
    readPanelUiSource("app-sidebar-conversation-controller.ts"),
    readPanelUiSource("app-composer-controller.ts"),
    readPanelUiSource("app-form-state-sync.ts"),
    readPanelUiSource("app-workbench-config-state.ts"),
    readPanelUiSource("app-shell-effects.ts"),
    readPanelUiSource("app-shell-state.ts"),
    readPanelUiSource("app-workbench-shell-props.ts"),
    readPanelUiSource("app-workbench-runtime.ts"),
    readPanelUiSource("app-workbench-task-state.ts"),
    readPanelUiSource("app-queued-message-state.ts"),
    readPanelUiSource("app-workbench-input-props.ts"),
    readPanelUiSource("app-deep-live-updates.ts"),
    readPanelUiSource("app-deep-control.ts"),
    readPanelUiSource("app-deep-intake.ts"),
    readPanelUiSource("app-deep-history.ts"),
    readPanelUiStyle("deep-view.css"),
    readPanelUiStyle("shell.css"),
    readPanelUiStyle("chat-composer.css"),
    readPanelUiStyle("chat-message.css"),
    readPanelUiStyle("motion-responsive.css"),
    readPanelUiStyle("workspace.css"),
    readPanelUiSource("app-model-usage-display.ts"),
  ]);
  return {
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
  };
}

export function hasPanelUiModuleReference(source: string, modulePath: string): boolean {
  return source.includes(`from "${modulePath}"`) || source.includes(`import("${modulePath}")`);
}

export function hasJsxComponentReference(source: string, componentName: string): boolean {
  return source.includes(`<${componentName}`) || source.includes(`<Lazy${componentName}`);
}

export function assertIncludesAll(source: string, patterns: readonly string[]): void {
  for (const pattern of patterns) {
    if (!source.includes(pattern)) {
      throw new Error(`Expected source to include: ${pattern}`);
    }
  }
}

export function assertExcludesAll(source: string, patterns: readonly string[]): void {
  for (const pattern of patterns) {
    if (source.includes(pattern)) {
      throw new Error(`Expected source to exclude: ${pattern}`);
    }
  }
}

export async function listPanelUiSourceFiles(root: string): Promise<readonly string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return listPanelUiSourceFiles(fullPath);
    }
    if (entry.isFile() && /\.(ts|tsx)$/u.test(entry.name)) {
      return [fullPath];
    }
    return [];
  }));
  return nested.flat();
}
