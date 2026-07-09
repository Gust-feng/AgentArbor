import type { AgentMode, ComposerToolConfirmationPolicy } from "./app-config-projection";
import { isTerminalDeepRunStatus, shouldKeepDeepRunBusy } from "./app-deep-history";
import type { ChatInputProps, ChatModelOption, QueuedChatMessage } from "./components/chat-empty";
import type { ContextAttachment } from "./contracts/context";
import type {
  DeepIntakeStatus,
  DeepLivePhase,
  DeepRunStatus,
  DeepRunView,
} from "./contracts/deep";
import type { ContextWindowUsage } from "./context-window-usage";

export type WorkbenchInputPropsOptions = {
  readonly agentClusterActive: boolean;
  readonly goal: string;
  readonly setGoal: (value: string) => void;
  readonly attachments: readonly ContextAttachment[];
  readonly selectedWorkspaceDirectory?: string;
  readonly selectTaskWorkspace: () => void | Promise<void>;
  readonly selectAttachment: () => void | Promise<void>;
  readonly uploadAttachments: (files: readonly File[]) => void | Promise<void>;
  readonly removeAttachment: (attachmentId: string) => void;
  readonly contextBusy: boolean;
  readonly busy: boolean;
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly contextUsage?: ContextWindowUsage;
  readonly reasoningEffort: "" | "low" | "medium" | "high";
  readonly reasoningEffortEnabled: boolean;
  readonly onReasoningEffortChange: (value: "" | "low" | "medium" | "high") => void;
  readonly toolConfirmationPolicy: ComposerToolConfirmationPolicy;
  readonly onToolConfirmationPolicyChange: (value: ComposerToolConfirmationPolicy) => void;
  readonly closeSignal: number;
  readonly onModelSelect: (modelId: string) => void | Promise<void>;
  readonly onOpenSettings: () => void;
  readonly submitDeepInput: () => void | Promise<void>;
  readonly enqueueMessage: (content: string) => void;
  readonly startTask: (explicitGoal?: string) => void | Promise<void>;
  readonly clearQueuedMessages: () => void;
  readonly cancelRun: () => void | Promise<void>;
  readonly stopDeepTask: () => void | Promise<void>;
  readonly modelResponding: boolean;
  readonly deepBusy: boolean;
  readonly deep: DeepRunView | undefined;
  readonly deepActiveRunId?: string;
  readonly deepIntakeStatus?: DeepIntakeStatus;
};

export type WorkbenchInputPropsViewModel = {
  readonly activeInputAgentMode: AgentMode;
  readonly inputProps: ChatInputProps;
  readonly deepInputProps: ChatInputProps;
  readonly hasBusyDeepRun: boolean;
  readonly hasPendingDeepRunBootstrap: boolean;
  readonly hasActiveDeepRun: boolean;
};

export function buildWorkbenchInputProps(
  options: WorkbenchInputPropsOptions,
): WorkbenchInputPropsViewModel {
  const activeInputAgentMode: AgentMode = options.agentClusterActive ? "deep" : "normal";
  const inputProps: ChatInputProps = {
    value: options.goal,
    onChange: options.setGoal,
    agentMode: activeInputAgentMode,
    attachments: options.attachments,
    selectedWorkspaceDirectory: options.selectedWorkspaceDirectory,
    onSelectWorkspaceDirectory: () => void options.selectTaskWorkspace(),
    onSelectAttachment: () => void options.selectAttachment(),
    onUploadAttachmentFiles: (files: readonly File[]) => void options.uploadAttachments(files),
    onRemoveAttachment: options.removeAttachment,
    contextBusy: options.contextBusy,
    busy: options.busy,
    models: options.models,
    selectedModelId: options.selectedModelId,
    contextUsage: options.contextUsage,
    reasoningEffort: options.reasoningEffort,
    reasoningEffortEnabled: options.reasoningEffortEnabled,
    onReasoningEffortChange: options.onReasoningEffortChange,
    toolConfirmationPolicy: options.toolConfirmationPolicy,
    onToolConfirmationPolicyChange: options.onToolConfirmationPolicyChange,
    closeSignal: options.closeSignal,
    onModelSelect: options.onModelSelect,
    onOpenSettings: options.onOpenSettings,
    onSubmit: () => {
      if (options.agentClusterActive) {
        void options.submitDeepInput();
      } else if (options.busy || options.modelResponding) {
        options.enqueueMessage(options.goal);
        options.setGoal("");
      } else {
        void options.startTask();
      }
    },
    allowInputWhileBusy: true,
    onCancel: () => {
      options.clearQueuedMessages();
      void options.cancelRun();
    },
  };
  const hasBusyDeepRun = shouldKeepDeepRunBusy(options.deep?.run);
  const hasPendingDeepRunBootstrap = options.deepActiveRunId !== undefined && options.deep === undefined;
  const hasActiveDeepRun = hasBusyDeepRun || hasPendingDeepRunBootstrap;
  const deepInputProps: ChatInputProps = {
    ...inputProps,
    busy: options.deepBusy && !hasActiveDeepRun,
    running: options.deepBusy && hasActiveDeepRun,
    queuedMessages: undefined,
    onRemoveQueuedMessage: undefined,
    onUpdateQueuedMessage: undefined,
    placeholder: deepInputPlaceholder(
      options.deep?.run.status,
      options.deep?.liveProjection.phase,
      options.deepBusy,
      hasActiveDeepRun,
      options.deepIntakeStatus,
    ),
    onSubmit: () => {
      void options.submitDeepInput();
    },
    onCancel: () => {
      void options.stopDeepTask();
    },
    cancelLabel: "停止",
  };

  return {
    activeInputAgentMode,
    inputProps,
    deepInputProps,
    hasBusyDeepRun,
    hasPendingDeepRunBootstrap,
    hasActiveDeepRun,
  };
}

function deepInputPlaceholder(
  status: DeepRunStatus | undefined,
  phase: DeepLivePhase | undefined,
  busy: boolean,
  hasActiveRun: boolean,
  intakeStatus: "needs_input" | "answered" | "plan_ready" | "running" | undefined,
): string {
  if (busy && !hasActiveRun) {
    return "正在理解...";
  }
  if (intakeStatus === "needs_input") {
    return "补充要求或范围...";
  }
  if (intakeStatus === "answered" && !hasActiveRun) {
    return "继续围绕当前主题补充...";
  }
  if (intakeStatus === "plan_ready" && !hasActiveRun) {
    return "继续调整计划或确认开始...";
  }
  if (!hasActiveRun) {
    return "描述要协作处理的目标...";
  }
  if (busy || status === "running" || status === "pending" || phase === "needs_input") {
    return "补充要求...";
  }
  if (status !== undefined && isTerminalDeepRunStatus(status)) {
    return "继续围绕当前主题补充...";
  }
  return "描述要协作处理的目标...";
}
