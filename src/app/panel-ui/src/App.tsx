import React, { useRef, useState } from "react";
import { WorkbenchShell } from "./components/workbench-shell";
import { useStartupIntro } from "./app-startup-intro";
import { useAppShellEffects } from "./app-shell-effects";
import { persistSidebarCollapsedPreference, useAppShellState } from "./app-shell-state";
import { useAppQueuedMessages } from "./app-queued-message-state";
import { useAppWorkbenchConfigState } from "./app-workbench-config-state";
import { useAppWorkbenchRuntime } from "./app-workbench-runtime";
import {
  buildSidebarProps,
  buildWorkbenchMainProps,
  buildWorkbenchSettingsDialogProps,
  chatScreenFrom,
  isBootstrappingApp,
  isStartupIntroActive,
  startupIntroOverlayPropsFrom,
  startupIntroRootStyleFrom,
} from "./app-workbench-shell-props";
import { useAppWorkbenchTaskState } from "./app-workbench-task-state";
import { buildWorkbenchInputProps } from "./app-workbench-input-props";
import { createInitialAppState } from "./app-state";

export function App(): React.ReactElement {
  const [app, setApp] = useState(createInitialAppState);
  const [startupAnimationAllowed] = useState(readStartupAnimationAllowed);
  const taskState = useAppWorkbenchTaskState(app);
  const {
    goal,
    setGoal,
    attachments,
    setAttachments,
    selectedWorkspaceDirectory,
    setSelectedWorkspaceDirectory,
  } = taskState;
  const configState = useAppWorkbenchConfigState(app);
  const {
    aiMode,
    modelForm,
    setModelForm,
    composerReasoningEffort,
    setComposerReasoningEffort,
    toolConfirmationPolicy,
    setToolConfirmationPolicy,
    setComposerSelectedModelId,
    modelCatalogs,
    setModelCatalogs,
    workspaceDirectory,
    setWorkspaceDirectory,
    desktopAgentSystemPrompt,
    setDesktopAgentSystemPrompt,
    toolForm,
    setToolForm,
    mcpServerForm,
    setMcpServerForm,
    modelOptions,
    selectedModelId,
    selectedModelSupportsReasoningEffort,
    selectedModelContextWindowTokens,
  } = configState;
  const openNormalAgentEntryRef = useRef<(() => void) | undefined>(undefined);
  const shellState = useAppShellState({
    agentMode: app.agentMode,
    onExitDeepMode: () => {
      openNormalAgentEntryRef.current?.();
    },
  });
  const {
    screen,
    setScreen,
    settingsOpen,
    settingsGroup,
    sidebarCollapsed,
    setSidebarCollapsed,
    startupAnimationEnabled,
    setStartupAnimationEnabled,
    modelUsageDisplayEnabled,
    setModelUsageDisplayEnabled,
    agentClusterEnabled,
    pinningConversationIds,
    setPinningConversationIds,
    inputCloseSignal,
    setInputCloseSignal,
    openSettings,
    closeSettings,
    changeModelUsageDisplay,
    changeAgentClusterEnabled,
  } = shellState;
  const agentClusterActive = agentClusterEnabled && app.agentMode === "deep";
  const runtime = useAppWorkbenchRuntime({
    app,
    setApp,
    setScreen,
    setGoal,
    goal,
    aiMode,
    composerReasoningEffort,
    toolConfirmationPolicy,
    setToolConfirmationPolicy,
    setComposerSelectedModelId,
    modelForm,
    setModelForm,
    setModelCatalogs,
    workspaceDirectory,
    setDesktopAgentSystemPrompt,
    toolForm,
    setToolForm,
    mcpServerForm,
    setMcpServerForm,
    attachments,
    setAttachments,
    selectedWorkspaceDirectory,
    setSelectedWorkspaceDirectory,
    selectedModelId,
    selectedModelSupportsReasoningEffort,
    selectedModelContextWindowTokens,
    agentClusterActive,
    setInputCloseSignal,
    setPinningConversationIds,
  });
  const {
    currentRun,
    contextUsage,
    modelResponding,
    pendingConfirmation,
    pendingCount,
    confirmationBusy,
    contextBusy,
    deepChildOperationBusyId,
    deepResynthesisBusy,
    savingModel,
    savingWorkspace,
    savingDesktopAgent,
    savingTools,
    runActions,
    deepEntryActions,
    deepTaskActions,
    sidebarActions,
    settingsController,
    composerActions,
  } = runtime;
  const {
    startTask,
    cancelRun,
    decideConfirmation,
  } = runActions;
  const {
    openNormalAgentEntry,
    openNormalTaskEntry,
    openNormalConversation,
    openAgentClusterRun,
    openAgentClusterConversation,
    openAgentClusterEntry,
  } = deepEntryActions;
  openNormalAgentEntryRef.current = openNormalAgentEntry;
  const {
    submitDeepInput,
    startConfirmedDeepRun,
    stopDeepTask,
    sendDeepChildMessage,
    decideDeepChild,
    resynthesizeDeepRun,
  } = deepTaskActions;
  const {
    renameConversation,
    toggleConversationPinned,
    deleteConversation,
    renameDeepConversation,
    toggleDeepConversationPinned,
    deleteDeepConversation,
  } = sidebarActions;
  const {
    selectInputModel,
    selectAttachment,
    selectTaskWorkspace,
    uploadAttachments,
    removeAttachment,
    changeToolConfirmationPolicy,
  } = composerActions;
  useAppShellEffects({
    sidebarCollapsed,
    persistSidebarCollapsed: persistSidebarCollapsedPreference,
    setStartupAnimationEnabled,
    setModelUsageDisplayEnabled,
    appUpdate: app.appUpdate,
    checkAppUpdate: settingsController.checkAppUpdate,
    refreshAppUpdateStatus: settingsController.refreshAppUpdateStatus,
  });
  const {
    queuedMessages,
    enqueueMessage,
    removeQueuedMessage,
    updateQueuedMessage,
    clearQueuedMessages,
  } = useAppQueuedMessages({
    busy: app.busy,
    currentRun: currentRun.run,
    setGoal,
    startTask,
  });
  const { inputProps, deepInputProps } = buildWorkbenchInputProps({
    agentClusterActive,
    goal,
    setGoal,
    attachments,
    selectedWorkspaceDirectory,
    selectTaskWorkspace,
    selectAttachment,
    uploadAttachments,
    removeAttachment,
    contextBusy,
    busy: app.busy,
    models: modelOptions,
    selectedModelId,
    contextUsage,
    reasoningEffort: composerReasoningEffort,
    reasoningEffortEnabled: selectedModelSupportsReasoningEffort,
    onReasoningEffortChange: setComposerReasoningEffort,
    toolConfirmationPolicy,
    onToolConfirmationPolicyChange: changeToolConfirmationPolicy,
    closeSignal: inputCloseSignal,
    onModelSelect: selectInputModel,
    onOpenSettings: () => openSettings("models"),
    submitDeepInput,
    enqueueMessage,
    startTask,
    clearQueuedMessages,
    cancelRun,
    stopDeepTask,
    modelResponding,
    deepBusy: app.deepBusy,
    deep: app.deep,
    deepActiveRunId: app.deepActiveRunId,
    deepIntakeStatus: app.deepIntakeStatus,
  });

  const chatScreen = chatScreenFrom({
    agentClusterActive,
    screen,
    conversation: app.conversation,
    currentRun,
  });
  const isBootstrapping = isBootstrappingApp(app);
  const startupIntro = useStartupIntro(isBootstrapping, { startupAnimationEnabled, startupAnimationAllowed });
  const startupIntroRootStyle = startupIntroRootStyleFrom(startupIntro);
  const startupIntroActive = isStartupIntroActive(startupIntro);
  const sidebarProps = buildSidebarProps({
    chatScreen,
    app,
    pendingCount,
    sidebarCollapsed,
    agentClusterActive,
    agentClusterEnabled,
    pinningConversationIds,
    onNew: openNormalTaskEntry,
    onOpenAgentCluster: openAgentClusterEntry,
    onOpenDeepConversation: (conversationId) => void openAgentClusterConversation(conversationId),
    onOpenDeepRun: (runId) => void openAgentClusterRun(runId),
    onOpen: openNormalConversation,
    onRename: (id, title) => void renameConversation(id, title),
    onRenameDeep: (id, title) => void renameDeepConversation(id, title),
    onTogglePinned: (id, pinned) => void toggleConversationPinned(id, pinned),
    onToggleDeepPinned: (id, pinned) => void toggleDeepConversationPinned(id, pinned),
    onDelete: (id) => void deleteConversation(id),
    onDeleteDeep: (id) => void deleteDeepConversation(id),
    onOpenSettings: () => openSettings("models"),
  });
  const workbenchMainProps = buildWorkbenchMainProps({
    isBootstrapping,
    agentClusterActive,
    chatScreen,
    startupIntroActive,
    app,
    inputProps,
    deepInputProps,
    currentRun,
    modelUsageDisplayEnabled,
    pendingConfirmation,
    onDecision: (decision, guidance) => void decideConfirmation(decision, guidance),
    confirmationBusy,
    queuedMessages,
    onRemoveQueuedMessage: removeQueuedMessage,
    onUpdateQueuedMessage: updateQueuedMessage,
    deepChildOperationBusyId,
    deepResynthesisBusy,
    onStartConfirmedRun: startConfirmedDeepRun,
    onChildMessage: sendDeepChildMessage,
    onChildConfirmation: decideDeepChild,
    onResynthesize: resynthesizeDeepRun,
    onStopRun: stopDeepTask,
  });
  const settingsDialogProps = buildWorkbenchSettingsDialogProps({
    settingsOpen,
    closeSettings,
    settingsGroup,
    app,
    modelCatalogs,
    forms: {
      modelForm,
      setModelForm,
      workspaceDirectory,
      setWorkspaceDirectory,
      desktopAgentSystemPrompt,
      setDesktopAgentSystemPrompt,
      toolForm,
      setToolForm,
      mcpServerForm,
      setMcpServerForm,
    },
    preferences: {
      modelUsageDisplayEnabled,
      onModelUsageDisplayChange: changeModelUsageDisplay,
      agentClusterEnabled,
      onAgentClusterEnabledChange: changeAgentClusterEnabled,
    },
    saving: {
      model: savingModel,
      workspace: savingWorkspace,
      desktopAgent: savingDesktopAgent,
      tools: savingTools,
    },
    actions: settingsController,
  });
  const startupIntroOverlayProps = startupIntroOverlayPropsFrom(startupIntro, sidebarCollapsed);

  return (
    <WorkbenchShell
      startupIntroPhase={startupIntro.overlayPhase}
      sidebarCollapsed={sidebarCollapsed}
      rootStyle={startupIntroRootStyle}
      sidebarProps={sidebarProps}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      appUpdate={app.appUpdate}
      onInstallAppUpdate={() => void settingsController.installAppUpdate()}
      mainProps={workbenchMainProps}
      settingsDialogProps={settingsDialogProps}
      startupIntroOverlayProps={startupIntroOverlayProps}
    />
  );
}

function readStartupAnimationAllowed(): boolean {
  return document.documentElement.dataset.desktopStartupAnimation !== "consumed";
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
