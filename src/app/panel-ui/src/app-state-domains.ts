import type { LiveRunBuffer } from "../../panel-read-model/run/panel-run-live-buffer";
import type { AgentMode } from "./app-config-projection";
import type { ConfigResponse } from "./contracts/config";
import type { Conversation, ConversationSummary } from "./contracts/conversation";
import type {
  BasicAgentRun,
  DesktopRunDetail,
  DesktopWorkView,
  RunCapabilityResolution,
  RunEvent,
  TranscriptNode,
} from "./contracts/run";
import type {
  DeepConversationSummary,
  DeepConversationView,
  DeepIntakeStatus,
  DeepRunSummary,
  DeepRunView,
} from "./contracts/deep";
import type { SkillDefinition } from "./contracts/skills";
import type { SubAgentDefinition } from "./contracts/sub-agents";
import type { ToolsResponse } from "./contracts/tools";
import type { AppUpdateInfo } from "./contracts/app-update";

/** Data loaded before the active workbench can render its capabilities. */
export type AppBootstrapState = {
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly appUpdate?: AppUpdateInfo;
  readonly skills: readonly SkillDefinition[];
  readonly subAgents: readonly SubAgentDefinition[];
};

/** Conversation summaries and the currently opened Ordinary conversation. */
export type AppConversationState = {
  readonly conversations: readonly ConversationSummary[];
  readonly conversation?: Conversation;
};

/** Ordinary Agent run facts and their observable transcript projection. */
export type AppRunObservationState = {
  readonly run?: BasicAgentRun;
  readonly workView?: DesktopWorkView;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly capabilityResolutionRunId?: string;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly transcriptNodesByRunId: Record<string, readonly TranscriptNode[]>;
  readonly events: readonly RunEvent[];
  readonly live?: LiveRunBuffer;
  readonly detail?: DesktopRunDetail;
  readonly busy: boolean;
  readonly error?: string;
};

/**
 * Deferred Multi-Agent compatibility facts. They remain isolated from the
 * Ordinary run contract until the deferred feature has a production owner.
 */
export type AppDeferredAgentState = {
  readonly agentMode: AgentMode;
  readonly deepConversations: readonly DeepConversationSummary[];
  readonly deepRuns: readonly DeepRunSummary[];
  readonly deep?: DeepRunView;
  readonly deepConversation?: DeepConversationView;
  readonly deepIntakeStatus?: DeepIntakeStatus;
  readonly deepPendingGoal?: string;
  readonly deepActiveRunId?: string;
  readonly deepSelectedRunId?: string;
  readonly deepBusy: boolean;
};
