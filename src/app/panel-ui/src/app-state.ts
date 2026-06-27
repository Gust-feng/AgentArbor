import type { LiveRunBuffer } from "../../panel-ui-live-run-buffer";
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
import type { DeepRunView } from "./contracts/deep";
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
  /**
   * 当前 agent 运行模式：普通 Agent 主循环（normal）或 Deep 地下认知运行时（deep）。
   * 与模型 provider 选择（VisibleAiMode）独立，由 Desktop Shell 入口控件显式切换（FR-001）。
   */
  readonly agentMode: AgentMode;
  /**
   * Deep 运行视图投影：后端 /api/deep/conversations/:id/runs/:runId/view 返回的
   * 安全投影（run + agentRunTree ref + report + eventSequence），供 deep 视图区渲染。
   * 仅在 agentMode === "deep" 且存在活跃 deep 运行时有值。
   */
  readonly deep?: DeepRunView;
  /**
   * Deep 异步状态：deep 会话创建 / 运行提交 / 视图轮询期间为 true，
   * 用于在模式入口控件和提交区显示运行中状态并锁定切换。
   */
  readonly deepBusy: boolean;
};

export function createInitialAppState(): AppState {
  return {
    skills: [],
    conversations: [],
    transcriptNodes: [],
    transcriptNodesByRunId: {},
    events: [],
    busy: false,
    agentMode: "normal",
    deepBusy: false,
  };
}
