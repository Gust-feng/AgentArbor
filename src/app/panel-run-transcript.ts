import type { AgentRunTreeAttachment } from "./agent-run-tree-attachment.js";
import { createSafeAgentRunTreeView, type SafeAgentRunTreeView } from "./panel-agent-run-tree-view.js";
import { createPanelRunStreamEvents } from "./panel-run-stream-events.js";
import { deriveRunSteps } from "./panel-run-steps.js";
import { createPanelTranscriptModelCalls } from "./panel-transcript-model-calls.js";
import { createPanelTranscriptNodes } from "./panel-transcript-nodes.js";
import { createPanelWorkNotes } from "./panel-work-notes.js";
import type {
  CreatePanelRunTranscriptInput,
  PanelRunTranscript,
} from "./panel-run-transcript-contracts.js";

export function createPanelRunTranscript(input: CreatePanelRunTranscriptInput): PanelRunTranscript {
  const modelCalls = createPanelTranscriptModelCalls(input.eventEntries, input.summary);
  const streamEvents = input.streamEvents ?? createPanelRunStreamEvents({
    runId: input.runId,
    status: input.status,
    eventEntries: input.eventEntries,
    summary: input.summary,
    observation: input.observation,
    routeDecision: input.routeDecision,
    desktopMode: input.desktopMode,
    reasoningEffort: input.reasoningEffort,
    agentDefinitionRef: input.agentDefinitionRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    error: input.error,
  });
  const isOrdinaryDesktopAgentOnly =
    input.summary === undefined &&
    input.observation === undefined &&
    input.agentRunTree === undefined &&
    modelCalls.length > 0 &&
    modelCalls.every((call) =>
      call.outputContractId === "desktop.agent_response.v1" ||
      // Historical persisted runs used the desktop.chat contract/purpose for
      // ordinary desktop agent output. Treat it as replay compatibility only.
      call.outputContractId === "desktop.chat_response.v1" ||
      call.outputContractId === "desktop.intent_gate.v1" ||
      call.purpose === "desktop_agent" ||
      call.purpose === "desktop_chat" ||
      call.purpose === "desktop_intent_gate"
    );
  const workNotes = createPanelWorkNotes({
    ...input,
    modelCalls,
    agentRunTree: agentRunTreeViewOrUndefined(input.agentRunTree),
    ordinaryDesktopAgentOnly: isOrdinaryDesktopAgentOnly,
    agentDefinitionRef: input.agentDefinitionRef,
  });
  const steps = deriveRunSteps(streamEvents);
  return {
    runId: input.runId,
    status: input.status,
    updatedAt: input.updatedAt,
    events: streamEvents,
    transcriptNodes: createPanelTranscriptNodes(streamEvents),
    steps,
    workNotes,
    modelCalls,
  };
}

function agentRunTreeViewOrUndefined(tree: AgentRunTreeAttachment | undefined): SafeAgentRunTreeView | undefined {
  return tree === undefined ? undefined : createSafeAgentRunTreeView(tree);
}
