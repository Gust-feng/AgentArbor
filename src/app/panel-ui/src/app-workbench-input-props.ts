import type { AgentMode, ComposerToolConfirmationPolicy } from "./app-config-projection";
import type {
  ChatInputProps,
  ChatModelOption,
  ConversationFollowUpMode,
} from "./contracts/composer";
import type { ContextAttachment } from "./contracts/context";
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
  readonly startTask: (explicitGoal?: string) => void | Promise<boolean>;
  readonly cancelRun: () => void | Promise<void>;
  readonly stopDeepTask: () => void | Promise<void>;
  readonly modelResponding: boolean;
  readonly followUpMode: ConversationFollowUpMode;
  readonly deepBusy: boolean;
  readonly deep: unknown;
  readonly deepActiveRunId?: string;
  readonly deepIntakeStatus?: unknown;
};

export type WorkbenchInputPropsViewModel = {
  readonly activeInputAgentMode: AgentMode;
  readonly inputProps: ChatInputProps;
};

export function workbenchInputPropsFrom(
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
    running: options.modelResponding,
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
      } else if (options.modelResponding && options.followUpMode === "guide") {
        options.setGoal("");
        void options.startTask();
      } else if (options.busy || options.modelResponding) {
        options.enqueueMessage(options.goal);
        options.setGoal("");
      } else {
        void options.startTask();
      }
    },
    allowInputWhileBusy: true,
    onCancel: () => {
      void options.cancelRun();
    },
  };
  return {
    activeInputAgentMode,
    inputProps,
  };
}
