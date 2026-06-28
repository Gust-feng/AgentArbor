import { postJson } from "./api";
import type {
  DeepChildConfirmationResponse,
  DeepChildOperationResponse,
  DeepRunControlResponse,
  DeepRunFollowUpResponse,
  DeepRunResynthesisResponse,
} from "./contracts/deep";
import type { VisibleAiMode } from "./app-config-projection";
import type { taskSoilInputFromAttachments } from "./app-attachments";

/**
 * 向仍在运行中的多 Agent run 注入补充上下文。
 *
 * 这里只封装显式 deep 控制端点，不改变默认普通 agent 主线。
 */
export async function requestDeepRunCorrection(
  runId: string,
  correctionContext: readonly string[],
): Promise<DeepRunControlResponse> {
  return postJson<DeepRunControlResponse>(
    `/api/deep/runs/${encodeURIComponent(runId)}/correct`,
    {
      correctionContext,
      reason: "用户补充上下文",
    },
  );
}

export async function requestDeepRunStop(runId: string): Promise<DeepRunControlResponse> {
  return postJson<DeepRunControlResponse>(
    `/api/deep/runs/${encodeURIComponent(runId)}/stop`,
    {
      reason: "用户停止多 Agent 运行",
    },
  );
}

export async function requestDeepRunInterrupt(runId: string): Promise<DeepRunControlResponse> {
  return postJson<DeepRunControlResponse>(
    `/api/deep/runs/${encodeURIComponent(runId)}/interrupt`,
    {
      reason: "用户打断多 Agent 运行",
    },
  );
}

export async function requestDeepRunFollowUp(
  runId: string,
  message: string,
  aiMode: VisibleAiMode,
  taskSoilInput?: ReturnType<typeof taskSoilInputFromAttachments>,
): Promise<DeepRunFollowUpResponse> {
  return postJson<DeepRunFollowUpResponse>(
    `/api/deep/runs/${encodeURIComponent(runId)}/follow-up`,
    {
      message,
      aiMode,
      taskSoilInput,
    },
  );
}

export async function requestDeepRunResynthesis(runId: string): Promise<DeepRunResynthesisResponse> {
  return postJson<DeepRunResynthesisResponse>(
    `/api/deep/runs/${encodeURIComponent(runId)}/resynthesize`,
    {},
  );
}

export async function requestDeepChildMessage(
  runId: string,
  childRunId: string,
  message: string,
): Promise<DeepChildOperationResponse> {
  return postJson<DeepChildOperationResponse>(
    `/api/deep/runs/${encodeURIComponent(runId)}/children/${encodeURIComponent(childRunId)}/messages`,
    { message },
  );
}

export async function decideDeepChildConfirmation(
  runId: string,
  childRunId: string,
  confirmationId: string,
  decision: "approve_once" | "deny" | "guidance",
  guidance?: string,
): Promise<DeepChildConfirmationResponse> {
  return postJson<DeepChildConfirmationResponse>(
    `/api/deep/runs/${encodeURIComponent(runId)}/children/${encodeURIComponent(childRunId)}/confirmations/${encodeURIComponent(confirmationId)}/decision`,
    { decision, guidance },
  );
}
