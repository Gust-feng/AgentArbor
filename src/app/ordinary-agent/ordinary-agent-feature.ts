import type { ConfirmationDecision } from "../../domain/confirmation/index.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import {
  toolCallFactId,
  type ToolCallProgress,
  type ToolCallRequest,
  type ToolCallResult,
} from "../../domain/tools/index.js";
import { createId, nowIso, type IdFactory } from "../../kernel/id.js";
import type {
  DecideOrdinaryApprovalInput,
  OrdinaryAgentFeature,
  OrdinaryConversationControlDocument,
  OrdinaryConversationControlRepository,
  OrdinaryConversationControlState,
  OrdinaryConversationReadModel,
  OrdinaryExecutionContinuation,
  OrdinaryExecutionOutcome,
  OrdinaryExecutionPort,
  OrdinaryRunActivity,
  OrdinaryRunActivityCursor,
  OrdinaryRunActivityReplay,
  OrdinaryRunEvent,
  OrdinaryRunRepository,
  OrdinaryRunSnapshotDocument,
  OrdinaryRunState,
  StartOrdinaryRunInput,
  SubmitOrdinaryTurnInput,
  SubmitOrdinaryTurnResult,
} from "./contracts.js";
import { OrdinaryFeatureError } from "./contracts.js";
import { executionErrorFacts } from "../execution-errors/index.js";
import {
  normalizeOrdinaryConversationTitle,
  projectOrdinaryConversation,
  visibleOrdinaryConversationRuns,
} from "./conversation-projection.js";
import {
  acceptOrdinaryToolRound,
  createInitialOrdinaryRunState,
  interruptedOrdinaryApprovalResult,
  ordinaryToolResultKey,
  recordOrdinaryToolResult,
  reconcileInterruptedOrdinaryToolRound,
  transitionOrdinaryRun,
  type OrdinaryRunTransition,
} from "./state.js";

