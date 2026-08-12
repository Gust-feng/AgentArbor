import { randomUUID } from "node:crypto";

import type { OrdinaryAgentFeature, OrdinaryConversationReadModel, OrdinaryRunState } from "../ordinary-agent/index.js";
import type { SpaceFeature } from "../spaces/index.js";
import {
  REMOTE_CONVERSATION_PAGE_MAX_JSON_BYTES,
  RemoteCommandConflict,
  type RemoteCommandHandlerPorts,
  type RemoteEvent,
} from "../remote-collaboration/index.js";
import type { OrdinaryRunBirth } from "../ordinary-agent/contracts.js";
import { resolveConversationSpaceAccess } from "./space-agent-access.js";

type ConversationIndex = Extract<RemoteEvent, { readonly kind: "conversation.index" }>;
type ConversationPage = Extract<RemoteEvent, { readonly kind: "conversation.page" }>;
type RunSnapshot = Extract<RemoteEvent, { readonly kind: "run.snapshot" }>;

export function createPanelRemoteCollaborationPorts(input: {
  readonly ordinary: OrdinaryAgentFeature;
  readonly spaces: SpaceFeature;
  readonly modelOptions: () => Promise<ConversationIndex["modelOptions"]>;
  readonly resolveModelSelection: (selectionId: string) => Promise<{ readonly profileId: string; readonly model: string } | undefined>;
  readonly synchronizeContentVault?: () => Promise<void>;
  readonly prepareOrdinaryRunBirth: (input: {
    readonly goal: string;
    readonly taskSoilInput?: import("../task-soil/task-soil-workspace.js").DesktopTaskSoilInput;
    readonly modelOverride?: import("./request-parsers.js").PanelRunInput["modelOverride"];
  }) => Promise<OrdinaryRunBirth>;
  readonly now?: () => string;
  readonly idFactory?: () => string;
}): RemoteCommandHandlerPorts {
  const now = input.now ?? (() => new Date().toISOString());
  const idFactory = input.idFactory ?? randomUUID;

  async function conversationIndex(): Promise<ConversationIndex> {
    const conversations = await input.ordinary.queries.listConversations(5_000);
    return {
      kind: "conversation.index",
      eventId: idFactory(),
      modelOptions: await input.modelOptions(),
      conversations: await Promise.all(conversations.map(async (conversation) => {
        const activeRun = conversation.activeRunId === undefined
          ? undefined
          : await input.ordinary.queries.getRun(conversation.activeRunId);
        const latestTurn = conversation.turns.at(-1);
        const owner = await input.spaces.queries.findConversationOwner(conversation.conversationId);
        return {
          conversationId: conversation.conversationId,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
          status: activeRun?.status.kind ?? (latestTurn?.status === "pending" ? "queued" : latestTurn?.status) ?? "idle",
          ...(conversation.activeRunId === undefined ? {} : { activeRunId: conversation.activeRunId }),
          ...(owner === undefined ? {} : { spaceId: owner.spaceId }),
        };
      })),
    };
  }

  async function conversationPage(page: {
    readonly conversationId: string;
    readonly beforeTurnId?: string;
    readonly limit: number;
  }): Promise<ConversationPage> {
    const conversation = await input.ordinary.queries.getConversation(page.conversationId);
    if (conversation === undefined) throw new Error(`Conversation ${page.conversationId} was not found`);
    return projectConversationPage(conversation, page, idFactory());
  }

  async function runSnapshot(runId: string): Promise<RunSnapshot> {
    const run = await input.ordinary.queries.getRun(runId);
    if (run === undefined) throw new Error(`Run ${runId} was not found`);
    return projectRun(run, idFactory());
  }

  return {
    ordinary: {
      async submit(command) {
        if (command.conversationId === undefined && command.spaceId === undefined) {
          throw new RemoteCommandConflict("conversation_owner_required", "A new conversation must belong to a Space");
        }
        let taskSoilInput;
        if (command.conversationId !== undefined) {
          const access = await resolveConversationSpaceAccess(input.spaces, command.conversationId, undefined);
          if (command.spaceId !== undefined && access.spaceId !== undefined && access.spaceId !== command.spaceId) {
            throw new RemoteCommandConflict("conversation_space_conflict", "The conversation belongs to another Space");
          }
          taskSoilInput = access.taskSoilInput;
        } else if (command.spaceId !== undefined) {
          let space = await input.spaces.queries.getTree(command.spaceId);
          if (space === undefined && input.synchronizeContentVault !== undefined) {
            await input.synchronizeContentVault();
            space = await input.spaces.queries.getTree(command.spaceId);
          }
          if (space === undefined) {
            throw new RemoteCommandConflict("space_not_found", "The selected Space no longer exists");
          }
        }
        const submitted = await input.ordinary.commands.submitTurn({
          submissionId: command.submissionId,
          ...(command.conversationId === undefined ? {} : { conversationId: command.conversationId }),
          input: { userMessage: command.message, ...(taskSoilInput === undefined ? {} : { taskSoil: taskSoilInput }) },
          birth: await input.prepareOrdinaryRunBirth({
            goal: command.message,
            ...(taskSoilInput === undefined ? {} : { taskSoilInput }),
            ...(command.modelSelectionId === undefined ? {} : { modelOverride: await resolveRemoteModelSelectionForRun(input.resolveModelSelection, command.modelSelectionId) }),
          }),
        });
        if (command.spaceId !== undefined && command.conversationId === undefined) {
          const owner = await input.spaces.queries.findConversationOwner(submitted.conversation.conversationId);
          if (owner === undefined) {
            await input.spaces.commands.linkConversationOwner({
              id: `remote-conversation:${command.submissionId}`,
              spaceId: command.spaceId,
              title: submitted.conversation.title,
              conversationId: submitted.conversation.conversationId,
              conversationTitle: submitted.conversation.title,
            });
          } else if (owner.spaceId !== command.spaceId) {
            throw new RemoteCommandConflict("conversation_space_conflict", "The new conversation was linked to another Space");
          }
        }
        return { conversationId: submitted.conversation.conversationId, runId: submitted.run.runId };
      },
      async cancel(runId) {
        await input.ordinary.commands.cancel(runId, "cancelled_by_user");
      },
      async decide(decision) {
        const run = await input.ordinary.queries.getRun(decision.runId);
        if (run === undefined) throw new Error(`Run ${decision.runId} was not found`);
        const alreadyApplied = run.timeline.some((event) =>
          event.type === "run.approval_decided"
          && event.decision.confirmationId === decision.confirmationId
          && event.decision.decision === decision.decision
          && event.decision.guidance === decision.guidance);
        if (alreadyApplied) return;
        await input.ordinary.commands.decideApproval({
          ownerRunId: decision.runId,
          confirmationId: decision.confirmationId,
          decision: decision.decision,
          ...(decision.guidance === undefined ? {} : { guidance: decision.guidance }),
          decidedAt: now(),
        });
      },
      conversationIndex,
      conversationPage,
      runSnapshot,
      subscribe(runId, listener) {
        return input.ordinary.events.subscribe(runId, (activity) => {
          if (activity.type === "model.output.delta") {
            listener({ kind: "text_delta", sequence: activity.sequence, delta: activity.delta });
            return;
          }
          listener({ kind: "state_changed", sequence: activity.sequence });
        });
      },
    },
  };
}

