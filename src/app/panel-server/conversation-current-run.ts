import type { PanelConversationCurrentRunReadModel } from "../panel-conversation/panel-conversation-contracts.js";
import {
  createBasicAgentRunViewReadModel,
  type BasicAgentRunViewRuntime,
} from "./basic-agent-run-view.js";

export async function createConversationCurrentRunReadModel(
  runtime: BasicAgentRunViewRuntime,
  runId: string
): Promise<PanelConversationCurrentRunReadModel | undefined> {
  const view = await createBasicAgentRunViewReadModel(runtime, runId, 0);
  if (view === undefined) {
    return undefined;
  }
  return view;
}
