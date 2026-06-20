import type { Conversation } from "./contracts/conversation";
import type {
  BasicAgentRun,
  DesktopRunDetail,
  DesktopWorkView,
  PanelRunResultReadModel,
  RunCapabilityResolution,
  RunEvent,
} from "./contracts/run";
import {
  ordinaryWorkViewFromRunView,
  safeBasicRunView,
  safeConversation,
} from "./runtime";

export type ObservedRunReadModel = {
  readonly conversation?: Conversation;
  readonly runId: string;
  readonly run?: BasicAgentRun;
  readonly workView?: DesktopWorkView;
  readonly result?: PanelRunResultReadModel;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly detail?: DesktopRunDetail;
  readonly replay?: {
    readonly events: readonly RunEvent[];
    readonly cursor: {
      readonly lastSequence: number;
    };
  };
};

export async function loadObservedRunReadModel(input: {
  readonly runId: string;
  readonly conversationId?: string;
  readonly preferredConversation?: Conversation;
  readonly requireFreshRunView?: boolean;
}): Promise<ObservedRunReadModel> {
  const loaded = await loadConversationWithCurrentRun(input);
  const conversation = loaded.conversation;
  const canUseConversationRun = input.requireFreshRunView !== true || loaded.fromFreshFetch;
  const currentRun = canUseConversationRun && conversation?.currentRun?.run.runId === input.runId
    ? conversation.currentRun
    : undefined;
  if (currentRun !== undefined) {
    return {
      conversation,
      runId: input.runId,
      run: currentRun.run,
      workView: ordinaryWorkViewFromRunView(currentRun),
      result: currentRun.result,
      capabilityResolution: currentRun.capabilityResolution,
      detail: currentRun.detail,
      replay: currentRun.replay,
    };
  }

  const view = await safeBasicRunView(input.runId, 0);

  return {
    conversation,
    runId: input.runId,
    run: view?.run,
    workView: ordinaryWorkViewFromRunView(view),
    result: view?.result,
    capabilityResolution: view?.capabilityResolution,
    detail: view?.detail,
    replay: view?.replay,
  };
}

async function loadConversationWithCurrentRun(input: {
  readonly runId: string;
  readonly conversationId?: string;
  readonly preferredConversation?: Conversation;
  readonly requireFreshRunView?: boolean;
}): Promise<{
  readonly conversation?: Conversation;
  readonly fromFreshFetch: boolean;
}> {
  if (!input.requireFreshRunView && input.preferredConversation?.currentRun?.run.runId === input.runId) {
    return { conversation: input.preferredConversation, fromFreshFetch: false };
  }
  const conversationId = input.conversationId ?? input.preferredConversation?.conversationId;
  if (conversationId === undefined) {
    return { conversation: input.preferredConversation, fromFreshFetch: false };
  }
  const fresh = await safeConversation(conversationId);
  return fresh === undefined
    ? { conversation: input.preferredConversation, fromFreshFetch: false }
    : { conversation: fresh, fromFreshFetch: true };
}