export function createOrdinaryAgentFeature(input: {
  readonly repository: OrdinaryRunRepository;
  readonly conversationRepository: OrdinaryConversationControlRepository;
  readonly execution: OrdinaryExecutionPort;
  readonly releaseToolEvidenceOwner?: (ownerId: string) => void | Promise<void>;
  readonly now?: () => string;
  readonly idFactory?: IdFactory;
}): OrdinaryAgentFeature {
  const now = input.now ?? nowIso;
  const idFactory = input.idFactory ?? createId;
  const documents = new Map<string, OrdinaryRunSnapshotDocument>();
  const conversationDocuments = new Map<string, OrdinaryConversationControlDocument>();
  const continuations = new Map<string, OrdinaryExecutionContinuation>();
  const approvalReservations = new Map<string, string>();
  const controllers = new Map<string, AbortController>();
  const executions = new Map<string, Promise<void>>();
  const acceptedToolResults = new Map<string, Map<string, ToolCallResult>>();
  const postExecutionTasks = new Set<Promise<void>>();
  const mutationQueues = new Map<string, Promise<void>>();
  const activityStreams = new Map<string, { streamId: string; nextSequence: number; activities: OrdinaryRunActivity[] }>();
  const listeners = new Map<string, Set<(activity: OrdinaryRunActivity) => void>>();
  let released = false;

  const readyPromise = recoverPersistedRuns();
  // Observe eager recovery immediately; public calls still await the original rejected promise.
  void readyPromise.catch(() => undefined);

  async function recoverPersistedRuns(): Promise<void> {
    for (const summary of await input.conversationRepository.list(Number.MAX_SAFE_INTEGER)) {
      const document = await input.conversationRepository.get(summary.conversationId);
      if (document !== undefined) conversationDocuments.set(summary.conversationId, document);
    }
    for (const summary of await input.repository.list(Number.MAX_SAFE_INTEGER)) {
      let document = await input.repository.get(summary.runId);
      if (document === undefined) continue;
      documents.set(summary.runId, document);
      streamFor(
        summary.runId,
        document.state.timeline,
        document.state.toolCalls,
        document.state.toolResultRecordedAt,
      );
      if (document.state.status.kind === "awaiting_approval") {
        await blockLostApproval(summary.runId, {
          code: "confirmation_continuation_lost",
          message: "The live confirmation continuation was lost when the process restarted.",
        });
        continue;
      }
      if (document.state.pendingToolRound !== undefined) {
        await reconcilePendingToolRound(summary.runId);
        document = await load(summary.runId);
        if (document === undefined) continue;
      }
      if (document.state.toolCalls.some((result) => result.status === "approval_required")) {
        await reconcileLostApprovalResults(summary.runId);
        document = await load(summary.runId);
        if (document === undefined) continue;
      }
      if (document.state.status.kind === "running") {
        const unknownToolOutcome = document.state.toolCalls.some((result) =>
          result.errorFacts?.code === "tool_execution_outcome_unknown");
        await mutate(summary.runId, {
          type: "block",
          reason: {
            code: unknownToolOutcome ? "tool_execution_outcome_unknown" : "execution_continuation_lost",
            message: unknownToolOutcome
              ? "The process restarted before at least one tool outcome could be determined. The call was not replayed."
              : "The live execution was interrupted when the process restarted.",
          },
          continueBy: "new_turn",
        });
      }
    }
    for (const document of documents.values()) {
      if (document.state.status.kind !== "queued") continue;
      if (document.state.turn.predecessorRunId === undefined) {
        await activateRootQueued(document.state.runId);
        continue;
      }
      const predecessor = documents.get(document.state.turn.predecessorRunId);
      if (predecessor !== undefined && isTerminal(predecessor.state)) await activateSuccessor(predecessor.state.runId);
    }
  }

  async function loadConversationControl(conversationId: string): Promise<OrdinaryConversationControlDocument | undefined> {
    const cached = conversationDocuments.get(conversationId);
    if (cached !== undefined) return cached;
    const document = await input.conversationRepository.get(conversationId);
    if (document !== undefined) conversationDocuments.set(conversationId, document);
    return document;
  }

  async function load(runId: string): Promise<OrdinaryRunSnapshotDocument | undefined> {
    const cached = documents.get(runId);
    if (cached !== undefined) return cached;
    const document = await input.repository.get(runId);
    if (document !== undefined) {
      documents.set(runId, document);
      streamFor(runId, document.state.timeline, document.state.toolCalls, document.state.toolResultRecordedAt);
    }
    return document;
  }

  async function enqueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = mutationQueues.get(runId) ?? Promise.resolve();
    let resolveCurrent: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { resolveCurrent = resolve; });
    const tail = previous.then(() => current, () => current);
    mutationQueues.set(runId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      resolveCurrent();
      if (mutationQueues.get(runId) === tail) mutationQueues.delete(runId);
    }
  }

  async function mutate(
    runId: string,
    transition: OrdinaryRunTransition,
    options: { readonly keepTerminal?: boolean } = {},
  ): Promise<OrdinaryRunState> {
    return enqueue(runId, () => commitTransition(runId, transition, options));
  }

  async function commitTransition(
    runId: string,
    transition: OrdinaryRunTransition,
    options: { readonly keepTerminal?: boolean } = {},
  ): Promise<OrdinaryRunState> {
    const current = await load(runId);
    if (current === undefined) {
      throw new OrdinaryFeatureError("ordinary_run_not_found", `Ordinary run ${runId} was not found`);
    }
    if (options.keepTerminal === true && isTerminal(current.state)) return clone(current.state);
    const state = transitionOrdinaryRun({
      state: current.state,
      transition,
      recordedAt: now(),
      eventId: idFactory("ordinary-event"),
    });
    const saved = await input.repository.save(state, current.revision);
    documents.set(runId, saved);
    syncDurableToolResults(state);
    recordTransition(state.timeline.at(-1)!);
    return clone(state);
  }

  function emit(activity: OrdinaryRunActivity): void {
    for (const listener of listeners.get(activity.runId) ?? []) {
      try { listener(clone(activity)); }
      catch { /* A projection subscriber cannot roll back an already committed feature fact. */ }
    }
  }

  function streamFor(
    runId: string,
    durableEvents: readonly OrdinaryRunEvent[] = [],
    durableToolResults: readonly ToolCallResult[] = [],
    toolResultRecordedAt: Readonly<Record<string, string>> = {},
  ): {
    streamId: string;
    nextSequence: number;
    activities: OrdinaryRunActivity[];
  } {
    const existing = activityStreams.get(runId);
    if (existing !== undefined) return existing;
    const activities = durableActivities(runId, durableEvents, durableToolResults, toolResultRecordedAt);
    const created = { streamId: idFactory("ordinary-activity-stream"), nextSequence: activities.length + 1, activities };
    activityStreams.set(runId, created);
    return created;
  }

  function recordTransition(event: OrdinaryRunEvent): void {
    const stream = streamFor(event.runId);
    const durableCallIds = toolCallIds(event);
    stream.activities = stream.activities.map((activity) =>
      activity.type === "tool.result" && durableCallIds.includes(toolCallFactId(activity.result))
        ? { ...activity, durability: "durable" }
        : activity);
    const activity: OrdinaryRunActivity = {
      activityId: `transition:${event.eventId}`,
      runId: event.runId,
      sequence: stream.nextSequence++,
      recordedAt: event.recordedAt,
      type: "run.transition",
      durability: "durable",
      event: clone(event),
    };
    stream.activities.push(activity);
    emit(activity);
    if (isTerminalEvent(event)) {
      // Final state is durable. Drop potentially large live-only deltas after subscribers
      // observe the terminal boundary; replay remains truthful from durable transitions.
      stream.activities = stream.activities.filter((item) => item.durability === "durable");
    }
  }

  function recordOutputDelta(runId: string, delta: string): void {
    if (released || delta.length === 0) return;
    if (documents.get(runId)?.state.status.kind !== "running") return;
    const stream = streamFor(runId);
    const activity: OrdinaryRunActivity = {
      activityId: idFactory("ordinary-activity"),
      runId,
      sequence: stream.nextSequence++,
      recordedAt: now(),
      type: "model.output.delta",
      durability: "live_only",
      delta,
    };
    stream.activities.push(activity);
    emit(activity);
  }

  function recordModelRequest(runId: string, reason: "initial" | "after_tool" | "after_approval"): void {
    if (released) return;
    if (documents.get(runId)?.state.status.kind !== "running") return;
    const stream = streamFor(runId);
    const latest = stream.activities.at(-1);
    if (latest?.type === "model.request" && latest.reason === reason) return;
    const activity: OrdinaryRunActivity = {
      activityId: idFactory("ordinary-activity"),
      runId,
      sequence: stream.nextSequence++,
      recordedAt: now(),
      type: "model.request",
      durability: "live_only",
      reason,
    };
    stream.activities.push(activity);
    emit(activity);
  }

  function recordToolRequested(runId: string, request: ToolCallRequest): void {
    if (released || documents.get(runId)?.state.status.kind !== "running") return;
    const stream = streamFor(runId);
    const activityId = liveToolActivityId(request);
    if (stream.activities.some((activity) => activity.activityId === activityId)) return;
    if (hasTerminalToolFact(runId, request)) return;
    const activity: OrdinaryRunActivity = {
      activityId,
      runId,
      sequence: stream.nextSequence++,
      recordedAt: now(),
      type: "tool.requested",
      durability: "live_only",
      request: clone(request),
    };
    stream.activities.push(activity);
    emit(activity);
  }

  function recordToolProgress(runId: string, update: ToolCallProgress): void {
    if (released || documents.get(runId)?.state.status.kind !== "running") return;
    const stream = streamFor(runId);
    const activityId = liveToolActivityId(update);
    const existingIndex = stream.activities.findIndex((activity) => activity.activityId === activityId);
    const existing = stream.activities[existingIndex];
    if (existing === undefined || (existing.type !== "tool.requested" && existing.type !== "tool.progress")) return;
    if (existing.request.toolName !== update.toolName || hasTerminalToolFact(runId, update)) return;
    const activity: OrdinaryRunActivity = {
      activityId,
      runId,
      sequence: stream.nextSequence++,
      recordedAt: existing.recordedAt,
      type: "tool.progress",
      durability: "live_only",
      request: existing.request,
      progress: clone(update.progress),
    };
    stream.activities[existingIndex] = activity;
    emit(activity);
  }

  function hasTerminalToolFact(
    runId: string,
    identity: Pick<ToolCallRequest, "callId" | "factId">,
  ): boolean {
    const factId = toolCallFactId(identity);
    return documents.get(runId)?.state.toolCalls.some((result) =>
      toolCallFactId(result) === factId && result.status !== "approval_required") === true;
  }

  function rememberToolResults(runId: string, results: readonly ToolCallResult[]): void {
    const accepted = acceptedToolResults.get(runId) ?? new Map<string, ToolCallResult>();
    for (const result of results) {
      const factId = toolCallFactId(result);
      const existing = accepted.get(factId);
      if (existing !== undefined && existing.status !== "approval_required" &&
          JSON.stringify(existing) !== JSON.stringify(result)) {
        throw new OrdinaryFeatureError(
          "ordinary_tool_result_conflict",
          `Ordinary run ${runId} observed different results for tool fact ${factId}`,
        );
      }
      accepted.set(factId, clone(result));
    }
    if (accepted.size > 0) acceptedToolResults.set(runId, accepted);
  }

  function forgetPersistedToolResults(runId: string, results: readonly ToolCallResult[]): void {
    const accepted = acceptedToolResults.get(runId);
    const state = documents.get(runId)?.state;
    if (accepted === undefined || state === undefined) return;
    for (const result of results) {
      const factId = toolCallFactId(result);
      const persisted = state.toolCalls.find((item) => toolCallFactId(item) === factId);
      if (persisted !== undefined && JSON.stringify(persisted) === JSON.stringify(result)) {
        accepted.delete(factId);
      }
    }
    if (accepted.size === 0) acceptedToolResults.delete(runId);
  }

  async function persistToolRound(inputRound: {
    readonly runId: string;
    readonly canonicalMessagesBeforeRound: readonly ModelMessage[];
    readonly assistantMessage: ModelMessage;
  }): Promise<void> {
    const { runId } = inputRound;
    await enqueue(runId, async () => {
      const current = await load(runId);
      if (current === undefined) {
        throw new OrdinaryFeatureError("ordinary_run_not_found", `Ordinary run ${runId} was not found`);
      }
      const accepted = acceptOrdinaryToolRound({
        state: current.state,
        canonicalMessagesBeforeRound: inputRound.canonicalMessagesBeforeRound,
        assistantMessage: inputRound.assistantMessage,
        acceptedAt: now(),
      });
      if (accepted === current.state) return;
      const saved = await input.repository.save(accepted, current.revision);
      documents.set(runId, saved);
    });
  }

  async function persistToolResult(runId: string, result: ToolCallResult): Promise<void> {
    await enqueue(runId, async () => {
      const current = await load(runId);
      if (current === undefined) return;
      // Cancellation commits promptly, but an already executing tool may finish after
      // abort. Its observed result still belongs to this active execution lease.
      if (current.state.status.kind !== "running" && !controllers.has(runId)) return;
      const key = ordinaryToolResultKey(result);
      const factId = toolCallFactId(result);
      const existing = current.state.toolCalls.find((item) => toolCallFactId(item) === factId);
      if (existing !== undefined) {
        if (existing.status !== "approval_required") {
          if (ordinaryToolResultKey(existing) === key && JSON.stringify(existing) === JSON.stringify(result)) {
            const reconciled = recordOrdinaryToolResult({ state: current.state, result, recordedAt: current.state.timestamps.updatedAt });
            if (reconciled === current.state) return;
            const saved = await input.repository.save(reconciled, current.revision);
            documents.set(runId, saved);
            return;
          }
          throw new OrdinaryFeatureError(
            "ordinary_tool_result_conflict",
            `Ordinary run ${runId} already recorded a different result for tool fact ${factId}`,
          );
        }
      }
      const recordedAt = current.state.toolResultRecordedAt[key] ?? now();
      const state = recordOrdinaryToolResult({ state: current.state, result, recordedAt });
      if (state === current.state) return;
      const saved = await input.repository.save(state, current.revision);
      documents.set(runId, saved);
      if (result.status !== "approval_required") {
        recordDurableToolResult(runId, result, recordedAt);
      }
    });
  }

  async function reconcilePendingToolRound(runId: string): Promise<OrdinaryRunState | undefined> {
    return enqueue(runId, async () => {
      const current = await load(runId);
      if (current === undefined || current.state.pendingToolRound === undefined) {
        return current === undefined ? undefined : clone(current.state);
      }
      const reconciled = reconcileInterruptedOrdinaryToolRound({ state: current.state, recordedAt: now() });
      const saved = await input.repository.save(reconciled, current.revision);
      documents.set(runId, saved);
      syncDurableToolResults(reconciled);
      return clone(reconciled);
    });
  }

  async function reconcileLostApprovalResults(runId: string): Promise<OrdinaryRunState | undefined> {
    return enqueue(runId, async () => {
      const current = await load(runId);
      if (current === undefined) return undefined;
      const closed = closeLostApprovalFacts(current.state);
      if (closed.toolCalls.length === 0) return clone(current.state);
      const recordedAt = now();
      let state = current.state;
      for (const result of closed.toolCalls) {
        state = recordOrdinaryToolResult({ state, result, recordedAt });
      }
      state = {
        ...state,
        canonicalMessages: closed.canonicalMessages,
        timestamps: { ...state.timestamps, updatedAt: recordedAt },
      };
      const saved = await input.repository.save(state, current.revision);
      documents.set(runId, saved);
      syncDurableToolResults(state);
      return clone(state);
    });
  }

  async function blockLostApproval(
    runId: string,
    reason: { readonly code: string; readonly message: string },
  ): Promise<OrdinaryRunState> {
    return enqueue(runId, async () => {
      const current = await load(runId);
      if (current === undefined) {
        throw new OrdinaryFeatureError("ordinary_run_not_found", `Ordinary run ${runId} was not found`);
      }
      if (current.state.status.kind !== "awaiting_approval") {
        throw new OrdinaryFeatureError(
          "ordinary_run_state_conflict",
          `Ordinary run ${runId} is not awaiting approval`,
        );
      }
      const recordedAt = now();
      let state = reconcileInterruptedOrdinaryToolRound({ state: current.state, recordedAt });
      const closed = closeLostApprovalFacts(state);
      for (const result of closed.toolCalls) {
        state = recordOrdinaryToolResult({ state, result, recordedAt });
      }
      state = { ...state, canonicalMessages: closed.canonicalMessages };
      state = transitionOrdinaryRun({
        state,
        transition: {
          type: "block",
          reason,
          continueBy: "new_turn",
          canonicalMessages: state.canonicalMessages,
        },
        recordedAt,
        eventId: idFactory("ordinary-event"),
      });
      const saved = await input.repository.save(state, current.revision);
      documents.set(runId, saved);
      syncDurableToolResults(state);
      recordTransition(state.timeline.at(-1)!);
      return clone(state);
    });
  }

  function recordDurableToolResult(runId: string, result: ToolCallResult, recordedAt: string): void {
    const stream = streamFor(runId);
    const activityId = toolActivityId(result);
    const existingIndex = stream.activities.findIndex((activity) => activity.activityId === activityId);
    const existing = stream.activities[existingIndex];
    if (existing?.type === "tool.result" && existing.durability === "durable") return;
    if (existing?.type === "tool.result") {
      stream.activities[existingIndex] = { ...existing, durability: "durable" };
      return;
    }
    const activity: OrdinaryRunActivity = {
      activityId,
      runId,
      sequence: stream.nextSequence++,
      recordedAt,
      type: "tool.result",
      durability: "durable",
      result: clone(result),
    };
    stream.activities.push(activity);
    emit(activity);
  }

  function syncDurableToolResults(state: OrdinaryRunState): void {
    for (const result of state.toolCalls) {
      if (result.status === "approval_required") continue;
      const recordedAt = state.toolResultRecordedAt[ordinaryToolResultKey(result)];
      if (recordedAt !== undefined) recordDurableToolResult(state.runId, result, recordedAt);
    }
  }

  async function applyOutcome(runId: string, outcome: OrdinaryExecutionOutcome): Promise<void> {
    if (outcome.status === "approval_required") {
      let registered = false;
      try {
        registered = await enqueue(runId, async () => {
          const current = await load(runId);
          if (current === undefined || isTerminal(current.state)) return false;
          if (current.state.status.kind !== "running" || continuations.has(runId)) {
            throw new OrdinaryFeatureError(
              "ordinary_run_state_conflict",
              `Ordinary run ${runId} cannot register a second live approval continuation`,
            );
          }
          const state = await commitTransition(runId, {
            type: "request_approval",
            status: {
              kind: "awaiting_approval",
              confirmationRequests: outcome.confirmationRequests,
              continuationAvailability: "live_only",
            },
            canonicalMessages: outcome.canonicalMessages,
            toolCalls: outcome.toolCalls,
            usage: outcome.usage,
            capabilityResolution: outcome.capabilityResolution,
          });
          // The durable pause and its process-local handle are one admission fact.
          // Cancellation must either observe both inside this FIFO or win before both.
          if (state.status.kind !== "awaiting_approval") {
            throw new OrdinaryFeatureError(
              "ordinary_run_state_conflict",
              `Ordinary run ${runId} did not enter awaiting approval after accepting its continuation`,
            );
          }
          continuations.set(runId, outcome.continuation);
          return true;
        });
      } catch (error) {
        await outcome.continuation.release().catch(() => undefined);
        throw error;
      }
      if (!registered) await outcome.continuation.release().catch(() => undefined);
      return;
    }
    const document = await load(runId);
    if (document === undefined || isTerminal(document.state)) return;
    if (outcome.status === "completed") {
      await mutate(runId, { type: "complete", answer: outcome.answer, canonicalMessages: outcome.canonicalMessages, toolCalls: outcome.toolCalls, usage: outcome.usage, capabilityResolution: outcome.capabilityResolution });
      return;
    }
    if (outcome.status === "cancelled") {
      await mutate(runId, { type: "cancel", reason: outcome.reason, canonicalMessages: outcome.canonicalMessages, toolCalls: outcome.toolCalls, usage: outcome.usage, capabilityResolution: outcome.capabilityResolution });
      return;
    }
    await mutate(runId, { type: "fail", error: outcome.error, canonicalMessages: outcome.canonicalMessages, toolCalls: outcome.toolCalls, usage: outcome.usage, capabilityResolution: outcome.capabilityResolution });
  }

  async function runExecution(runId: string): Promise<void> {
    const document = await load(runId);
    if (document === undefined || document.state.status.kind !== "running") return;
    const controller = new AbortController();
    controllers.set(runId, controller);
    let outcome: OrdinaryExecutionOutcome | undefined;
    try {
      recordModelRequest(runId, "initial");
      outcome = await input.execution.execute({
        runId,
        birth: document.state.birth,
        runInput: document.state.input,
        messages: document.state.canonicalMessages,
        abortSignal: controller.signal,
        onTextDelta: (delta) => recordOutputDelta(runId, delta),
        onToolRequested: (request) => recordToolRequested(runId, request),
        onToolProgress: (progress) => recordToolProgress(runId, progress),
        onToolRound: ({ canonicalMessagesBeforeRound, assistantMessage }) => persistToolRound({
          runId,
          canonicalMessagesBeforeRound,
          assistantMessage,
        }),
        onToolResult: async (result) => {
          rememberToolResults(runId, [result]);
          await persistToolResult(runId, result);
          forgetPersistedToolResults(runId, [result]);
          if (result.status !== "approval_required") {
            recordModelRequest(runId, "after_tool");
          }
        },
      });
      rememberToolResults(runId, outcome.toolCalls);
      await applyOutcome(runId, outcome);
      forgetPersistedToolResults(runId, outcome.toolCalls);
    } catch (error) {
      const latest = await load(runId);
      if (latest !== undefined && !isTerminal(latest.state)) {
        await mutate(runId, {
          type: controller.signal.aborted ? "cancel" : "fail",
          ...(controller.signal.aborted
            ? { reason: cancellationReason(controller.signal.reason) }
            : { error: ordinaryExecutionFailureFacts(error) }),
          ...(outcome === undefined
            ? {}
            : {
                canonicalMessages: outcome.canonicalMessages,
                toolCalls: outcome.toolCalls,
                usage: outcome.usage,
                capabilityResolution: outcome.capabilityResolution,
              }),
        } as OrdinaryRunTransition, { keepTerminal: controller.signal.aborted });
      }
    } finally {
      try {
        await settleExecution(runId);
      } finally {
        if (controllers.get(runId) === controller) controllers.delete(runId);
      }
    }
  }

  async function settleExecution(runId: string): Promise<void> {
    for (const result of [...(acceptedToolResults.get(runId)?.values() ?? [])]) {
      await persistToolResult(runId, result);
      forgetPersistedToolResults(runId, [result]);
    }
    let current = await load(runId);
    if (current === undefined) return;
    if (current.state.status.kind === "awaiting_approval") {
      if (current.state.pendingToolRound === undefined) acceptedToolResults.delete(runId);
      return;
    }
    if (current.state.pendingToolRound !== undefined) {
      await reconcilePendingToolRound(runId);
      current = await load(runId) ?? current;
    }
    if (isTerminal(current.state) && current.state.toolCalls.some((result) => result.status === "approval_required")) {
      await reconcileLostApprovalResults(runId);
      current = await load(runId) ?? current;
    }
    if (current.state.pendingToolRound === undefined) acceptedToolResults.delete(runId);
  }

  function isSettledTerminal(state: OrdinaryRunState): boolean {
    return isTerminal(state) && state.pendingToolRound === undefined &&
      !controllers.has(state.runId) && !executions.has(state.runId) &&
      !approvalReservations.has(state.runId) && !continuations.has(state.runId) &&
      !acceptedToolResults.has(state.runId);
  }

  function track(runId: string, operation: Promise<void>): void {
    executions.set(runId, operation);
    const postExecution = operation.then(() => undefined, () => undefined).then(async () => {
      if (executions.get(runId) === operation) executions.delete(runId);
      await activateSuccessor(runId);
    });
    postExecutionTasks.add(postExecution);
    void postExecution.then(
      () => { postExecutionTasks.delete(postExecution); },
      () => { postExecutionTasks.delete(postExecution); },
    );
  }

  async function activateSuccessor(predecessorRunId: string): Promise<void> {
    if (released) return;
    const predecessor = await load(predecessorRunId);
    if (predecessor === undefined || !isSettledTerminal(predecessor.state)) return;
    const control = await loadConversationControl(predecessor.state.turn.conversationId);
    if (control?.state.deletedAt !== undefined) return;
    const candidate = nextEligibleQueuedRun(schedulingRuns(predecessor.state.turn.conversationId, control));
    if (candidate === undefined) return;
    const activated = await enqueue(candidate.runId, async () => {
      const current = await load(candidate.runId);
      if (current === undefined || current.state.status.kind !== "queued") return undefined;
      const latestControl = await loadConversationControl(current.state.turn.conversationId);
      if (latestControl?.state.deletedAt !== undefined) return undefined;
      const latestRuns = schedulingRuns(current.state.turn.conversationId, latestControl);
      const latestCandidate = nextEligibleQueuedRun(latestRuns);
      if (latestCandidate?.runId !== current.state.runId) return undefined;
      return commitTransition(current.state.runId, {
        type: "start",
        priorCanonicalMessages: canonicalMessagesBefore(latestRuns, current.state.runId),
      });
    });
    if (activated?.status.kind === "running") track(activated.runId, runExecution(activated.runId));
  }

  function schedulingRuns(
    conversationId: string,
    control: OrdinaryConversationControlDocument | undefined,
  ): readonly OrdinaryRunState[] {
    if (control !== undefined) return visibleRuns(control);
    return [...documents.values()]
      .map((document) => document.state)
      .filter((run) => run.turn.conversationId === conversationId)
      .sort((left, right) => left.turn.ordinal - right.turn.ordinal);
  }

  function nextEligibleQueuedRun(runs: readonly OrdinaryRunState[]): OrdinaryRunState | undefined {
    for (const run of runs) {
      if (run.status.kind === "queued") return run;
      if (!isSettledTerminal(run)) return undefined;
    }
    return undefined;
  }

  function canonicalMessagesBefore(
    runs: readonly OrdinaryRunState[],
    runId: string,
  ): OrdinaryRunState["canonicalMessages"] {
    const runIndex = runs.findIndex((run) => run.runId === runId);
    if (runIndex < 0) throw new Error(`Ordinary queued run ${runId} was not found in its visible lineage`);
    let messages: OrdinaryRunState["canonicalMessages"] = [];
    for (const run of runs.slice(0, runIndex)) {
      if (run.timeline.some((event) => event.type === "run.started")) {
        messages = run.canonicalMessages;
      } else {
        // A queued turn cancelled before execution has no model-authored history.
        messages = [...messages, { role: "user", content: run.input.userMessage }];
      }
    }
    return messages;
  }

  async function activateRootQueued(runId: string): Promise<void> {
    if (released) return;
    const activated = await enqueue(runId, async () => {
      const current = await load(runId);
      if (current === undefined || current.state.status.kind !== "queued" || current.state.turn.predecessorRunId !== undefined) {
        return undefined;
      }
      const control = await loadConversationControl(current.state.turn.conversationId);
      if (control?.state.deletedAt !== undefined) return undefined;
      return commitTransition(runId, { type: "start" });
    });
    if (activated?.status.kind === "running") track(activated.runId, runExecution(activated.runId));
  }

  async function startWithinConversation(startInput: StartOrdinaryRunInput): Promise<OrdinaryRunState> {
    assertLive();
    await readyPromise;
    const conversationControl = await loadConversationControl(startInput.turn.conversationId);
    if (conversationControl?.state.deletedAt !== undefined) {
      throw new OrdinaryFeatureError(
        "ordinary_conversation_deleted",
        `Ordinary conversation ${startInput.turn.conversationId} was deleted`,
      );
    }
    if (await load(startInput.runId) !== undefined) {
      throw new OrdinaryFeatureError("ordinary_run_conflict", `Ordinary run ${startInput.runId} already exists`);
    }
    const predecessor = startInput.turn.predecessorRunId === undefined
      ? undefined
      : await load(startInput.turn.predecessorRunId);
    if (startInput.turn.predecessorRunId !== undefined && predecessor === undefined) {
      throw new OrdinaryFeatureError(
        "ordinary_run_not_found",
        `Ordinary predecessor run ${startInput.turn.predecessorRunId} was not found`,
      );
    }
    if (predecessor !== undefined && predecessor.state.turn.conversationId !== startInput.turn.conversationId) {
      throw new OrdinaryFeatureError("ordinary_run_conflict", "Ordinary predecessor must belong to the same conversation");
    }
    if (startInput.turn.ordinal !== (predecessor?.state.turn.ordinal ?? 0) + 1) {
      throw new OrdinaryFeatureError("ordinary_run_conflict", "Ordinary run ordinal must immediately follow its predecessor");
    }
    if (predecessor !== undefined && [...documents.values()].some((document) =>
      document.state.status.kind === "queued" && document.state.turn.predecessorRunId === predecessor.state.runId)) {
      throw new OrdinaryFeatureError(
        "ordinary_run_conflict",
        `Ordinary predecessor run ${predecessor.state.runId} already has a queued successor`,
      );
    }
    const initial = createInitialOrdinaryRunState({
      runId: startInput.runId,
      turn: startInput.turn,
      runInput: startInput.input,
      birth: startInput.birth,
      priorCanonicalMessages: startInput.priorCanonicalMessages,
      recordedAt: now(),
      eventId: idFactory("ordinary-event"),
    });
    const created = await input.repository.save(initial, 0);
    documents.set(initial.runId, created);
    recordTransition(initial.timeline[0]);
    if (predecessor === undefined) {
      const running = await mutate(initial.runId, { type: "start" });
      track(initial.runId, runExecution(initial.runId));
      return running;
    }

    // The predecessor may have committed its terminal state while this run's
    // birth snapshot was being written. Re-read after the successor exists so
    // either this path or the predecessor's terminal callback must activate it.
    const latestPredecessor = await load(predecessor.state.runId);
    if (latestPredecessor !== undefined && isTerminal(latestPredecessor.state)) {
      await activateSuccessor(latestPredecessor.state.runId);
    }
    const current = await load(initial.runId);
    if (current === undefined) {
      throw new OrdinaryFeatureError("ordinary_run_not_found", `Ordinary run ${initial.runId} was not found after creation`);
    }
    return clone(current.state);
  }

  async function start(startInput: StartOrdinaryRunInput): Promise<OrdinaryRunState> {
    return enqueue(`conversation:${startInput.turn.conversationId}`, () => startWithinConversation(startInput));
  }

  async function submitTurn(submitInput: SubmitOrdinaryTurnInput): Promise<SubmitOrdinaryTurnResult> {
    assertLive();
    await readyPromise;
    const conversationId = submitInput.conversationId ?? idFactory("conversation");
    return enqueue(`conversation:${conversationId}`, async () => {
      let control = await loadConversationControl(conversationId);
      if (control === undefined) {
        if (submitInput.conversationId !== undefined) {
          throw new OrdinaryFeatureError(
            "ordinary_conversation_not_found",
            `Ordinary conversation ${conversationId} was not found`,
          );
        }
        const createdAt = now();
        const lineageId = idFactory("ordinary-lineage");
        const state: OrdinaryConversationControlState = {
          conversationId,
          createdAt,
          activeLineageId: lineageId,
          lineages: [{ lineageId, createdAt }],
        };
        control = await input.conversationRepository.save(state, 0, createdAt);
        conversationDocuments.set(conversationId, control);
      }
      assertConversationWritable(control);
      const runs = visibleRuns(control);
      const predecessor = runs.at(-1);
      const activeLineage = requireActiveLineage(control);
      const runId = idFactory("ordinary-run");
      const run = await startWithinConversation({
        runId,
        turn: {
          conversationId,
          lineageId: activeLineage.lineageId,
          ordinal: (predecessor?.turn.ordinal ?? 0) + 1,
          userTurnId: idFactory("ordinary-user-turn"),
          assistantTurnId: idFactory("ordinary-assistant-turn"),
          predecessorRunId: predecessor?.runId,
        },
        input: submitInput.input,
        birth: submitInput.birth,
        priorCanonicalMessages: predecessor?.canonicalMessages,
      });
      const conversation = conversationView(control);
      if (conversation === undefined) throw new Error(`Ordinary conversation ${conversationId} has no visible run after submission`);
      return { conversation, run };
    });
  }

  async function mutateConversation(
    conversationId: string,
    update: (state: OrdinaryConversationControlState, changedAt: string) => OrdinaryConversationControlState,
  ): Promise<OrdinaryConversationControlDocument> {
    assertLive();
    await readyPromise;
    return enqueue(`conversation:${conversationId}`, async () => {
      const current = await loadConversationControl(conversationId);
      if (current === undefined) {
        throw new OrdinaryFeatureError(
          "ordinary_conversation_not_found",
          `Ordinary conversation ${conversationId} was not found`,
        );
      }
      assertConversationWritable(current);
      const changedAt = now();
      const saved = await input.conversationRepository.save(update(clone(current.state), changedAt), current.revision, changedAt);
      conversationDocuments.set(conversationId, saved);
      return saved;
    });
  }

  async function renameConversation(conversationId: string, title: string): Promise<OrdinaryConversationReadModel> {
    const normalized = normalizeOrdinaryConversationTitle(title);
    const control = await mutateConversation(conversationId, (state, changedAt) => ({
      ...state, titleOverride: normalized, titleEditedAt: changedAt,
    }));
    return requireConversationView(control);
  }

  async function setConversationPinned(conversationId: string, pinned: boolean): Promise<OrdinaryConversationReadModel> {
    const control = await mutateConversation(conversationId, (state, changedAt) => ({
      ...state, pinnedAt: pinned ? state.pinnedAt ?? changedAt : undefined,
    }));
    return requireConversationView(control);
  }

  async function rollbackConversation(rollback: {
    readonly conversationId: string;
    readonly targetRunId?: string;
    readonly stepsBack?: number;
  }): Promise<OrdinaryConversationReadModel> {
    const control = await mutateConversation(rollback.conversationId, (state, changedAt) => {
      const current = conversationDocuments.get(rollback.conversationId)!;
      const runs = visibleRuns(current);
      if (runs.some((run) => !isTerminal(run))) {
        throw new OrdinaryFeatureError("ordinary_conversation_busy", "Cannot roll back a busy Ordinary conversation");
      }
      const completed = runs.filter((run) => run.status.kind === "completed");
      const target = rollback.targetRunId === undefined
        ? completed[Math.max(0, completed.length - Math.max(1, Math.floor(rollback.stepsBack ?? 1)) - 1)]
        : completed.find((run) => run.runId === rollback.targetRunId);
      if (target === undefined) {
        throw new OrdinaryFeatureError(
          "ordinary_rollback_target_not_found",
          "Ordinary rollback target was not found in completed visible runs",
        );
      }
      const lineageId = idFactory("ordinary-lineage");
      return {
        ...state,
        activeLineageId: lineageId,
        lineages: [...state.lineages, {
          lineageId,
          parentLineageId: state.activeLineageId,
          forkFromRunId: target.runId,
          createdAt: changedAt,
        }],
      };
    });
    return requireConversationView(control);
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    assertLive();
    await readyPromise;
    await enqueue(`conversation:${conversationId}`, async () => {
      const current = await loadConversationControl(conversationId);
      if (current === undefined) return;
      let tombstone = current;
      if (current.state.deletedAt === undefined) {
        const deletedAt = now();
        tombstone = await input.conversationRepository.save({ ...current.state, deletedAt }, current.revision, deletedAt);
        conversationDocuments.set(conversationId, tombstone);
      }
      const owned = [...documents.values()].filter((document) => document.state.turn.conversationId === conversationId);
      for (const document of owned) {
        if (!isTerminal(document.state)) await cancel(document.state.runId, "conversation_deleted");
        const execution = executions.get(document.state.runId);
        if (execution !== undefined) await execution.catch(() => undefined);
        await settleExecution(document.state.runId);
        await input.releaseToolEvidenceOwner?.(document.state.runId);
        await input.repository.delete(document.state.runId);
        documents.delete(document.state.runId);
        acceptedToolResults.delete(document.state.runId);
        activityStreams.delete(document.state.runId);
        listeners.delete(document.state.runId);
      }
    });
  }

  function visibleRuns(control: OrdinaryConversationControlDocument): readonly OrdinaryRunState[] {
    return visibleOrdinaryConversationRuns(control, [...documents.values()].map((document) => document.state));
  }

  function conversationView(control: OrdinaryConversationControlDocument): OrdinaryConversationReadModel | undefined {
    if (control.state.deletedAt !== undefined) return undefined;
    return projectOrdinaryConversation({ control, runs: visibleRuns(control) });
  }

  function requireConversationView(control: OrdinaryConversationControlDocument): OrdinaryConversationReadModel {
    const view = conversationView(control);
    if (view === undefined) throw new Error(`Ordinary conversation ${control.state.conversationId} has no visible turns`);
    return view;
  }

  async function cancel(runId: string, reason = "cancelled_by_user"): Promise<OrdinaryRunState> {
    assertLive();
    await readyPromise;
    const document = await load(runId);
    if (document === undefined) {
      throw new OrdinaryFeatureError("ordinary_run_not_found", `Ordinary run ${runId} was not found`);
    }
    if (isTerminal(document.state)) return clone(document.state);
    controllers.get(runId)?.abort(reason);
    const cancellation = await enqueue(runId, async () => {
      const current = await load(runId);
      if (current === undefined) {
        throw new OrdinaryFeatureError("ordinary_run_not_found", `Ordinary run ${runId} was not found`);
      }
      controllers.get(runId)?.abort(reason);
      const continuation = continuations.get(runId);
      continuations.delete(runId);
      if (isTerminal(current.state)) {
        return { state: clone(current.state), continuation, wasTerminal: true };
      }
      try {
        const state = await commitTransition(runId, { type: "cancel", reason }, { keepTerminal: true });
        return { state, continuation, wasTerminal: false };
      } catch (error) {
        if (continuation !== undefined) continuations.set(runId, continuation);
        throw error;
      }
    });
    if (cancellation.continuation !== undefined) {
      await cancellation.continuation.release().catch(() => undefined);
    }
    if (cancellation.wasTerminal) return cancellation.state;
    const stillHasLiveExecution = controllers.has(runId) || executions.has(runId) || approvalReservations.has(runId);
    if (!stillHasLiveExecution) await settleExecution(runId);
    await activateSuccessor(runId);
    const settled = await load(runId);
    return settled === undefined ? cancellation.state : clone(settled.state);
  }

  async function decideApproval(input: DecideOrdinaryApprovalInput): Promise<OrdinaryRunState> {
    assertLive();
    await readyPromise;
    const ownerRunId = input.ownerRunId;
    const decision: ConfirmationDecision = {
      confirmationId: input.confirmationId,
      decision: input.decision,
      decidedAt: input.decidedAt,
      ...(input.guidance === undefined ? {} : { guidance: input.guidance }),
    };
    const controller = new AbortController();
    let continuation: OrdinaryExecutionContinuation | undefined;
    const reserved = await enqueue(ownerRunId, async () => {
      if (approvalReservations.has(ownerRunId)) {
        throw new OrdinaryFeatureError(
          "ordinary_confirmation_in_progress",
          `A confirmation decision is already in progress for Ordinary run ${ownerRunId}`,
        );
      }
      const document = await load(ownerRunId);
      if (document === undefined) {
        throw new OrdinaryFeatureError("ordinary_run_not_found", `Ordinary run ${ownerRunId} was not found`);
      }
      if (document.state.status.kind !== "awaiting_approval") {
        throw new OrdinaryFeatureError(
          "ordinary_run_state_conflict",
          `Ordinary run ${ownerRunId} is not awaiting approval`,
        );
      }
      if (!document.state.status.confirmationRequests.some((request) => request.confirmationId === decision.confirmationId)) {
        throw new OrdinaryFeatureError(
          "ordinary_confirmation_not_found",
          `Confirmation ${decision.confirmationId} does not belong to Ordinary run ${ownerRunId}`,
        );
      }
      continuation = continuations.get(ownerRunId);
      if (continuation === undefined) {
        return clone(document.state);
      }
      approvalReservations.set(ownerRunId, decision.confirmationId);
      continuations.delete(ownerRunId);
      controllers.set(ownerRunId, controller);
      try {
        return await commitTransition(ownerRunId, { type: "approval_decided", decision });
      } catch (error) {
        approvalReservations.delete(ownerRunId);
        controllers.delete(ownerRunId);
        continuations.set(ownerRunId, continuation);
        throw error;
      }
    });
    if (continuation === undefined) {
      const blocked = await blockLostApproval(ownerRunId, {
          code: "confirmation_continuation_lost",
          message: "The live confirmation continuation is no longer available.",
      });
      await activateSuccessor(ownerRunId);
      return blocked;
    }
    const operation = (async () => {
      let outcome: OrdinaryExecutionOutcome | undefined;
      try {
        recordModelRequest(ownerRunId, "after_approval");
        outcome = await continuation!.decide({ decision, abortSignal: controller.signal });
        rememberToolResults(ownerRunId, outcome.toolCalls);
        await applyOutcome(ownerRunId, outcome);
        forgetPersistedToolResults(ownerRunId, outcome.toolCalls);
      } catch (error) {
        const latest = await load(ownerRunId);
        if (latest !== undefined && !isTerminal(latest.state)) {
          await mutate(ownerRunId, {
            type: controller.signal.aborted ? "cancel" : "fail",
            ...(controller.signal.aborted
              ? { reason: cancellationReason(controller.signal.reason) }
              : { error: ordinaryExecutionFailureFacts(error) }),
            ...(outcome === undefined
              ? {}
              : {
                  canonicalMessages: outcome.canonicalMessages,
                  toolCalls: outcome.toolCalls,
                  usage: outcome.usage,
                  capabilityResolution: outcome.capabilityResolution,
                }),
          } as OrdinaryRunTransition, { keepTerminal: controller.signal.aborted });
        }
      } finally {
        try {
          await settleExecution(ownerRunId);
        } finally {
          if (controllers.get(ownerRunId) === controller) controllers.delete(ownerRunId);
          if (approvalReservations.get(ownerRunId) === decision.confirmationId) {
            approvalReservations.delete(ownerRunId);
          }
        }
      }
    })();
    track(ownerRunId, operation);
    return reserved;
  }

  function closeLostApprovalFacts(state: OrdinaryRunState): {
    readonly canonicalMessages: readonly ModelMessage[];
    readonly toolCalls: readonly ToolCallResult[];
  } {
    const closedResults = state.toolCalls
      .filter((result) => result.status === "approval_required")
      .map((result): ToolCallResult => interruptedOrdinaryApprovalResult(
        state,
        result as ToolCallResult & { readonly status: "approval_required" },
      ));
    const existingToolMessages = new Set(state.canonicalMessages.flatMap((message) =>
      message.role === "tool" && message.toolCallId !== undefined ? [message.toolCallId] : []));
    const canonicalToolCalls = new Set(state.canonicalMessages.flatMap((message) =>
      message.role === "assistant" ? (message.toolCalls ?? []).map((call) => call.callId) : []));
    return {
      canonicalMessages: [
        ...state.canonicalMessages,
        ...closedResults.flatMap((result): readonly ModelMessage[] =>
          existingToolMessages.has(result.callId) || !canonicalToolCalls.has(result.callId)
          ? []
          : [{
              role: "tool",
              content: JSON.stringify(result),
              toolCallId: result.callId,
              toolName: result.toolName,
            }]),
      ],
      toolCalls: closedResults,
    };
  }

  function assertLive(): void {
    if (released) {
      throw new OrdinaryFeatureError("ordinary_feature_released", "Ordinary Agent is shutting down");
    }
  }

  return {
    commands: { start, submitTurn, renameConversation, setConversationPinned, rollbackConversation, deleteConversation, cancel, decideApproval },
    queries: {
      async getRun(runId) {
        await readyPromise;
        const document = await load(runId);
        return document === undefined ? undefined : clone(document.state);
      },
      async listRuns(limit) { await readyPromise; return input.repository.list(limit); },
      async getConversation(conversationId) {
        await readyPromise;
        const control = await loadConversationControl(conversationId);
        return control === undefined ? undefined : clone(conversationView(control));
      },
      async listConversations(limit = 50) {
        await readyPromise;
        const views = [...conversationDocuments.values()].flatMap((control) => {
          const view = conversationView(control);
          return view === undefined ? [] : [view];
        }).sort((left, right) => {
          const pinned = (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "");
          return pinned === 0 ? right.updatedAt.localeCompare(left.updatedAt) : pinned;
        });
        return clone(views.slice(0, Math.max(0, Math.floor(limit))));
      },
    },
    events: {
      async replay(runId, cursor) {
        await readyPromise;
        const document = await load(runId);
        if (document === undefined) return undefined;
        const stream = streamFor(
          runId,
          document.state.timeline,
          document.state.toolCalls,
          document.state.toolResultRecordedAt,
        );
        const reset = cursor !== undefined && (
          cursor.streamId !== stream.streamId || cursor.sequence < 0 || cursor.sequence >= stream.nextSequence
        );
        const afterSequence = cursor === undefined || reset ? 0 : cursor.sequence;
        return {
          cursor: activityCursor(stream),
          reset,
          activities: clone(stream.activities
            .filter((activity) => activity.sequence > afterSequence)
            .sort((left, right) => left.sequence - right.sequence)),
        };
      },
      subscribe(runId, listener) {
        assertLive();
        const runListeners = listeners.get(runId) ?? new Set();
        runListeners.add(listener);
        listeners.set(runId, runListeners);
        return () => {
          runListeners.delete(listener);
          if (runListeners.size === 0) listeners.delete(runId);
        };
      },
    },
    async release() {
      if (released) return;
      released = true;
      await readyPromise.catch(() => undefined);
      for (const controller of controllers.values()) controller.abort("ordinary_feature_released");
      await releaseContinuations();
      await Promise.allSettled(executions.values());
      await Promise.allSettled(postExecutionTasks);
      await Promise.allSettled(mutationQueues.values());
      // An abort-ignoring execution may have returned an approval while release awaited it.
      await releaseContinuations();
      listeners.clear();
      activityStreams.clear();
      approvalReservations.clear();
      acceptedToolResults.clear();
      documents.clear();
      conversationDocuments.clear();
    },
  };

  async function releaseContinuations(): Promise<void> {
    const pending = [...continuations.values()];
    continuations.clear();
    await Promise.allSettled(pending.map((continuation) => continuation.release()));
  }

  function activityCursor(stream: { readonly streamId: string; readonly nextSequence: number }): OrdinaryRunActivityCursor {
    return { streamId: stream.streamId, sequence: stream.nextSequence - 1 };
  }
}

