import type React from "react";
import { postJson } from "./api";
import { taskSoilInputFromAttachments } from "./app-attachments";
import type { VisibleAiMode } from "./app-config-projection";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";
import type {
  CreateDeepConversationResponse,
  StartDeepRunResponse,
} from "./contracts/deep";

/**
 * Deep 任务提交模块（T3-4c）。
 *
 * 与普通 Agent 提交（[`submitPanelTask`](./app-task-submission.ts)）并列，但走独立的
 * `/api/deep/*` 端点族：
 *   - 普通提交 → POST /api/conversations（单步创建+消息+run）；
 *   - deep 提交 → POST /api/deep/conversations（创建隔离 deep 会话）→
 *     POST /api/deep/conversations/:id/runs（启动后台 deep run，202 不阻塞）。
 *
 * 设计要点：
 *   - deep 会话与普通会话物理隔离（FR-002），不写入普通会话 store，不污染 transcript 缓存；
 *   - 后台 run 不阻塞 HTTP，提交成功后返回 { conversationId, runId }，供调用方启动
 *     /view 轮询（T3-4e）观察 run tree 投影与结论；
 *   - 严禁 mock fallback：模型未配置时后端以 409 拒绝，错误经 ApiError.message 写入 app.error。
 */

export type DeepTaskSubmissionOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setGoal: (goal: string) => void;
  readonly setScreen: (screen: "chat-empty" | "chat-active") => void;
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly attachments: readonly ContextAttachment[];
  readonly selectedWorkspaceDirectory?: string;
  readonly goal: string;
  readonly aiMode: VisibleAiMode;
  readonly mountedRef: React.MutableRefObject<boolean>;
};

/** 提交成功后返回的 deep 运行引用，供调用方启动 /view 轮询。 */
export type DeepSubmissionResult = {
  readonly conversationId: string;
  readonly runId: string;
};

/**
 * 提交 deep 任务：创建独立 deep 会话并启动后台 deep run。
 *
 * @param options  提交选项（app 状态、输入、aiMode 等）。
 * @param explicitGoal  可选显式 goal，覆盖 options.goal（用于消息队列转发等场景）。
 * @returns 成功时返回运行引用；goal 为空 / 已 busy / 组件卸载 / 提交失败时返回 undefined。
 */
export async function submitDeepTask(
  options: DeepTaskSubmissionOptions,
  explicitGoal?: string,
): Promise<DeepSubmissionResult | undefined> {
  const trimmed = (explicitGoal ?? options.goal).trim();
  if (trimmed.length === 0 || options.app.deepBusy) return undefined;

  // 提交前清空输入，避免重复提交；切换到 active 屏以承接 deep 视图区（T3-4d）。
  options.setGoal("");
  options.setAttachments([]);
  options.setScreen("chat-active");
  options.setApp((previous) => ({
    ...previous,
    deepBusy: true,
    deepPendingGoal: trimmed,
    deepActiveRunId: undefined,
    deepSelectedRunId: undefined,
    deep: undefined,
    error: undefined,
  }));

  try {
    // 步骤 1：创建隔离 deep 会话（后端复用 task-soil-workspace 授权校验，拒绝未授权引用）。
    const createResponse = await postJson<CreateDeepConversationResponse>(
      "/api/deep/conversations",
      {
        goal: trimmed,
        aiMode: options.aiMode,
        workspaceDirectory: options.selectedWorkspaceDirectory,
        taskSoilInput: taskSoilInputFromAttachments(options.attachments),
      },
    );
    const conversationId = createResponse.conversation.conversationId;

    // 步骤 2：启动后台 deep run（202 不阻塞；run 完成后 record 写入 store 供 /view 轮询）。
    const startResponse = await postJson<StartDeepRunResponse>(
      `/api/deep/conversations/${encodeURIComponent(conversationId)}/runs`,
      { aiMode: options.aiMode, workspaceDirectory: options.selectedWorkspaceDirectory },
    );

    if (!options.mountedRef.current) return undefined;
    // deepBusy 保持 true：run 已在后台执行，由 T3-4e /view 轮询在终态时置 false。
    options.setApp((previous) => ({
      ...previous,
      deepBusy: true,
      deepPendingGoal: trimmed,
      deepActiveRunId: startResponse.run.runId,
      deepSelectedRunId: startResponse.run.runId,
      error: undefined,
    }));
    return {
      conversationId: startResponse.run.conversationId,
      runId: startResponse.run.runId,
    };
  } catch (error) {
    if (options.mountedRef.current) {
      options.setApp((previous) => ({
        ...previous,
        deepBusy: false,
        deepPendingGoal: undefined,
        deepActiveRunId: undefined,
        deepSelectedRunId: undefined,
        error: deepSubmissionErrorMessage(error),
      }));
    }
    return undefined;
  }
}

function deepSubmissionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Agent 集群任务提交失败。";
}
