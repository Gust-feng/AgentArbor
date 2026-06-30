import { postJson } from "./api";
import type { VisibleAiMode } from "./app-config-projection";
import type { taskSoilInputFromAttachments } from "./app-attachments";
import type { DeepIntakeResponse, StartDeepRunResponse } from "./contracts/deep";

export async function requestDeepIntake(input: {
  readonly conversationId?: string;
  readonly activeRunId?: string;
  readonly message: string;
  readonly aiMode: VisibleAiMode;
  readonly workspaceDirectory?: string;
  readonly taskSoilInput?: ReturnType<typeof taskSoilInputFromAttachments>;
}): Promise<DeepIntakeResponse> {
  return postJson<DeepIntakeResponse>("/api/deep/intake", {
    conversationId: input.conversationId,
    activeRunId: input.activeRunId,
    message: input.message,
    aiMode: input.aiMode,
    workspaceDirectory: input.workspaceDirectory,
    taskSoilInput: input.taskSoilInput,
  });
}

export async function requestStartConfirmedDeepRun(input: {
  readonly conversationId: string;
  readonly parentRunId?: string;
  readonly intakeTurnId?: string;
  readonly confirmedObjective?: string;
  readonly confirmedPlan?: string;
  readonly aiMode: VisibleAiMode;
  readonly workspaceDirectory?: string;
}): Promise<StartDeepRunResponse> {
  return postJson<StartDeepRunResponse>(
    `/api/deep/conversations/${encodeURIComponent(input.conversationId)}/runs`,
    {
      parentRunId: input.parentRunId,
      intakeTurnId: input.intakeTurnId,
      confirmedObjective: input.confirmedObjective,
      confirmedPlan: input.confirmedPlan,
      aiMode: input.aiMode,
      workspaceDirectory: input.workspaceDirectory,
    },
  );
}
