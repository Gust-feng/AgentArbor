import React from "react";
import { StartupIntroOverlay, startupIntroTimingStyle, type StartupIntroState } from "./app-startup-intro";
import type { AppState } from "./app-state";
import type { CurrentRunProjection } from "./app-run-projection";
import { Sidebar } from "./components/sidebar";
import { WorkbenchSettingsDialog } from "./components/workbench-settings-dialog";
import type { SettingsGroup } from "./components/settings-types";
import type { AppUpdateInfo } from "./contracts/app-update";

type StartupIntroRootStyle = React.CSSProperties & {
  "--startup-intro-target-width"?: string;
  "--startup-intro-target-height"?: string;
  "--startup-intro-empty-grid-top-padding"?: string;
};

type SidebarScreen = React.ComponentProps<typeof Sidebar>["currentScreen"];

export function chatScreenFrom(options: {
  readonly agentClusterActive: boolean;
  readonly screen: SidebarScreen;
  readonly conversation: AppState["conversation"];
  readonly currentRun: CurrentRunProjection;
}): SidebarScreen {
  return options.agentClusterActive
    ? options.screen
    : options.screen === "chat-empty" &&
        (options.conversation !== undefined || options.currentRun.run !== undefined)
      ? "chat-active"
      : options.screen;
}

export function isBootstrappingApp(app: Pick<AppState, "config" | "conversations" | "error">): boolean {
  return app.config === undefined && app.conversations.length === 0 && app.error === undefined;
}

export function startupIntroRootStyleFrom(startupIntro: StartupIntroState): StartupIntroRootStyle | undefined {
  if (startupIntro.overlayPhase === undefined) {
    return undefined;
  }
  const style = startupIntroTimingStyle(startupIntro.timing) as StartupIntroRootStyle;
  if (startupIntro.reveal !== undefined) {
    style["--startup-intro-target-width"] = `${startupIntro.reveal.targetWindow.width}px`;
    style["--startup-intro-target-height"] = `${startupIntro.reveal.targetWindow.height}px`;
    style["--startup-intro-empty-grid-top-padding"] = `${startupIntroEmptyGridTopPadding(startupIntro.reveal.targetWindow.height)}px`;
  }
  return style;
}

export function isStartupIntroActive(startupIntro: StartupIntroState): boolean {
  return startupIntro.overlayPhase !== undefined && startupIntro.reveal !== undefined;
}

export function startupIntroOverlayPropsFrom(
  startupIntro: StartupIntroState,
  sidebarCollapsed: boolean,
): React.ComponentProps<typeof StartupIntroOverlay> | undefined {
  if (startupIntro.overlayPhase === undefined || startupIntro.reveal === undefined) {
    return undefined;
  }
  return {
    phase: startupIntro.overlayPhase,
    timing: startupIntro.timing,
    sidebarCollapsed,
    reveal: startupIntro.reveal,
  };
}

export function buildSidebarProps(options: {
  readonly chatScreen: SidebarScreen;
  readonly app: Pick<AppState, "conversations" | "deepConversations" | "deepRuns" | "conversation" | "deepConversation" | "deep" | "deepActiveRunId">;
  readonly pendingCount: number;
  readonly sidebarCollapsed: boolean;
  readonly agentClusterActive: boolean;
  readonly agentClusterEnabled: boolean;
  readonly pinningConversationIds: ReadonlySet<string>;
  readonly onNew: () => void;
  readonly onOpenAgentCluster: () => void;
  readonly onOpenDeepConversation: (conversationId: string) => void;
  readonly onOpenDeepRun: (runId: string) => void;
  readonly onOpen: (conversationId: string) => void;
  readonly onRename: (id: string, title: string) => void;
  readonly onRenameDeep: (id: string, title: string) => void;
  readonly onTogglePinned: (id: string, pinned: boolean) => void;
  readonly onToggleDeepPinned: (id: string, pinned: boolean) => void;
  readonly onDelete: (id: string) => void;
  readonly onDeleteDeep: (id: string) => void;
  readonly onOpenSettings: () => void;
}): React.ComponentProps<typeof Sidebar> {
  return {
    currentScreen: options.chatScreen,
    conversations: options.app.conversations,
    deepConversations: options.app.deepConversations,
    deepRuns: options.app.deepRuns,
    activeConversationId: options.agentClusterActive ? undefined : options.app.conversation?.conversationId,
    activeDeepConversationId: options.app.deepConversation?.conversationId ?? options.app.deep?.run.conversationId,
    activeDeepRunId: options.app.deep?.run.runId ?? options.app.deepActiveRunId,
    pendingCount: options.pendingCount,
    collapsed: options.sidebarCollapsed,
    agentClusterActive: options.agentClusterActive,
    agentClusterEnabled: options.agentClusterEnabled,
    pinningConversationIds: options.pinningConversationIds,
    onNew: options.onNew,
    onOpenAgentCluster: options.onOpenAgentCluster,
    onOpenDeepConversation: options.onOpenDeepConversation,
    onOpenDeepRun: options.onOpenDeepRun,
    onOpen: options.onOpen,
    onRename: options.onRename,
    onRenameDeep: options.onRenameDeep,
    onTogglePinned: options.onTogglePinned,
    onToggleDeepPinned: options.onToggleDeepPinned,
    onDelete: options.onDelete,
    onDeleteDeep: options.onDeleteDeep,
    onOpenSettings: options.onOpenSettings,
  };
}

export function buildWorkbenchSettingsDialogProps(options: {
  readonly settingsOpen: boolean;
  readonly closeSettings: () => void;
  readonly settingsGroup: SettingsGroup;
  readonly app: React.ComponentProps<typeof WorkbenchSettingsDialog>["app"];
  readonly modelCatalogs: React.ComponentProps<typeof WorkbenchSettingsDialog>["modelCatalogs"];
  readonly forms: React.ComponentProps<typeof WorkbenchSettingsDialog>["forms"];
  readonly preferences: React.ComponentProps<typeof WorkbenchSettingsDialog>["preferences"];
  readonly saving: React.ComponentProps<typeof WorkbenchSettingsDialog>["saving"];
  readonly actions: React.ComponentProps<typeof WorkbenchSettingsDialog>["actions"];
}): React.ComponentProps<typeof WorkbenchSettingsDialog> | undefined {
  if (!options.settingsOpen) {
    return undefined;
  }
  return {
    open: options.settingsOpen,
    onClose: options.closeSettings,
    initialGroup: options.settingsGroup,
    app: options.app,
    modelCatalogs: options.modelCatalogs,
    forms: options.forms,
    preferences: options.preferences,
    saving: options.saving,
    actions: options.actions,
  };
}

export function appUpdateReadyText(update: AppUpdateInfo): string {
  const version = update.latest?.version;
  return version === undefined || version === "unknown"
    ? "新版本已下载"
    : `新版本 ${version} 已下载`;
}

function startupIntroEmptyGridTopPadding(targetHeight: number): number {
  return Math.round(Math.min(Math.max(targetHeight * 0.16, 112), 154));
}
