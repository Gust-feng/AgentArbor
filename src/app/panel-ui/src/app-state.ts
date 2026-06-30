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
import type {
  DeepConversationSummary,
  DeepConversationView,
  DeepIntakeStatus,
  DeepRunSummary,
  DeepRunView,
} from "./contracts/deep";
import type { SkillDefinition } from "./contracts/skills";
import type { ToolsResponse } from "./contracts/tools";
import type { AppUpdateInfo } from "./contracts/app-update";

export type AppState = {
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly appUpdate?: AppUpdateInfo;
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
  /** 最近多 Agent 会话摘要：包含尚未启动 run 的入口追问/计划确认会话。 */
  readonly deepConversations: readonly DeepConversationSummary[];
  /** 最近多 Agent 运行摘要，用于显式入口恢复与侧栏历史。 */
  readonly deepRuns: readonly DeepRunSummary[];
  /**
   * Deep 运行视图投影：后端 /api/deep/conversations/:id/runs/:runId/view 返回的
   * 安全投影（run + agentRunTree ref + report + eventSequence），供 deep 视图区渲染。
   * 仅在 agentMode === "deep" 且存在活跃 deep 运行时有值。
   */
  readonly deep?: DeepRunView;
  /** 当前多 Agent 对话。即使 intake 只追问或直接回答、没有创建 run，也会保留在这里。 */
  readonly deepConversation?: DeepConversationView;
  /** 最近一次入口理解状态，用于顶部轻状态与无 run transcript。 */
  readonly deepIntakeStatus?: DeepIntakeStatus;
  /**
   * 首轮 deep view 到达前的本地提交目标。它不是后端运行事实，只用于 pending 首屏保留用户刚提交的目标。
   */
  readonly deepPendingGoal?: string;
  /**
   * 已启动但首轮 view 可能尚未到达的多 Agent run id。它只用于 stop/correct 控制端点，
   * 不作为运行事实展示源；权威投影仍来自 deep view。
   */
  readonly deepActiveRunId?: string;
  /** 当前在多 Agent 工作区选中的 run。 */
  readonly deepSelectedRunId?: string;
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
    deepConversations: [],
    deepRuns: [],
    deepBusy: false,
  };
}
