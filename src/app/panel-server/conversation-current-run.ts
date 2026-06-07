import type { PanelConversationCurrentRunReadModel } from "../panel-conversation-contracts.js";
import {
  createBasicAgentRunViewReadModel,
  type BasicAgentRunViewRuntime,
} from "./basic-agent-run-view.js";

export async function createConversationCurrentRunReadModel(
  runtime: BasicAgentRunViewRuntime,
  runId: string
): Promise<PanelConversationCurrentRunReadModel | undefined> {
  return createBasicAgentRunViewReadModel(runtime, runId, 0);
}