function durableActivities(
  runId: string,
  events: readonly OrdinaryRunEvent[],
  toolResults: readonly ToolCallResult[],
  toolResultRecordedAt: Readonly<Record<string, string>>,
): OrdinaryRunActivity[] {
  const pending: Array<{
    readonly recordedAt: string;
    readonly priority: number;
    readonly insertion: number;
    readonly activity: OrdinaryRunActivity;
  }> = [];
  for (const [insertion, event] of events.entries()) {
    pending.push({
      recordedAt: event.recordedAt,
      priority: 1,
      insertion,
      activity: {
      activityId: `transition:${event.eventId}`,
      runId,
      sequence: 0,
      recordedAt: event.recordedAt,
      type: "run.transition",
      durability: "durable",
      event: clone(event),
      },
    });
  }
  for (const [insertion, result] of toolResults.entries()) {
    if (result.status === "approval_required") continue;
    const recordedAt = toolResultRecordedAt[ordinaryToolResultKey(result)];
    if (recordedAt === undefined) continue;
    pending.push({
      recordedAt,
      priority: 0,
      insertion,
      activity: {
        activityId: toolActivityId(result),
        runId,
        sequence: 0,
        recordedAt,
        type: "tool.result",
        durability: "durable",
        result: clone(result),
      },
    });
  }
  return pending
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) ||
      left.priority - right.priority || left.insertion - right.insertion)
    .map((item, index) => ({ ...item.activity, sequence: index + 1 }));
}

