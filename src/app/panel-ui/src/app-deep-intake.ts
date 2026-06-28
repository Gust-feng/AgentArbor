import { postJson } from "./api";
import type { VisibleAiMode } from "./app-config-projection";
import type { taskSoilInputFromAttachments } from "./app-attachments";
import type { DeepIntakeResponse } from "./contracts/deep";

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
