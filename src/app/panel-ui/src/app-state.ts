import type { LiveRunBuffer } from "../../panel-ui-live-run-buffer";
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
import type { SkillDefinition } from "./contracts/skills";
import type { ToolsResponse } from "./contracts/tools";

export type AppState = {
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly skills: readonly SkillDefinition[];
  readonly conversations: readonly ConversationSummary[];
  readonly conversation?: Conversation;
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

export function createInitialAppState(): AppState {
  return {
    skills: [],
    conversations: [],
    transcriptNodes: [],
    transcriptNodesByRunId: {},
    events: [],
    busy: false,
  };
}