export async function resolveRemoteModelSelectionForRun(
  resolve: (selectionId: string) => Promise<{ readonly profileId: string; readonly model: string } | undefined>,
  value: string,
): Promise<{ readonly profileId: string; readonly model: string }> {
  const resolved = await resolve(value);
  if (resolved !== undefined) return resolved;
  parseRemoteModelSelection(value);
  throw new RemoteCommandConflict("model_selection_stale", "The selected model is no longer available");
}

function parseRemoteModelSelection(value: string): { readonly profileId: string; readonly model: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
      throw new RemoteCommandConflict("model_selection_invalid", "The selected model is invalid");
    }
    if (parsed[0].trim().length === 0 || parsed[1].trim().length === 0) throw new Error();
    return { profileId: parsed[0], model: parsed[1] };
  } catch (error) {
    if (error instanceof RemoteCommandConflict) throw error;
    throw new RemoteCommandConflict("model_selection_invalid", "The selected model is invalid");
  }
}

function projectConversationPage(
  conversation: OrdinaryConversationReadModel,
  page: { readonly beforeTurnId?: string; readonly limit: number },
  eventId: string,
): ConversationPage {
  const requestedEnd = page.beforeTurnId === undefined
    ? conversation.turns.length
    : conversation.turns.findIndex((turn) => turn.turnId === page.beforeTurnId);
  if (requestedEnd < 0) throw new RemoteCommandConflict("conversation_cursor_invalid", "The conversation page cursor is no longer available");
  const requestedStart = Math.max(0, requestedEnd - page.limit);
  let start = requestedEnd;
  let turnsBytes = 0;
  const turnByteBudget = REMOTE_CONVERSATION_PAGE_MAX_JSON_BYTES - 4_096;
  while (start > requestedStart) {
    const next = conversation.turns[start - 1]!;
    const nextBytes = new TextEncoder().encode(JSON.stringify(projectConversationTurn(next))).byteLength + 1;
    if (start < requestedEnd && turnsBytes + nextBytes > turnByteBudget) break;
    turnsBytes += nextBytes;
    start -= 1;
  }
  const turns = conversation.turns.slice(start, requestedEnd);
  return {
    kind: "conversation.page",
    eventId,
    conversationId: conversation.conversationId,
    ...(page.beforeTurnId === undefined ? {} : { beforeTurnId: page.beforeTurnId }),
    turns: turns.map(projectConversationTurn),
    hasMore: start > 0,
    ...(start > 0 && turns[0] !== undefined ? { nextBeforeTurnId: turns[0].turnId } : {}),
  };
}

function projectConversationTurn(turn: OrdinaryConversationReadModel["turns"][number]): ConversationPage["turns"][number] {
  return {
    turnId: turn.turnId,
    runId: turn.runId,
    role: turn.role,
    content: turn.content,
    status: turn.status,
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
  };
}

function projectRun(run: OrdinaryRunState, eventId: string): RunSnapshot {
  return {
    kind: "run.snapshot",
    eventId,
    runId: run.runId,
    conversationId: run.turn.conversationId,
    status: run.status.kind,
    ...(run.visibleAssistantText === undefined ? {} : { visibleAssistantText: run.visibleAssistantText }),
    pendingConfirmations: run.status.kind !== "awaiting_approval" ? [] : run.status.confirmationRequests.map((request) => ({
      confirmationId: request.confirmationId,
      title: request.title,
      actionSummary: request.actionSummary,
      ...(request.consequence === undefined ? {} : { consequence: request.consequence }),
      affectedResources: [...request.affectedResources],
      riskLevel: request.riskLevel,
      ...(request.resumeAvailability === undefined ? {} : { resumeAvailability: request.resumeAvailability }),
      requestedAt: request.requestedAt,
      ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    })),
    updatedAt: run.timestamps.updatedAt,
  };
}