export function durableOrdinaryRunReplayFromState(run: OrdinaryRunState): OrdinaryRunActivityReplay {
  const activities = durableActivities(
    run.runId,
    run.timeline,
    run.toolCalls,
    run.toolResultRecordedAt,
  );
  const lastEventId = run.timeline.at(-1)?.eventId ?? "initial";
  return {
    cursor: {
      // Command responses are durable snapshots, not subscriptions to the live stream generation.
      streamId: `ordinary-command-response:${run.runId}:${lastEventId}`,
      sequence: activities.length,
    },
    reset: false,
    activities,
  };
}

function toolCallIds(event: OrdinaryRunEvent): readonly string[] {
  return "toolCallIds" in event ? event.toolCallIds : [];
}

function toolActivityId(result: ToolCallResult): string {
  return `tool:${ordinaryToolResultKey(result)}`;
}

function liveToolActivityId(identity: Pick<ToolCallRequest, "callId" | "factId">): string {
  return `tool-live:${toolCallFactId(identity)}`;
}

function isTerminal(state: OrdinaryRunState): boolean {
  return state.status.kind === "completed" || state.status.kind === "failed" ||
    state.status.kind === "cancelled" || state.status.kind === "blocked";
}
function isTerminalEvent(event: OrdinaryRunEvent): boolean {
  return event.type === "run.completed" || event.type === "run.failed" ||
    event.type === "run.cancelled" || event.type === "run.blocked";
}
function assertConversationWritable(document: OrdinaryConversationControlDocument): void {
  if (document.state.deletedAt !== undefined) {
    throw new OrdinaryFeatureError(
      "ordinary_conversation_deleted",
      `Ordinary conversation ${document.state.conversationId} was deleted`,
    );
  }
}
function requireActiveLineage(document: OrdinaryConversationControlDocument) {
  const lineage = document.state.lineages.find((item) => item.lineageId === document.state.activeLineageId);
  if (lineage === undefined) throw new Error(`Ordinary conversation ${document.state.conversationId} active lineage was not found`);
  return lineage;
}
function cancellationReason(value: unknown): string { return typeof value === "string" ? value : "cancelled"; }
function ordinaryExecutionFailureFacts(value: unknown): { readonly code: string; readonly message: string } {
  const explicit = executionErrorFacts(value);
  if (explicit !== undefined) return explicit;
  if (value instanceof OrdinaryFeatureError) return { code: value.code, message: value.message };
  return { code: "ordinary_execution_failed", message: errorMessage(value) };
}
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function clone<T>(value: T): T { return globalThis.structuredClone(value); }
