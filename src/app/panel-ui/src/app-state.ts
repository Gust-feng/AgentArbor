import type {
  AppBootstrapState,
  AppConversationState,
  AppDeferredAgentState,
  AppRunObservationState,
} from "./app-state-domains";
export type {
  AppBootstrapState,
  AppConversationState,
  AppDeferredAgentState,
  AppRunObservationState,
} from "./app-state-domains";

export type AppState =
  & AppBootstrapState
  & AppConversationState
  & AppRunObservationState
  & AppDeferredAgentState;

export function createInitialAppState(): AppState {
  return {
    skills: [],
    subAgents: [],
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