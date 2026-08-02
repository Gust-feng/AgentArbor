import React, { useRef, useState } from "react";
import { PersonalWorkbench } from "./personal-workbench/personal-workbench";
import { useAppShellEffects } from "./app-shell-effects";
import { persistSidebarCollapsedPreference, useAppShellState } from "./app-shell-state";
import { useAppQueuedMessages } from "./app-queued-message-state";
import { useAppWorkbenchConfigState } from "./app-workbench-config-state";
import { useAppWorkbenchRuntime } from "./app-workbench-runtime";
import { workbenchSettingsDialogPropsFrom } from "./app-settings-dialog-props";
import { useAppWorkbenchTaskState } from "./app-workbench-task-state";
import { workbenchInputPropsFrom } from "./app-workbench-input-props";
import { createInitialAppState } from "./app-state";
import { useSpaceProjection } from "./app-space-state";

export function App(): React.ReactElement {
  const [app, setApp] = useState(createInitialAppState);
  const taskState = useAppWorkbenchTaskState(app);
  const spaceProjection = useSpaceProjection();
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
    setScreen,
    settingsOpen,
    settingsGroup,
    sidebarCollapsed,
    setSidebarCollapsed,
    modelUsageDisplayEnabled,
    setModelUsageDisplayEnabled,
    agentClusterEnabled,
    developerModeEnabled,
    inputCloseSignal,
    setInputCloseSignal,
    openSettings,
    closeSettings,
    changeModelUsageDisplay,
    changeAgentClusterEnabled,
    changeDeveloperMode,
  } = shellState;
  // The personal workbench is the production Ordinary entry. Deferred Deep
  // remains a settings/runtime compatibility concern, not a rendered surface.
  const agentClusterActive = false;
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
  });
  const {
    bootstrap,
    retryBootstrap,
    currentRun,
    contextUsage,
    modelResponding,
    pendingConfirmation,
    confirmationBusy,
    contextBusy,
    pendingConversationIds,
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
    openNormalConversation,
  } = deepEntryActions;
  openNormalAgentEntryRef.current = openNormalAgentEntry;
  const {
    submitDeepInput,
    stopDeepTask,
  } = deepTaskActions;
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
    setModelUsageDisplayEnabled,
    appUpdate: app.appUpdate,
    checkAppUpdate: settingsController.checkAppUpdate,
    refreshAppUpdateStatus: settingsController.refreshAppUpdateStatus,
  });
  const {
    enqueueMessage,
    queuedMessages,
    removeQueuedMessage,
    updateQueuedMessage,
  } = useAppQueuedMessages({
    busy: app.busy,
    currentRun: currentRun.run,
    setGoal,
    startTask,
  });
  const { inputProps: baseInputProps } = workbenchInputPropsFrom({
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
    cancelRun,
    stopDeepTask,
    modelResponding,
    deepBusy: app.deepBusy,
    deep: app.deep,
    deepActiveRunId: app.deepActiveRunId,
    deepIntakeStatus: app.deepIntakeStatus,
  });
  const inputProps = {
    ...baseInputProps,
    queuedMessages,
    onRemoveQueuedMessage: removeQueuedMessage,
    onUpdateQueuedMessage: updateQueuedMessage,
  };

  const settingsDialogProps = workbenchSettingsDialogPropsFrom({
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
      developerModeEnabled,
      onDeveloperModeChange: changeDeveloperMode,
    },
    saving: {
      model: savingModel,
      workspace: savingWorkspace,
      desktopAgent: savingDesktopAgent,
      tools: savingTools,
    },
    actions: settingsController,
  });
  return (
    <PersonalWorkbench
      personalKnowledgePersistenceEnabled
      bootstrapState={{
        status: bootstrap.status,
        ...(bootstrap.status === "error" ? { error: bootstrap.message } : {}),
        onRetry: retryBootstrap,
      }}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      conversation={app.conversation}
      conversations={app.conversations}
      currentRun={currentRun}
      inputProps={inputProps}
      showModelUsage={modelUsageDisplayEnabled}
      developerModeEnabled={developerModeEnabled}
      error={app.error}
      pendingConfirmation={pendingConfirmation}
      confirmationBusy={confirmationBusy}
      onDecision={(decision, guidance) => void decideConfirmation(decision, guidance)}
      onStartNewConversation={runActions.startNewConversation}
      onOpenConversation={openNormalConversation}
      pendingConversationIds={pendingConversationIds}
      onRenameConversation={sidebarActions.renameConversation}
      onToggleConversationPinned={sidebarActions.toggleConversationPinned}
      onDeleteConversation={sidebarActions.deleteConversation}
      spaces={spaceProjection.spaces}
      spaceLoadState={{
        loading: spaceProjection.loading,
        mutationPending: spaceProjection.mutationPending,
        error: spaceProjection.error,
        onRetry: spaceProjection.refresh,
      }}
      onOpenSpaceItem={spaceProjection.openReference}
      onCreateSpace={spaceProjection.createSpace}
      spaceActions={{
        createManagedFolder: spaceProjection.createManagedFolder,
        addLocalFile: spaceProjection.addLocalFile,
        addWorkspaceFolder: spaceProjection.addWorkspaceFolder,
        addWebReference: spaceProjection.addWebReference,
        addConversation: spaceProjection.addConversation,
        move: spaceProjection.move,
        rename: spaceProjection.rename,
        unlinkReference: spaceProjection.unlinkReference,
        removeReference: spaceProjection.removeReference,
      }}
      onOpenSettings={() => openSettings("models")}
      appUpdate={app.appUpdate}
      onInstallAppUpdate={() => void settingsController.installAppUpdate()}
      settingsDialogProps={settingsDialogProps}
    />
  );
}
