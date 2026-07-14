import type { ConfirmationDecision } from "../../domain/confirmation/index.js";
import { createId, nowIso, type IdFactory } from "../../kernel/id.js";
import type {
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
  OrdinaryRunEvent,
  OrdinaryRunRepository,
  OrdinaryRunSnapshotDocument,
  OrdinaryRunState,
  StartOrdinaryRunInput,
  SubmitOrdinaryTurnInput,
  SubmitOrdinaryTurnResult,
} from "./contracts.js";
import {
  normalizeOrdinaryConversationTitle,
  projectOrdinaryConversation,
  visibleOrdinaryConversationRuns,
} from "./conversation-projection.js";
import { createInitialOrdinaryRunState, transitionOrdinaryRun, type OrdinaryRunTransition } from "./state.js";

export function createOrdinaryAgentFeature(input: {
  readonly repository: OrdinaryRunRepository;
  readonly conversationRepository: OrdinaryConversationControlRepository;
  readonly execution: OrdinaryExecutionPort;
  readonly now?: () => string;
  readonly idFactory?: IdFactory;
}): OrdinaryAgentFeature {
  const now = input.now ?? nowIso;
  const idFactory = input.idFactory ?? createId;
  const documents = new Map<string, OrdinaryRunSnapshotDocument>();
  const conversationDocuments = new Map<string, OrdinaryConversationControlDocument>();
  const continuations = new Map<string, OrdinaryExecutionContinuation>();
  const controllers = new Map<string, AbortController>();
  const executions = new Map<string, Promise<void>>();
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
      const document = await input.repository.get(summary.runId);
      if (document === undefined) continue;
      documents.set(summary.runId, document);
      streamFor(summary.runId, document.state.timeline);
      if (document.state.status.kind === "awaiting_approval") {
        await mutate(summary.runId, {
          type: "block",
          reason: {
            code: "confirmation_continuation_lost",
            message: "The live confirmation continuation was lost when the process restarted.",
          },
          continueBy: "new_turn",
        });
      }
    }
    for (const document of documents.values()) {
      if (document.state.status.kind !== "queued" || document.state.turn.predecessorRunId === undefined) continue;
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
      streamFor(runId, document.state.timeline);
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
    return enqueue(runId, async () => {
      const current = await load(runId);
      if (current === undefined) throw new Error(`Ordinary run ${runId} was not found`);
      if (options.keepTerminal === true && isTerminal(current.state)) return clone(current.state);
      const state = transitionOrdinaryRun({
        state: current.state,
        transition,
        recordedAt: now(),
        eventId: idFactory("ordinary-event"),
      });
      const saved = await input.repository.save(state, current.revision);
      documents.set(runId, saved);
      recordTransition(state.timeline.at(-1)!);
      return clone(state);
    });
  }

  function emit(activity: OrdinaryRunActivity): void {
    for (const listener of listeners.get(activity.runId) ?? []) {
      try { listener(clone(activity)); }
      catch { /* A projection subscriber cannot roll back an already committed feature fact. */ }
    }
  }

  function streamFor(runId: string, durableEvents: readonly OrdinaryRunEvent[] = []): {
    streamId: string;
    nextSequence: number;
    activities: OrdinaryRunActivity[];
  } {
    const existing = activityStreams.get(runId);
    if (existing !== undefined) return existing;
    const activities = durableEvents.map((event, index): OrdinaryRunActivity => ({
      activityId: `transition:${event.eventId}`,
      runId,
      sequence: index + 1,
      recordedAt: event.recordedAt,
      type: "run.transition",
      durability: "durable",
      event: clone(event),
    }));
    const created = { streamId: idFactory("ordinary-activity-stream"), nextSequence: activities.length + 1, activities };
    activityStreams.set(runId, created);
    return created;
  }

  function recordTransition(event: OrdinaryRunEvent): void {
    const stream = streamFor(event.runId);
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

  async function applyOutcome(runId: string, outcome: OrdinaryExecutionOutcome): Promise<void> {
    const document = await load(runId);
    if (document === undefined || isTerminal(document.state)) return;
    if (outcome.status === "approval_required") {
      const state = await mutate(runId, {
        type: "request_approval",
        status: {
          kind: "awaiting_approval",
          confirmationRequests: outcome.confirmationRequests,
          continuationAvailability: "live_only",
        },
        canonicalMessages: outcome.canonicalMessages,
        toolCalls: outcome.toolCalls,
        usage: outcome.usage,
      });
      if (state.status.kind === "awaiting_approval") continuations.set(runId, outcome.continuation);
      return;
    }
    if (outcome.status === "completed") {
      await mutate(runId, { type: "complete", answer: outcome.answer, canonicalMessages: outcome.canonicalMessages, toolCalls: outcome.toolCalls, usage: outcome.usage });
      await activateSuccessor(runId);
      return;
    }
    if (outcome.status === "cancelled") {
      await mutate(runId, { type: "cancel", reason: outcome.reason, canonicalMessages: outcome.canonicalMessages, toolCalls: outcome.toolCalls, usage: outcome.usage });
      await activateSuccessor(runId);
      return;
    }
    await mutate(runId, { type: "fail", error: outcome.error, canonicalMessages: outcome.canonicalMessages, toolCalls: outcome.toolCalls, usage: outcome.usage });
    await activateSuccessor(runId);
  }

  async function runExecution(runId: string): Promise<void> {
    const document = await load(runId);
    if (document === undefined || document.state.status.kind !== "running") return;
    const controller = new AbortController();
    controllers.set(runId, controller);
    try {
      const outcome = await input.execution.execute({
        runId,
        birth: document.state.birth,
        runInput: document.state.input,
        messages: document.state.canonicalMessages,
        abortSignal: controller.signal,
        onTextDelta: (delta) => recordOutputDelta(runId, delta),
      });
      await applyOutcome(runId, outcome);
    } catch (error) {
      const latest = await load(runId);
      if (latest !== undefined && !isTerminal(latest.state)) {
        await mutate(runId, {
          type: controller.signal.aborted ? "cancel" : "fail",
          ...(controller.signal.aborted
            ? { reason: cancellationReason(controller.signal.reason) }
            : { error: { code: "ordinary_execution_failed", message: errorMessage(error) } }),
        } as OrdinaryRunTransition, { keepTerminal: controller.signal.aborted });
        await activateSuccessor(runId);
      }
    } finally {
      controllers.delete(runId);
    }
  }

  function track(runId: string, operation: Promise<void>): void {
    executions.set(runId, operation);
    void operation.then(
      () => { if (executions.get(runId) === operation) executions.delete(runId); },
      () => { if (executions.get(runId) === operation) executions.delete(runId); },
    );
  }

  async function activateSuccessor(predecessorRunId: string): Promise<void> {
    if (released) return;
    const predecessor = await load(predecessorRunId);
    if (predecessor === undefined) return;
    const control = await loadConversationControl(predecessor.state.turn.conversationId);
    if (control?.state.deletedAt !== undefined) return;
    const successor = [...documents.values()]
      .filter((document) => document.state.status.kind === "queued" && document.state.turn.predecessorRunId === predecessorRunId)
      .sort((left, right) => left.state.timestamps.createdAt.localeCompare(right.state.timestamps.createdAt))[0];
    if (successor === undefined) return;
    const running = await mutate(successor.state.runId, {
      type: "start",
      priorCanonicalMessages: predecessor.state.canonicalMessages,
    });
    if (running.status.kind === "running") track(running.runId, runExecution(running.runId));
  }

  async function start(startInput: StartOrdinaryRunInput): Promise<OrdinaryRunState> {
    assertLive();
    await readyPromise;
    const conversationControl = await loadConversationControl(startInput.turn.conversationId);
    if (conversationControl?.state.deletedAt !== undefined) {
      throw new Error(`Ordinary conversation ${startInput.turn.conversationId} was deleted`);
    }
    if (await load(startInput.runId) !== undefined) throw new Error(`Ordinary run ${startInput.runId} already exists`);
    const predecessor = startInput.turn.predecessorRunId === undefined
      ? undefined
      : await load(startInput.turn.predecessorRunId);
    if (startInput.turn.predecessorRunId !== undefined && predecessor === undefined) {
      throw new Error(`Ordinary predecessor run ${startInput.turn.predecessorRunId} was not found`);
    }
    if (predecessor !== undefined && predecessor.state.turn.conversationId !== startInput.turn.conversationId) {
      throw new Error("Ordinary predecessor must belong to the same conversation");
    }
    if (startInput.turn.ordinal !== (predecessor?.state.turn.ordinal ?? 0) + 1) {
      throw new Error("Ordinary run ordinal must immediately follow its predecessor");
    }
    if (predecessor !== undefined && [...documents.values()].some((document) =>
      document.state.status.kind === "queued" && document.state.turn.predecessorRunId === predecessor.state.runId)) {
      throw new Error(`Ordinary predecessor run ${predecessor.state.runId} already has a queued successor`);
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
    if (predecessor !== undefined && !isTerminal(predecessor.state)) return clone(initial);
    const running = await mutate(initial.runId, { type: "start" });
    track(initial.runId, runExecution(initial.runId));
    return running;
  }

  async function submitTurn(submitInput: SubmitOrdinaryTurnInput): Promise<SubmitOrdinaryTurnResult> {
    assertLive();
    await readyPromise;
    const conversationId = submitInput.conversationId ?? idFactory("conversation");
    return enqueue(`conversation:${conversationId}`, async () => {
      let control = await loadConversationControl(conversationId);
      if (control === undefined) {
        if (submitInput.conversationId !== undefined) throw new Error(`Ordinary conversation ${conversationId} was not found`);
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
      const run = await start({
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
      if (current === undefined) throw new Error(`Ordinary conversation ${conversationId} was not found`);
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
      if (runs.some((run) => !isTerminal(run))) throw new Error("Cannot roll back a busy Ordinary conversation");
      const completed = runs.filter((run) => run.status.kind === "completed");
      const target = rollback.targetRunId === undefined
        ? completed[Math.max(0, completed.length - Math.max(1, Math.floor(rollback.stepsBack ?? 1)) - 1)]
        : completed.find((run) => run.runId === rollback.targetRunId);
      if (target === undefined) throw new Error("Ordinary rollback target was not found in completed visible runs");
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
        await input.repository.delete(document.state.runId);
        documents.delete(document.state.runId);
        activityStreams.delete(document.state.runId);
        listeners.delete(document.state.runId);
      }
    });
  }

  function visibleRuns(control: OrdinaryConversationControlDocument): readonly OrdinaryRunState[] {
    return visibleOrdinaryConversationRuns(control, [...documents.values()].map((document) => document.state));
  }

  function conversationView(control: OrdinaryConversationControlDocument): OrdinaryConversationReadModel | undefined {
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
    if (document === undefined) throw new Error(`Ordinary run ${runId} was not found`);
    if (isTerminal(document.state)) return clone(document.state);
    controllers.get(runId)?.abort(reason);
    const continuation = continuations.get(runId);
    continuations.delete(runId);
    const cancelled = await mutate(runId, { type: "cancel", reason }, { keepTerminal: true });
    await activateSuccessor(runId);
    if (continuation !== undefined) await continuation.release().catch(() => undefined);
    return cancelled;
  }

  async function decideApproval(decision: ConfirmationDecision): Promise<OrdinaryRunState> {
    assertLive();
    await readyPromise;
    const document = await load(decision.runId);
    if (document === undefined) throw new Error(`Ordinary run ${decision.runId} was not found`);
    if (document.state.status.kind !== "awaiting_approval") {
      throw new Error(`Ordinary run ${decision.runId} is not awaiting approval`);
    }
    if (!document.state.status.confirmationRequests.some((request) => request.confirmationId === decision.confirmationId)) {
      throw new Error(`Confirmation ${decision.confirmationId} does not belong to Ordinary run ${decision.runId}`);
    }
    const continuation = continuations.get(decision.runId);
    if (continuation === undefined) {
      const blocked = await mutate(decision.runId, {
        type: "block",
        reason: {
          code: "confirmation_continuation_lost",
          message: "The live confirmation continuation is no longer available.",
        },
        continueBy: "new_turn",
      });
      await activateSuccessor(decision.runId);
      return blocked;
    }
    continuations.delete(decision.runId);
    const running = await mutate(decision.runId, { type: "approval_decided", decision });
    const controller = new AbortController();
    controllers.set(decision.runId, controller);
    const operation = (async () => {
      try {
        await applyOutcome(decision.runId, await continuation.decide({ decision, abortSignal: controller.signal }));
      } catch (error) {
        const latest = await load(decision.runId);
        if (latest !== undefined && !isTerminal(latest.state)) {
          await mutate(decision.runId, {
            type: controller.signal.aborted ? "cancel" : "fail",
            ...(controller.signal.aborted
              ? { reason: cancellationReason(controller.signal.reason) }
              : { error: { code: "ordinary_execution_failed", message: errorMessage(error) } }),
          } as OrdinaryRunTransition, { keepTerminal: controller.signal.aborted });
          await activateSuccessor(decision.runId);
        }
      } finally {
        controllers.delete(decision.runId);
      }
    })();
    track(decision.runId, operation);
    return running;
  }

  function assertLive(): void {
    if (released) throw new Error("OrdinaryAgentFeature has been released");
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
        const stream = streamFor(runId, document.state.timeline);
        const reset = cursor !== undefined && (
          cursor.streamId !== stream.streamId || cursor.sequence < 0 || cursor.sequence >= stream.nextSequence
        );
        const afterSequence = cursor === undefined || reset ? 0 : cursor.sequence;
        return {
          cursor: activityCursor(stream),
          reset,
          activities: clone(stream.activities.filter((activity) => activity.sequence > afterSequence)),
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
      await Promise.allSettled(mutationQueues.values());
      // An abort-ignoring execution may have returned an approval while release awaited it.
      await releaseContinuations();
      listeners.clear();
      activityStreams.clear();
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
    throw new Error(`Ordinary conversation ${document.state.conversationId} was deleted`);
  }
}
function requireActiveLineage(document: OrdinaryConversationControlDocument) {
  const lineage = document.state.lineages.find((item) => item.lineageId === document.state.activeLineageId);
  if (lineage === undefined) throw new Error(`Ordinary conversation ${document.state.conversationId} active lineage was not found`);
  return lineage;
}
function cancellationReason(value: unknown): string { return typeof value === "string" ? value : "cancelled"; }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function clone<T>(value: T): T { return globalThis.structuredClone(value); }
