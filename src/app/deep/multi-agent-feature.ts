import type {
  BasicAgentCapabilitySnapshot,
  SanitizedInformationAccessConfig,
} from "../../domain/config/index.js";
import type { IntelligenceChannel } from "../../domain/intelligence/index.js";
import type { ObservationRef } from "../../domain/observation/contracts.js";
import type { ToolConfirmationPolicy, ToolExecutionBroker } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import {
  createAgentRunTree,
  recordChildAgentRunParentInstruction,
} from "../../domain/underground/agent-fabric.js";
import { createMinimalReadonlySoilStore, createMinimalSoilConstraints } from "../../domain/soil/index.js";
import type { Constraint } from "../../domain/constraints.js";
import type { ReadonlySoilStore } from "../../domain/soil/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import type { ModelRuntimeMode } from "../model-runtime/contracts.js";
import type { ModelRuntimeChannelContext } from "../model-runtime/factory.js";
import {
  createDeepConversationService,
  createFileSystemDeepConversationStore,
  InMemoryDeepConversationStore,
  type DeepConversationStore,
} from "./deep-conversation.js";
import {
  createFileSystemDeepRunRecordStore,
  InMemoryDeepRunRecordStore,
  type DeepRunRecordStore,
} from "./deep-run-record-store.js";
import {
  createCoordinatedDeepRunRecordStore,
  type DeepRunRecordWriteCoordinator,
} from "./deep-run-record-write-coordinator.js";
import {
  createFileSystemDeepChildMessageStore,
  InMemoryDeepChildMessageStore,
  type DeepChildMessageStore,
} from "./deep-child-messages.js";
import {
  createFileSystemDeepChildLoopContextStore,
  InMemoryDeepChildLoopContextStore,
  type DeepChildLoopContextStore,
} from "./deep-child-loop-contexts.js";
import {
  DeepChildPendingContinuationStore,
  type DeepChildPendingContinuationRetentionOptions,
} from "./deep-child-continuations.js";
import type {
  DeepChildInstructionQueueHandle,
  DeepChildInstructionQueueResult,
} from "./deep-child-scheduler-contracts.js";
import { createDeepRunControlHandle, type DeepRunControlHandle } from "./deep-run-control.js";
import type {
  DeepRuntimeConfig,
  DeepRunRecord,
  StartDeepRuntimeInput,
} from "./deep-runtime.js";
import { buildDeepManagerSpec, executeDeepRun } from "./deep-runtime.js";
import type {
  DeepConversation,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepIntakeTurn,
} from "./contracts.js";
import { DEEP_RUN_KIND, DEEP_RUN_MODE } from "./contracts.js";
import { createDeepTurnRuntime, executeDeepTurn } from "./deep-turn.js";
import {
  deepIntakeMessages,
  deepIntakeOutputContract,
  extractStructuredOutput,
  parseDeepIntake,
} from "./deep-model-io.js";
import {
  buildDeepFollowUpContext,
  summarizeTaskSoilInputForIntake,
  summarizeTerminalDeepRunForIntake,
  fallbackLiveProjectionForRecord,
  workspaceDirectoryFromDeepRunRecord,
} from "./deep-read-model.js";
import type { DeepRunStreamEvent } from "./deep-events.js";
import {
  appendDeepRunFollowUpTurn,
  createDeepRunFollowUpTurn,
} from "./deep-follow-up-turns.js";
import { createTaskSoilFromDesktopInput } from "../task-soil/task-soil-workspace.js";
import {
  assertRunModeForKind,
  resolveRunModeForKind,
  type AgentArborRunKind,
  type AgentArborRunMode,
} from "../run-runtime-core/run-mode-policy.js";
import type { CapabilityAgentProfile } from "../capability/capability-policy.js";
import {
  continueDeepChildAgent,
  resumeDeepChildAgent,
  type DeepChildConfirmationDecision,
  type DeepChildAgentRunResult,
} from "./deep-child-agent-runner.js";
import {
  applyDeepChildOperationResult,
  applyDeepResynthesisResult,
  buildDeepResynthesisInputRefs,
  collectDeepChildEvidenceRefs,
  deepChildParentInstructionMessageRef,
  loadDeepChildParentMessageContext,
  recordDeepChildMessage,
  recordDeepChildMessageForResult,
  resolveDeepChildOperationTarget,
  summarizeDeepChildParentInstruction,
} from "./deep-child-control-service.js";
import { synthesizeDeepConclusion } from "./parent-synthesis.js";
import {
  DEEP_MANAGER_MAX_MODEL_ROUNDS,
  DEEP_MANAGER_MAX_TOOL_ROUNDS,
} from "./deep-run-executor.js";

export type MultiAgentIntakeResult = {
  readonly status: "needs_input" | "answered" | "plan_ready";
  readonly conversation: DeepConversation;
  readonly intake: DeepIntakeTurn;
};

export type MultiAgentStartedRun = {
  readonly conversation: DeepConversation;
  readonly runId: string;
  readonly runKind: AgentArborRunKind;
  readonly runMode: AgentArborRunMode;
  readonly rootRunId: string;
  readonly turnOrdinal: number;
};

export const MULTI_AGENT_CAPABILITY_PROFILE: CapabilityAgentProfile = {
  agentId: "deep-runtime-manager",
  displayName: "Multi-Agent Manager",
  toolVisibilityProfile: {
    profileId: "multi-agent-manager:shared-tools:v1",
    runMode: "deep",
    visibleToolScopes: ["desktop-basic", "workspace", "research", "mcp"],
    hiddenToolScopes: ["underground"],
  },
};

const MULTI_AGENT_TOOL_OUTPUT_OWNER_PREFIX = "deep-run:";

/** Stable process-local owner shared by the initial run and later child operations. */
function multiAgentToolOutputOwnerId(runId: string): string {
  return `${MULTI_AGENT_TOOL_OUTPUT_OWNER_PREFIX}${runId}`;
}

export type MultiAgentRunResourceLease = {
  readonly intelligenceChannel: IntelligenceChannel;
  readonly toolCenter: ToolExecutionBroker;
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly release: () => void | Promise<void>;
};

export type MultiAgentRunResourceAcquirer = (input: {
  readonly aiMode: ModelRuntimeMode;
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly taskSoil: StartDeepRuntimeInput["taskSoil"];
  readonly channelContext: ModelRuntimeChannelContext;
}) => Promise<MultiAgentRunResourceLease>;

export type MultiAgentRunStartFactsResolver = (input: {
  readonly workspaceDirectory?: string;
}) => Promise<{
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly confirmationPolicy: ToolConfirmationPolicy;
}>;

export type MultiAgentBackgroundFailureReporter = (input: {
  readonly runId: string;
  readonly conversationId: string;
  readonly error: unknown;
}) => void;

export class MultiAgentFeatureError extends Error {
  constructor(
    readonly code:
      | "resource_port_unavailable"
      | "feature_quiescing"
      | "capability_snapshot_missing"
      | "conversation_not_found"
      | "conversation_busy"
      | "intake_active_run_not_terminal"
      | "intake_missing_objective"
      | "run_not_found"
      | "run_not_active"
      | "run_ai_mode_missing"
      | "run_continuation_facts_missing"
      | "run_control_not_found"
      | "parent_run_conversation_mismatch"
      | "follow_up_requires_terminal_run"
      | "child_not_found"
      | "confirmation_continuation_lost"
      | "resynthesis_no_child_material"
      | "resynthesis_no_child_runs",
    message: string,
  ) {
    super(message);
    this.name = "MultiAgentFeatureError";
  }
}

export type MultiAgentChildInstructionQueueRegistry = {
  readonly register: (runId: string, handle: DeepChildInstructionQueueHandle) => void;
  readonly unregister: (runId: string, handle: DeepChildInstructionQueueHandle) => void;
  readonly get: (runId: string) => DeepChildInstructionQueueHandle | undefined;
  readonly deleteForRun: (runId: string) => void;
  readonly clear: () => void;
};

export type MultiAgentFeature = {
  readonly getConversation: (conversationId: string) => Promise<DeepConversation | undefined>;
  readonly listConversations: (limit: number) => Promise<readonly DeepConversation[]>;
  readonly renameConversation: (conversationId: string, title: string) => Promise<DeepConversation>;
  readonly pinConversation: (conversationId: string, pinned: boolean) => Promise<DeepConversation>;
  readonly deleteConversation: (conversationId: string) => Promise<void>;
  readonly getRun: (runId: string) => Promise<DeepRunRecord | undefined>;
  readonly listRuns: (limit: number) => Promise<readonly DeepRunRecord[]>;
  readonly listRunsForConversation: (
    conversationId: string,
    limit: number,
  ) => Promise<readonly DeepRunRecord[]>;
  readonly createConversation: (input: {
    readonly aiMode: ModelRuntimeMode;
    readonly title?: string;
    readonly goal: string;
    readonly birthWorkspaceDirectory?: string;
    readonly taskSoilInput?: DeepConversation["taskSoilInput"];
  }) => Promise<DeepConversation>;
  readonly intake: (input: {
    readonly aiMode: ModelRuntimeMode;
    readonly conversationId?: string;
    readonly activeRunId?: string;
    readonly message: string;
    readonly taskSoilInput?: DeepConversation["taskSoilInput"];
    readonly workspaceDirectory?: string;
  }) => Promise<MultiAgentIntakeResult>;
  readonly startRun: (input: {
    readonly conversationId: string;
    readonly aiMode: ModelRuntimeMode;
    readonly parentRunId?: string;
    readonly intakeTurnId?: string;
    readonly confirmedObjective?: string;
    readonly confirmedPlan?: string;
    readonly workspaceDirectory?: string;
  }) => Promise<MultiAgentStartedRun>;
  readonly followUp: (input: {
    readonly runId: string;
    readonly aiMode: ModelRuntimeMode;
    readonly message: string;
    readonly taskSoilInput?: DeepConversation["taskSoilInput"];
    readonly workspaceDirectory?: string;
  }) => Promise<MultiAgentStartedRun & { readonly parentRunId: string }>;
  readonly resumeChild: (input: {
    readonly runId: string;
    readonly childRunId: string;
    readonly confirmationId: string;
    readonly decision: DeepChildConfirmationDecision;
  }) => Promise<DeepRunRecord>;
  readonly sendChildInstruction: (input: {
    readonly runId: string;
    readonly childRunId: string;
    readonly message: string;
  }) => Promise<
    | {
        readonly status: "queued";
        readonly record: DeepRunRecord;
        readonly messageRef: string;
        readonly childStatus: string;
        readonly queuedCount: number;
        readonly queuedAt: string;
      }
    | { readonly status: "continued"; readonly record: DeepRunRecord; readonly messageRef?: string }
    | {
        readonly status: "rejected";
        readonly result: Exclude<DeepChildInstructionQueueResult, { readonly status: "queued" }>;
      }
  >;
  readonly resynthesize: (input: {
    readonly runId: string;
  }) => Promise<DeepRunRecord>;
  readonly requestRunControl: (input: {
    readonly runId: string;
    readonly action: "interrupt" | "correct" | "stop";
    readonly reason?: string;
    readonly correctionContext?: readonly string[];
  }) => Promise<{ readonly status: "requested"; readonly record?: DeepRunRecord }>;
  readonly isRunActive: (runId: string) => boolean;
  readonly waitForIdle: () => Promise<void>;
  readonly dispose: () => Promise<void>;
};

type MultiAgentFeatureRuntime = MultiAgentFeature & {
  readonly constraints: readonly Constraint[];
  readonly soilStore: ReadonlySoilStore;
  readonly conversationStore: DeepConversationStore;
  readonly runRecordStore: DeepRunRecordStore;
  readonly runRecordWrites: DeepRunRecordWriteCoordinator;
  readonly childMessageStore: DeepChildMessageStore;
  readonly childLoopContextStore: DeepChildLoopContextStore;
  readonly childContinuations: DeepChildPendingContinuationStore;
  readonly childInstructionQueues: MultiAgentChildInstructionQueueRegistry;
  readonly registerControlHandle: (runId: string, handle: DeepRunControlHandle) => void;
  readonly controlHandleForRun: (runId: string) => DeepRunControlHandle | undefined;
  readonly deleteControlHandle: (runId: string) => void;
  readonly trackActiveRun: (input: {
    readonly runId: string;
    readonly conversationId: string;
    readonly promise: Promise<void>;
    readonly releaseResources?: () => void | Promise<void>;
  }) => void;
  readonly hasActiveRunForConversation: (conversationId: string) => boolean;
  readonly activeConversationIdForRun: (runId: string) => string | undefined;
  readonly forgetRun: (runId: string) => void;
  readonly releaseToolOutputOwner: (ownerId: string) => void | Promise<void>;
};

/**
 * Serializes mutating commands for one Deep conversation while leaving
 * unrelated conversations independent. The gate promise always resolves so a
 * failed command cannot block the next command in the same conversation.
 */
type DeepConversationCommandGate = {
  run<T>(conversationId: string, command: () => Promise<T>): Promise<T>;
};

function createDeepConversationCommandGate(): DeepConversationCommandGate {
  const tails = new Map<string, Promise<void>>();
  return {
    run<T>(conversationId: string, command: () => Promise<T>): Promise<T> {
      const previous = tails.get(conversationId) ?? Promise.resolve();
      const result = previous.then(command);
      const completion = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(conversationId, completion);
      void completion.then(() => {
        if (tails.get(conversationId) === completion) {
          tails.delete(conversationId);
        }
      });
      return result;
    },
  };
}

export function createMultiAgentFeature(options: {
  readonly runtimeHome?: string;
  readonly acquireRunResources?: MultiAgentRunResourceAcquirer;
  readonly resolveRunStartFacts?: MultiAgentRunStartFactsResolver;
  readonly reportBackgroundFailure?: MultiAgentBackgroundFailureReporter;
  readonly childContinuationRetention?: DeepChildPendingContinuationRetentionOptions;
  /** Host cleanup port for process-local retained tool output; no store leaks into the feature. */
  readonly releaseToolOutputOwner?: (ownerId: string) => void | Promise<void>;
} = {}): MultiAgentFeature {
  const controlHandles = new Map<string, DeepRunControlHandle>();
  const activeRunConversationIds = new Map<string, string>();
  const activeRuns = new Map<string, Promise<void>>();
  const childContinuations = new DeepChildPendingContinuationStore(options.childContinuationRetention);
  const childInstructionQueues = createChildInstructionQueueRegistry();
  const constraints = createMinimalSoilConstraints();
  const soilStore = createMinimalReadonlySoilStore(constraints);
  const reportBackgroundFailure = options.reportBackgroundFailure ?? defaultBackgroundFailureReporter;
  const activeOperations = new Set<Promise<unknown>>();
  const conversationCommandGate = createDeepConversationCommandGate();
  const coordinatedRunRecords = createCoordinatedDeepRunRecordStore(
    createRunRecordStore(options.runtimeHome),
  );
  let isQuiescing = false;
  let disposePromise: Promise<void> | undefined;

  const runCommand = <T>(command: () => Promise<T>): Promise<T> => {
    if (isQuiescing) {
      return Promise.reject(new MultiAgentFeatureError(
        "feature_quiescing",
        "Multi-Agent feature is shutting down and cannot accept new commands.",
      ));
    }
    let operation: Promise<T>;
    operation = Promise.resolve().then(command).finally(() => {
      activeOperations.delete(operation);
    });
    activeOperations.add(operation);
    return operation;
  };

  const runForConversation = <T>(
    conversationId: string,
    command: () => Promise<T>,
  ): Promise<T> => runCommand(() => conversationCommandGate.run(conversationId, command));

  const runForRunId = <T>(
    runId: string,
    command: () => Promise<T>,
  ): Promise<T> => runCommand(async () => {
    // An active run is registered before its initial snapshot is necessarily
    // durable. Prefer that birth-time mapping so an immediate stop/correct
    // still reaches its control handle; fall back to the durable record after
    // restart. If neither exists, preserve the command's own error semantics.
    const conversationId = feature.activeConversationIdForRun(runId)
      ?? (await feature.runRecordStore.get(runId))?.run.conversationId;
    if (conversationId === undefined) {
      return command();
    }
    // The command itself re-reads and validates its run after admission. This
    // keeps legacy immediate-control behavior while ensuring a delete that won
    // the gate cannot be followed by a late save.
    return conversationCommandGate.run(conversationId, command);
  });

  const feature: MultiAgentFeatureRuntime = {
    constraints: soilStore.listConstraints(),
    soilStore,
    conversationStore: createConversationStore(options.runtimeHome),
    runRecordStore: coordinatedRunRecords.store,
    runRecordWrites: coordinatedRunRecords.writes,
    childMessageStore: createChildMessageStore(options.runtimeHome),
    childLoopContextStore: createChildLoopContextStore(options.runtimeHome),
    childContinuations,
    childInstructionQueues,
    releaseToolOutputOwner: options.releaseToolOutputOwner ?? (() => undefined),
    getConversation: (conversationId) => feature.conversationStore.get(conversationId),
    listConversations: (limit) => feature.conversationStore.list(limit),
    renameConversation: (conversationId, title) => runForConversation(conversationId, async () => {
      const conversation = await requireMultiAgentConversation(feature, conversationId);
      if (conversation.title === title) {
        return conversation;
      }
      return feature.conversationStore.upsert({
        ...conversation,
        title,
        titleEditedAt: nowIso(),
      });
    }),
    pinConversation: (conversationId, pinned) => runForConversation(conversationId, async () => {
      const conversation = await requireMultiAgentConversation(feature, conversationId);
      return feature.conversationStore.upsert({
        ...conversation,
        pinnedAt: pinned ? (conversation.pinnedAt ?? nowIso()) : undefined,
      });
    }),
    deleteConversation: (conversationId) => runForConversation(
      conversationId,
      () => deleteMultiAgentConversation(feature, conversationId),
    ),
    getRun: (runId) => feature.runRecordStore.get(runId),
    listRuns: (limit) => feature.runRecordStore.list(limit),
    listRunsForConversation: async (conversationId, limit) => {
      await requireMultiAgentConversation(feature, conversationId);
      return feature.runRecordStore.listByConversation(conversationId, limit);
    },
    createConversation: (input) => runCommand(() => createDeepConversationService({
      store: feature.conversationStore,
      constraints: feature.constraints,
      soilStore: feature.soilStore,
      aiMode: input.aiMode,
    }).create({
      title: input.title,
      goal: input.goal,
      birthWorkspaceDirectory: input.birthWorkspaceDirectory,
      taskSoilInput: input.taskSoilInput,
    })),
    intake: (input) => {
      const command = () => intakeMultiAgentConversation(
        feature,
        requireResourceAcquirer(options),
        requireStartFactsResolver(options),
        input,
      );
      if (input.conversationId !== undefined) {
        return runForConversation(input.conversationId, command);
      }
      if (input.activeRunId !== undefined) {
        return runForRunId(input.activeRunId, command);
      }
      return runCommand(command);
    },
    startRun: (input) => runForConversation(input.conversationId, () => startMultiAgentConversationRun(
      feature,
      requireResourceAcquirer(options),
      requireStartFactsResolver(options),
      input,
    )),
    followUp: (input) => runForRunId(input.runId, () => followUpMultiAgentRun(
      feature,
      requireResourceAcquirer(options),
      requireStartFactsResolver(options),
      input,
    )),
    resumeChild: (input) => runForRunId(input.runId, () => resumeMultiAgentChild(
      feature,
      requireResourceAcquirer(options),
      input,
    )),
    sendChildInstruction: (input) => runForRunId(input.runId, () => sendMultiAgentChildInstruction(
      feature,
      requireResourceAcquirer(options),
      input,
    )),
    resynthesize: (input) => runForRunId(input.runId, () => resynthesizeMultiAgentRun(
      feature,
      requireResourceAcquirer(options),
      input,
    )),
    requestRunControl: (input) => runForRunId(input.runId, () => requestMultiAgentRunControl(feature, input)),
    registerControlHandle(runId, handle): void {
      controlHandles.set(runId, handle);
    },
    controlHandleForRun(runId): DeepRunControlHandle | undefined {
      return controlHandles.get(runId);
    },
    deleteControlHandle(runId): void {
      controlHandles.delete(runId);
    },
    trackActiveRun(input): void {
      activeRunConversationIds.set(input.runId, input.conversationId);
      const trackedPromise = input.promise.finally(async () => {
        try {
          await input.releaseResources?.();
        } finally {
          if (activeRuns.get(input.runId) === trackedPromise) {
            activeRuns.delete(input.runId);
            activeRunConversationIds.delete(input.runId);
            controlHandles.delete(input.runId);
          }
        }
      });
      activeRuns.set(input.runId, trackedPromise);
      void trackedPromise.catch((error: unknown) => {
        reportMultiAgentBackgroundFailure(reportBackgroundFailure, {
          runId: input.runId,
          conversationId: input.conversationId,
          error,
        });
      });
    },
    isRunActive(runId): boolean {
      return activeRuns.has(runId);
    },
    hasActiveRunForConversation(conversationId): boolean {
      return [...activeRunConversationIds.values()].some((id) => id === conversationId);
    },
    activeConversationIdForRun(runId): string | undefined {
      return activeRunConversationIds.get(runId);
    },
    forgetRun(runId): void {
      activeRunConversationIds.delete(runId);
      controlHandles.delete(runId);
      childContinuations.deleteForRun(runId);
      childInstructionQueues.deleteForRun(runId);
    },
    async waitForIdle(): Promise<void> {
      while (activeRuns.size > 0) {
        await Promise.allSettled([...activeRuns.values()]);
      }
    },
    dispose(): Promise<void> {
      isQuiescing = true;
      disposePromise ??= (async () => {
        const requestActiveRunStop = () => {
          for (const handle of controlHandles.values()) {
            handle.requestStop("panel_shutdown");
          }
        };
        // Stop already-created runs before waiting for command setup. Commands
        // that finish setup while quiescing are stopped on the next pass.
        requestActiveRunStop();
        while (activeOperations.size > 0) {
          await Promise.allSettled([...activeOperations]);
          requestActiveRunStop();
        }
        requestActiveRunStop();
        await feature.waitForIdle();
        try {
          await feature.runRecordWrites.drain();
        } finally {
          controlHandles.clear();
          childContinuations.clear();
          childInstructionQueues.clear();
          activeRunConversationIds.clear();
          activeRuns.clear();
        }
      })();
      return disposePromise;
    },
  };
  return feature;
}

function createConversationStore(runtimeHome: string | undefined): DeepConversationStore {
  return runtimeHome === undefined
    ? new InMemoryDeepConversationStore()
    : createFileSystemDeepConversationStore(runtimeHome);
}

function createRunRecordStore(runtimeHome: string | undefined): DeepRunRecordStore {
  return runtimeHome === undefined
    ? new InMemoryDeepRunRecordStore()
    : createFileSystemDeepRunRecordStore(runtimeHome);
}

function createChildMessageStore(runtimeHome: string | undefined): DeepChildMessageStore {
  return runtimeHome === undefined
    ? new InMemoryDeepChildMessageStore()
    : createFileSystemDeepChildMessageStore(runtimeHome);
}

function createChildLoopContextStore(runtimeHome: string | undefined): DeepChildLoopContextStore {
  return runtimeHome === undefined
    ? new InMemoryDeepChildLoopContextStore()
    : createFileSystemDeepChildLoopContextStore(runtimeHome);
}

function createChildInstructionQueueRegistry(): MultiAgentChildInstructionQueueRegistry {
  const handles = new Map<string, DeepChildInstructionQueueHandle>();
  return {
    register(runId, handle): void {
      handles.set(runId, handle);
    },
    unregister(runId, handle): void {
      if (handles.get(runId) === handle) {
        handles.delete(runId);
      }
    },
    get(runId): DeepChildInstructionQueueHandle | undefined {
      return handles.get(runId);
    },
    deleteForRun(runId): void {
      handles.delete(runId);
    },
    clear(): void {
      handles.clear();
    },
  };
}

function requireResourceAcquirer(
  options: { readonly acquireRunResources?: MultiAgentRunResourceAcquirer },
): MultiAgentRunResourceAcquirer {
  if (options.acquireRunResources === undefined) {
    throw new MultiAgentFeatureError(
      "resource_port_unavailable",
      "Multi-Agent model and tool resources were not composed.",
    );
  }
  return options.acquireRunResources;
}

function requireStartFactsResolver(
  options: { readonly resolveRunStartFacts?: MultiAgentRunStartFactsResolver },
): MultiAgentRunStartFactsResolver {
  if (options.resolveRunStartFacts === undefined) {
    throw new MultiAgentFeatureError(
      "resource_port_unavailable",
      "Multi-Agent run-start facts were not composed.",
    );
  }
  return options.resolveRunStartFacts;
}

async function intakeMultiAgentConversation(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  resolveRunStartFacts: MultiAgentRunStartFactsResolver,
  input: Parameters<MultiAgentFeature["intake"]>[0],
): Promise<MultiAgentIntakeResult> {
  const terminalRun = input.activeRunId === undefined
    ? undefined
    : await requireMultiAgentRunRecord(feature, input.activeRunId);
  if (terminalRun !== undefined && !isTerminalMultiAgentRun(terminalRun)) {
    throw new MultiAgentFeatureError(
      "intake_active_run_not_terminal",
      "The active Multi-Agent run is still running.",
    );
  }

  const requestedConversationId = input.conversationId ?? terminalRun?.run.conversationId;
  const workspaceDirectory = terminalRun === undefined
    ? input.workspaceDirectory
    : workspaceDirectoryFromDeepRunRecord(terminalRun) ?? input.workspaceDirectory;
  const conversation = requestedConversationId === undefined
    ? await feature.createConversation({
        aiMode: input.aiMode,
        title: input.message,
        goal: input.message,
        birthWorkspaceDirectory: workspaceDirectory,
        taskSoilInput: input.taskSoilInput,
      })
    : mergeMultiAgentConversationTaskSoil(
        await requireMultiAgentConversation(feature, requestedConversationId),
        input.taskSoilInput,
        workspaceDirectory,
      );
  const startFacts = await resolveRunStartFacts({
    workspaceDirectory: conversation.birthWorkspaceDirectory,
  });
  const intake = await executeMultiAgentIntake(feature, acquireRunResources, {
    aiMode: input.aiMode,
    conversation,
    message: input.message,
    terminalRun,
    capabilitySnapshot: startFacts.capabilitySnapshot,
    informationAccess: startFacts.informationAccess,
  });
  const conversationWithTurn = appendMultiAgentIntakeTurn(conversation, intake);
  const updatedConversation = intake.action === "start_collaboration"
    ? await persistCollaborationObjective(feature, conversationWithTurn, intake)
    : await feature.conversationStore.upsert(conversationWithTurn);
  return {
    status: intake.action === "ask_user"
      ? "needs_input"
      : intake.action === "direct_answer"
      ? "answered"
      : "plan_ready",
    conversation: updatedConversation,
    intake,
  };
}

async function startMultiAgentConversationRun(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  resolveRunStartFacts: MultiAgentRunStartFactsResolver,
  input: Parameters<MultiAgentFeature["startRun"]>[0],
): Promise<MultiAgentStartedRun> {
  let conversation = await requireMultiAgentConversation(feature, input.conversationId);
  const parentRun = input.parentRunId === undefined
    ? undefined
    : await requireMultiAgentRunRecord(feature, input.parentRunId);
  if (parentRun !== undefined && parentRun.run.conversationId !== conversation.conversationId) {
    throw new MultiAgentFeatureError(
      "parent_run_conversation_mismatch",
      "The parent run does not belong to this Multi-Agent conversation.",
    );
  }
  if (parentRun !== undefined && !isTerminalMultiAgentRun(parentRun)) {
    throw new MultiAgentFeatureError(
      "follow_up_requires_terminal_run",
      "The parent Multi-Agent run is still running.",
    );
  }

  const workspaceDirectory = input.workspaceDirectory ?? (
    parentRun === undefined ? undefined : workspaceDirectoryFromDeepRunRecord(parentRun)
  );
  const conversationWithWorkspace = mergeMultiAgentConversationTaskSoil(
    conversation,
    undefined,
    workspaceDirectory,
  );
  if (conversationWithWorkspace !== conversation) {
    conversation = await feature.conversationStore.upsert(conversationWithWorkspace);
  }
  const sourceIntakeTurn = confirmedMultiAgentIntakeSourceTurn(conversation, input.intakeTurnId);
  const intakeContext = confirmedMultiAgentIntakeContext({
    conversation,
    intakeTurnId: input.intakeTurnId,
    confirmedObjective: input.confirmedObjective,
    confirmedPlan: input.confirmedPlan,
  });
  if (input.confirmedObjective !== undefined && input.confirmedObjective !== conversation.currentObjective) {
    conversation = await feature.conversationStore.upsert({
      ...conversation,
      currentObjective: input.confirmedObjective,
      updatedAt: nowIso(),
    });
  }
  const rootRunId = parentRun?.run.rootRunId ?? parentRun?.run.runId;
  const turnOrdinal = rootRunId === undefined
    ? undefined
    : await nextMultiAgentTurnOrdinal(feature, rootRunId);
  const started = await startMultiAgentRun(feature, acquireRunResources, resolveRunStartFacts, {
    conversation,
    aiMode: input.aiMode,
    parentRunId: parentRun?.run.runId,
    rootRunId,
    turnOrdinal,
    followUpContext: parentRun === undefined
      ? undefined
      : buildDeepFollowUpContext(
          parentRun,
          sourceIntakeTurn?.userMessage ?? input.confirmedObjective ?? multiAgentConversationGoal(conversation),
        ),
    intakeContext,
  });
  return { conversation, ...started };
}

async function followUpMultiAgentRun(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  resolveRunStartFacts: MultiAgentRunStartFactsResolver,
  input: Parameters<MultiAgentFeature["followUp"]>[0],
): Promise<MultiAgentStartedRun & { readonly parentRunId: string }> {
  const previous = await requireMultiAgentRunRecord(feature, input.runId);
  if (!isTerminalMultiAgentRun(previous)) {
    throw new MultiAgentFeatureError(
      "follow_up_requires_terminal_run",
      "The current Multi-Agent run is still running.",
    );
  }
  const conversation = await requireMultiAgentConversation(feature, previous.run.conversationId);
  const taskSoilInput = input.taskSoilInput ?? conversation.taskSoilInput;
  const updatedConversation = await feature.conversationStore.upsert({
    ...conversation,
    birthWorkspaceDirectory:
      conversation.birthWorkspaceDirectory ??
      workspaceDirectoryFromDeepRunRecord(previous) ??
      input.workspaceDirectory,
    taskSoilInput,
    permissionBoundaryRefs: taskSoilInput?.permissionBoundaryRefs ?? conversation.permissionBoundaryRefs,
    updatedAt: nowIso(),
  });
  const rootRunId = previous.run.rootRunId ?? previous.run.runId;
  const started = await startMultiAgentRun(feature, acquireRunResources, resolveRunStartFacts, {
    conversation: updatedConversation,
    aiMode: input.aiMode,
    parentRunId: previous.run.runId,
    rootRunId,
    turnOrdinal: await nextMultiAgentTurnOrdinal(feature, rootRunId),
    followUpContext: buildDeepFollowUpContext(previous, input.message),
  });
  return {
    conversation: updatedConversation,
    parentRunId: previous.run.runId,
    ...started,
  };
}

async function startMultiAgentRun(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  resolveRunStartFacts: MultiAgentRunStartFactsResolver,
  input: {
    readonly conversation: DeepConversation;
    readonly aiMode: ModelRuntimeMode;
    readonly parentRunId?: string;
    readonly rootRunId?: string;
    readonly turnOrdinal?: number;
    readonly followUpContext?: DeepFollowUpContext;
    readonly intakeContext?: DeepIntakeContext;
  },
): Promise<{
  readonly runId: string;
  readonly runKind: AgentArborRunKind;
  readonly runMode: AgentArborRunMode;
  readonly rootRunId: string;
  readonly turnOrdinal: number;
}> {
  const runKind: AgentArborRunKind = "underground";
  const runMode: AgentArborRunMode = resolveRunModeForKind(runKind, undefined);
  assertRunModeForKind(runKind, runMode);
  const runId = createId("deep-run");
  const rootRunId = input.rootRunId ?? runId;
  const turnOrdinal = input.turnOrdinal ?? 1;
  const controlHandle = createDeepRunControlHandle();
  feature.registerControlHandle(runId, controlHandle);

  // Deep supports post-terminal child continuation and resynthesis. Use one
  // stable owner for every operation of the run so explicit conversation
  // deletion can reclaim retained tool output without ending it at terminal.
  const traceId = multiAgentToolOutputOwnerId(runId);
  const goalId = createId("goal");
  const facts = await resolveRunStartFacts({
    workspaceDirectory: input.conversation.birthWorkspaceDirectory,
  }).catch((error: unknown) => {
    feature.deleteControlHandle(runId);
    throw error;
  });
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: input.conversation.currentObjective ?? input.conversation.goal,
    goalId,
    traceId,
    aiMode: input.aiMode,
    constraints: feature.constraints,
    soilStore: feature.soilStore,
    taskSoilInput: input.conversation.taskSoilInput,
    createdAt: nowIso(),
  });
  const runtimeConfig = await createMultiAgentRuntimeConfig(feature, acquireRunResources, {
    aiMode: input.aiMode,
    controlHandle,
    taskSoil,
    capabilitySnapshot: facts.capabilitySnapshot,
    informationAccess: facts.informationAccess,
  }).catch((error: unknown) => {
    feature.deleteControlHandle(runId);
    throw error;
  });
  const continuationFacts = {
    informationAccess: facts.informationAccess,
    taskSoilInput: structuredClone(input.conversation.taskSoilInput ?? {}),
    permissionBoundaryRefs: input.conversation.permissionBoundaryRefs,
    confirmationPolicy: facts.confirmationPolicy,
  } as const;
  const startInput: StartDeepRuntimeInput = {
    conversation: input.conversation,
    taskSoil,
    permissionBoundaryRefs: input.conversation.permissionBoundaryRefs,
    confirmationPolicy: facts.confirmationPolicy,
    continuationFacts,
    aiMode: input.aiMode,
    capabilitySnapshot: runtimeConfig.capabilitySnapshot,
    modelAvailable: input.aiMode !== "none",
    traceId,
    goalId,
    runId,
    parentRunId: input.parentRunId,
    rootRunId,
    turnOrdinal,
    followUpContext: input.followUpContext,
    intakeContext: input.intakeContext,
  };
  const runPromise = executeDeepRun(startInput, runtimeConfig.config).then(
    (result) => {
      feature.childContinuations.retainPendingForRun(
        runId,
        result.agentRunTree.childRuns.flatMap((childRun) => (
          childRun.pendingApproval === undefined
            ? []
            : [{
                childRunId: childRun.childRunId,
                confirmationId: childRun.pendingApproval.confirmationId,
              }]
        )),
      );
    },
    (error: unknown) => {
      feature.childContinuations.deleteForRun(runId);
      return writeMultiAgentFailureRecord(
        feature,
        runId,
        input.conversation,
        error,
        { parentRunId: input.parentRunId, rootRunId, turnOrdinal },
        continuationFacts,
      );
    },
  );
  feature.trackActiveRun({
    runId,
    conversationId: input.conversation.conversationId,
    promise: runPromise,
    releaseResources: runtimeConfig.releaseResources,
  });
  return { runId, runKind, runMode, rootRunId, turnOrdinal };
}

async function writeMultiAgentFailureRecord(
  feature: MultiAgentFeatureRuntime,
  runId: string,
  conversation: DeepConversation,
  error: unknown,
  lineage: {
    readonly parentRunId?: string;
    readonly rootRunId: string;
    readonly turnOrdinal: number;
  },
  continuationFacts: NonNullable<DeepRunRecord["run"]["continuationFacts"]>,
): Promise<void> {
  try {
    const timestamp = nowIso();
    await feature.runRecordStore.upsert({
      run: {
        runId,
        conversationId: conversation.conversationId,
        parentRunId: lineage.parentRunId,
        rootRunId: lineage.rootRunId,
        turnOrdinal: lineage.turnOrdinal,
        goal: conversation.currentObjective ?? conversation.goal,
        status: "failed",
        isolation: { kind: "deep_conversation", runKind: DEEP_RUN_KIND, runMode: DEEP_RUN_MODE },
        capabilitySnapshot: undefined,
        continuationFacts,
        startedAt: timestamp,
        updatedAt: timestamp,
      },
      agentRunTree: {
        ...createAgentRunTree({
          treeId: createId("deep-tree"),
          rootRunId: runId,
          rootAgentId: "deep-manager",
          rootSpec: buildDeepManagerSpec(timestamp),
          createdAt: timestamp,
        }),
        status: "failed",
      },
      report: undefined,
      controlEvents: [],
      eventSequence: [{
        id: createId("deep-event"),
        runId,
        sequence: 1,
        type: "deep.failed",
        title: "运行失败",
        summary: error instanceof Error ? error.message : String(error),
        status: "failed",
        timestamp,
        refs: [],
        visibility: "public",
      }],
      liveProjection: {
        phase: "failed",
        activeNodeId: "decision",
        children: [],
        updatedAt: timestamp,
      },
      updatedAt: timestamp,
    });
  } catch {
    // The original run failure remains authoritative when failure projection persistence also fails.
  }
}

async function executeMultiAgentIntake(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  input: {
    readonly aiMode: ModelRuntimeMode;
    readonly conversation: DeepConversation;
    readonly message: string;
    readonly terminalRun?: DeepRunRecord;
    readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
    readonly informationAccess: SanitizedInformationAccessConfig;
  },
): Promise<DeepIntakeTurn> {
  const traceId = createId("trace");
  const goalId = createId("goal");
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: input.message,
    goalId,
    traceId,
    aiMode: input.aiMode,
    constraints: feature.constraints,
    soilStore: feature.soilStore,
    taskSoilInput: input.conversation.taskSoilInput,
  });
  const bus = createMultiAgentOperationBus();
  const resources = await acquireRunResources({
    aiMode: input.aiMode,
    capabilitySnapshot: input.capabilitySnapshot,
    informationAccess: input.informationAccess,
    taskSoil,
    channelContext: { bus },
  });
  try {
    const turn = await executeDeepTurn({
      turnRuntime: createDeepTurnRuntime({ intelligenceChannel: resources.intelligenceChannel }),
      traceId,
      goalId,
      callerAgentId: "deep-intake",
      callerRef: {
        kind: "agent_run",
        id: `deep-intake:${input.conversation.conversationId}`,
        label: "deep-intake",
      } satisfies ObservationRef,
      purpose: "deep_intake",
      outputContract: deepIntakeOutputContract(),
      inputRefs: [
        { kind: "trace", id: traceId },
        { kind: "goal", id: goalId, label: input.conversation.conversationId },
      ],
      messages: deepIntakeMessages({
        message: input.message,
        conversationGoal: input.conversation.goal,
        currentObjective: input.conversation.currentObjective,
        intakeTurns: input.conversation.intakeTurns,
        terminalRunSummary: input.terminalRun === undefined
          ? undefined
          : summarizeTerminalDeepRunForIntake(input.terminalRun),
        taskSoilSummary: summarizeTaskSoilInputForIntake(input.conversation.taskSoilInput),
        capabilitySnapshot: resources.capabilitySnapshot,
      }),
      allowedTools: [],
      maxModelRounds: 1,
      maxToolRounds: 0,
    });
    return parseDeepIntake({
      value: extractStructuredOutput(turn.finalOutput),
      userMessage: input.message,
      createdAt: nowIso(),
    });
  } finally {
    await resources.release();
  }
}

async function createMultiAgentRuntimeConfig(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  input: {
    readonly aiMode: ModelRuntimeMode;
    readonly controlHandle: DeepRunControlHandle;
    readonly taskSoil: StartDeepRuntimeInput["taskSoil"];
    readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
    readonly informationAccess: SanitizedInformationAccessConfig;
  },
): Promise<{
  readonly config: DeepRuntimeConfig;
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly releaseResources: () => Promise<void>;
}> {
  const bus = createMultiAgentOperationBus();
  const resources = await acquireRunResources({
    ...input,
    channelContext: { bus },
  });
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: resources.intelligenceChannel,
    toolCenter: resources.toolCenter,
    contextMaintenance: deepContextMaintenance(
      input.taskSoil.rawGoal,
      input.taskSoil,
      resources.capabilitySnapshot,
    ),
  });
  return {
    config: {
      turnRuntime,
      bus,
      store: feature.runRecordStore,
      controlHandle: input.controlHandle,
      childContinuations: feature.childContinuations,
      childInstructionQueues: feature.childInstructionQueues,
      childMessageStore: feature.childMessageStore,
      childLoopContextStore: feature.childLoopContextStore,
    },
    capabilitySnapshot: resources.capabilitySnapshot,
    releaseResources: async () => {
      await resources.release();
    },
  };
}

async function createExistingMultiAgentTurnRuntime(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  record: DeepRunRecord,
): Promise<{
  readonly turnRuntime: ReturnType<typeof createDeepTurnRuntime>;
  readonly taskSoil: StartDeepRuntimeInput["taskSoil"];
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly releaseResources: () => Promise<void>;
}> {
  const capabilitySnapshot = record.run.capabilitySnapshot;
  if (capabilitySnapshot === undefined) {
    throw new MultiAgentFeatureError(
      "capability_snapshot_missing",
      "Multi-Agent run has no frozen capability snapshot.",
    );
  }
  const continuationFacts = requireMultiAgentContinuationFacts(record);
  const aiMode = record.run.aiMode;
  if (aiMode === undefined) {
    throw new MultiAgentFeatureError(
      "run_ai_mode_missing",
      "Multi-Agent run has no frozen model runtime mode.",
    );
  }
  // Existing-run operations must use the exact task context frozen when this
  // run started. The owning conversation may already contain later-turn input.
  const taskSoil = createTaskSoilFromDesktopInput({
    goal: record.run.goal,
    goalId: record.run.conversationId,
    traceId: multiAgentToolOutputOwnerId(record.run.runId),
    aiMode,
    constraints: feature.constraints,
    soilStore: feature.soilStore,
    taskSoilInput: continuationFacts.taskSoilInput,
  });
  const bus = createMultiAgentOperationBus();
  const resources = await acquireRunResources({
    aiMode,
    capabilitySnapshot,
    informationAccess: continuationFacts.informationAccess,
    taskSoil,
    channelContext: { bus },
  });
  return {
    turnRuntime: createDeepTurnRuntime({
      intelligenceChannel: resources.intelligenceChannel,
      toolCenter: resources.toolCenter,
      contextMaintenance: deepContextMaintenance(record.run.goal, taskSoil, resources.capabilitySnapshot),
    }),
    taskSoil,
    capabilitySnapshot: resources.capabilitySnapshot,
    releaseResources: async () => {
      await resources.release();
    },
  };
}

async function resumeMultiAgentChild(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  input: {
    readonly runId: string;
    readonly childRunId: string;
    readonly confirmationId: string;
    readonly decision: DeepChildConfirmationDecision;
  },
): Promise<DeepRunRecord> {
  const pendingContinuation = feature.childContinuations.get(
    input.runId,
    input.childRunId,
    input.confirmationId,
  );
  if (pendingContinuation === undefined) {
    throw new MultiAgentFeatureError(
      "confirmation_continuation_lost",
      "The child Agent confirmation continuation is no longer available.",
    );
  }
  const record = await requireMultiAgentRunRecord(feature, input.runId);
  const childRuntime = await createExistingMultiAgentTurnRuntime(
    feature,
    acquireRunResources,
    record,
  );
  const continuation = feature.childContinuations.consume(
    input.runId,
    input.childRunId,
    input.confirmationId,
  );
  if (continuation === undefined) {
    await childRuntime.releaseResources();
    throw new MultiAgentFeatureError(
      "confirmation_continuation_lost",
      "The child Agent confirmation continuation is no longer available.",
    );
  }
  let result: DeepChildAgentRunResult;
  try {
    result = await resumeDeepChildAgent({
      runId: input.runId,
      childRun: continuation.childRun,
      childSpec: continuation.childSpec,
      pendingApproval: continuation.pendingApproval,
      decision: input.decision,
      turnRuntime: childRuntime.turnRuntime,
      childLoopContextStore: feature.childLoopContextStore,
    });
  } finally {
    await childRuntime.releaseResources();
  }
  feature.childContinuations.remember(input.runId, result.pendingContinuation);
  return applyDeepChildOperationResult(feature, record, result, {
    eventTitle: result.completedRun.status === "completed" ? "子 Agent 已继续" : "子 Agent 继续受阻",
    eventSummary: result.completedRun.status === "completed"
      ? result.summary.summary
      : result.completedRun.failureReason ?? result.summary.uncertainty ?? "子 Agent 需要继续处理。",
  });
}

async function sendMultiAgentChildInstruction(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  input: {
    readonly runId: string;
    readonly childRunId: string;
    readonly message: string;
  },
): ReturnType<MultiAgentFeature["sendChildInstruction"]> {
  const record = await requireMultiAgentRunRecord(feature, input.runId);
  const queueHandle = feature.childInstructionQueues.get(input.runId);
  if (queueHandle !== undefined) {
    const queued = queueHandle.queueChildInstruction({
      childRunId: input.childRunId,
      instruction: input.message,
    });
    if (queued.status === "queued") {
      await recordDeepChildMessage(feature, {
        runId: input.runId,
        childRunId: input.childRunId,
        instructionId: queued.instructionId,
        messageRef: queued.messageRef,
        source: "control_api",
        status: "queued",
        content: input.message,
        requestedAt: queued.queuedAt,
        queuedAt: queued.queuedAt,
      });
      return {
        status: "queued",
        record,
        messageRef: queued.messageRef,
        childStatus: queued.childStatus,
        queuedCount: queued.queuedCount,
        queuedAt: queued.queuedAt,
      };
    }
    if (isContinuableTerminalChildRejection(queued)) {
      const continued = await queueHandle.continueChildInstruction({
        childRunId: input.childRunId,
        instruction: input.message,
      });
      if (continued.status === "continued") {
        const latest = await feature.runRecordStore.get(input.runId);
        await recordDeepChildMessageForResult(
          feature,
          input.runId,
          input.message,
          continued.material.completedRun,
        );
        return {
          status: "continued",
          record: latest ?? record,
          messageRef: continued.material.completedRun.parentInstructions?.at(-1)?.messageRef,
        };
      }
      return { status: "rejected", result: continued };
    }
    return { status: "rejected", result: queued };
  }
  const childState = resolveDeepChildOperationTarget(feature, record, input.childRunId);
  if (childState === undefined) {
    throw new MultiAgentFeatureError("child_not_found", "Multi-Agent child run was not found.");
  }
  const childRuntime = await createExistingMultiAgentTurnRuntime(
    feature,
    acquireRunResources,
    record,
  );
  feature.childContinuations.deleteForChildRun(input.runId, input.childRunId);
  let result: DeepChildAgentRunResult;
  try {
    const requestedAt = nowIso();
    const instructionId = createId("deep-child-instruction");
    const messageRef = deepChildParentInstructionMessageRef(instructionId);
    result = await continueDeepChildAgent({
      runId: input.runId,
      childRun: recordChildAgentRunParentInstruction(childState.childRun, {
        instructionId,
        messageRef,
        source: "control_api",
        status: "executed",
        instructionSummary: summarizeDeepChildParentInstruction(input.message),
        requestedAt,
        executedAt: requestedAt,
      }),
      childSpec: childState.childSpec,
      previousSummary: childState.previousSummary,
      parentInstruction: input.message,
      currentParentInstructionRef: messageRef,
      parentMessageHistory: await loadDeepChildParentMessageContext(
        feature,
        input.runId,
        input.childRunId,
      ),
      goal: record.run.goal,
      permissionBoundaryRefs: requireMultiAgentContinuationFacts(record).permissionBoundaryRefs,
      turnRuntime: childRuntime.turnRuntime,
      traceId: multiAgentToolOutputOwnerId(input.runId),
      goalId: record.run.conversationId,
      confirmationPolicy: requireMultiAgentContinuationFacts(record).confirmationPolicy,
      capabilitySnapshot: childRuntime.capabilitySnapshot,
      childLoopContextStore: feature.childLoopContextStore,
    });
    await recordDeepChildMessage(feature, {
      runId: input.runId,
      childRunId: input.childRunId,
      instructionId,
      messageRef,
      source: "control_api",
      status: "executed",
      content: input.message,
      requestedAt,
      executedAt: requestedAt,
    });
  } finally {
    await childRuntime.releaseResources();
  }
  feature.childContinuations.remember(input.runId, result.pendingContinuation);
  const updated = await applyDeepChildOperationResult(feature, record, result, {
    eventTitle: "父 Agent 已补充子任务",
    eventSummary: result.summary.summary,
  });
  return {
    status: "continued",
    record: updated,
    messageRef: result.completedRun.parentInstructions?.at(-1)?.messageRef,
  };
}

async function resynthesizeMultiAgentRun(
  feature: MultiAgentFeatureRuntime,
  acquireRunResources: MultiAgentRunResourceAcquirer,
  input: {
    readonly runId: string;
  },
): Promise<DeepRunRecord> {
  const record = await requireMultiAgentRunRecord(feature, input.runId);
  const childSummaries = record.report?.childSummaries;
  if (childSummaries === undefined || childSummaries.length === 0) {
    throw new MultiAgentFeatureError("resynthesis_no_child_material", "No child material is available.");
  }
  const childRuns = record.agentRunTree.childRuns;
  if (childRuns.length === 0) {
    throw new MultiAgentFeatureError("resynthesis_no_child_runs", "No child runs are available.");
  }
  const childRuntime = await createExistingMultiAgentTurnRuntime(
    feature,
    acquireRunResources,
    record,
  );
  try {
    const synthesis = await synthesizeDeepConclusion({
      turnRuntime: childRuntime.turnRuntime,
      traceId: childRuntime.taskSoil.traceId ?? record.run.runId,
      goalId: childRuntime.taskSoil.goalId ?? record.run.conversationId,
      runId: record.run.runId,
      goal: record.run.goal,
      taskSoil: childRuntime.taskSoil,
      childSummaries,
      completedChildRuns: childRuns,
      evidenceRefs: collectDeepChildEvidenceRefs(childSummaries),
      inputRefs: buildDeepResynthesisInputRefs(record),
      maxModelRounds: DEEP_MANAGER_MAX_MODEL_ROUNDS,
      maxToolRounds: DEEP_MANAGER_MAX_TOOL_ROUNDS,
      createdAt: nowIso(),
    });
    return applyDeepResynthesisResult(feature, record, synthesis);
  } finally {
    await childRuntime.releaseResources();
  }
}

async function requireMultiAgentConversation(
  feature: MultiAgentFeatureRuntime,
  conversationId: string,
): Promise<DeepConversation> {
  const conversation = await feature.conversationStore.get(conversationId);
  if (conversation === undefined) {
    throw new MultiAgentFeatureError(
      "conversation_not_found",
      "Multi-Agent conversation was not found.",
    );
  }
  return conversation;
}

async function deleteMultiAgentConversation(
  feature: MultiAgentFeatureRuntime,
  conversationId: string,
): Promise<void> {
  await requireMultiAgentConversation(feature, conversationId);
  if (feature.hasActiveRunForConversation(conversationId)) {
    throw new MultiAgentFeatureError(
      "conversation_busy",
      "Multi-Agent conversation still has an active run.",
    );
  }
  // Deletion is an ownership cleanup, not a recent-history query. Read every
  // run so old child contexts and process-local output owners cannot be left
  // behind after newer runs push them outside a presentation limit.
  const records = await feature.runRecordStore.listByConversation(conversationId);
  if (records.some((record) => record.run.status === "running")) {
    throw new MultiAgentFeatureError(
      "conversation_busy",
      "Multi-Agent conversation still has a non-terminal run.",
    );
  }
  for (const record of records) {
    await feature.runRecordStore.delete(record.run.runId);
    await feature.childMessageStore.deleteForRun(record.run.runId);
    await feature.childLoopContextStore.deleteForRun(record.run.runId);
    await feature.releaseToolOutputOwner(multiAgentToolOutputOwnerId(record.run.runId));
    feature.forgetRun(record.run.runId);
  }
  await feature.conversationStore.delete(conversationId);
}

async function nextMultiAgentTurnOrdinal(
  feature: MultiAgentFeatureRuntime,
  rootRunId: string,
): Promise<number> {
  // Turn ordinals are durable lineage facts. Presentation history limits must
  // not make an older root disappear and cause a later turn to reuse ordinal 1.
  const records = await feature.runRecordStore.listByRootRun(rootRunId);
  const maxOrdinal = records.reduce((max, record) => {
    const sameChain = (record.run.rootRunId ?? record.run.runId) === rootRunId;
    if (!sameChain) {
      return max;
    }
    const ordinal = record.run.turnOrdinal ?? (record.run.runId === rootRunId ? 1 : 0);
    return Math.max(max, ordinal);
  }, 0);
  return Math.max(1, maxOrdinal + 1);
}

async function requestMultiAgentRunControl(
  feature: MultiAgentFeatureRuntime,
  input: {
    readonly runId: string;
    readonly action: "interrupt" | "correct" | "stop";
    readonly reason?: string;
    readonly correctionContext?: readonly string[];
  },
): Promise<{ readonly status: "requested"; readonly record?: DeepRunRecord }> {
  const record = await feature.runRecordStore.get(input.runId);
  if (record !== undefined && record.run.status !== "running") {
    throw new MultiAgentFeatureError(
      "run_not_active",
      "Multi-Agent run already reached a terminal status.",
    );
  }
  const handle = feature.controlHandleForRun(input.runId);
  if (handle === undefined) {
    const stopped = input.action === "stop"
      ? await stopOrphanedMultiAgentRun(feature, input.runId, input.reason)
      : undefined;
    if (stopped !== undefined) {
      return { status: "requested", record: stopped };
    }
    throw new MultiAgentFeatureError(
      "run_control_not_found",
      "Multi-Agent run has no active control handle.",
    );
  }
  if (input.action === "interrupt") {
    handle.requestInterrupt(input.reason);
  } else if (input.action === "stop") {
    handle.requestStop(input.reason);
  } else {
    const correctionContext = input.correctionContext ?? [];
    await persistMultiAgentRunFollowUp(feature, input.runId, correctionContext);
    handle.requestCorrect(correctionContext, input.reason);
  }
  return { status: "requested" };
}

async function persistMultiAgentRunFollowUp(
  feature: MultiAgentFeatureRuntime,
  runId: string,
  correctionContext: readonly string[],
): Promise<void> {
  const conversationId = feature.activeConversationIdForRun(runId);
  if (conversationId === undefined) {
    return;
  }
  const conversation = await feature.conversationStore.get(conversationId);
  if (conversation === undefined) {
    return;
  }
  await feature.conversationStore.upsert(
    appendDeepRunFollowUpTurn(
      conversation,
      createDeepRunFollowUpTurn({ runId, correctionContext, createdAt: nowIso() }),
    ),
  );
}

async function stopOrphanedMultiAgentRun(
  feature: MultiAgentFeatureRuntime,
  runId: string,
  reason: string | undefined,
): Promise<DeepRunRecord | undefined> {
  const record = await feature.runRecordStore.get(runId);
  if (record === undefined || record.run.status !== "running" || feature.isRunActive(runId)) {
    return undefined;
  }
  const updatedAt = nowIso();
  const stoppedEvent: DeepRunStreamEvent = {
    id: createId("deep-event"),
    runId,
    sequence: (record.eventSequence.at(-1)?.sequence ?? 0) + 1,
    type: "deep.stopped",
    title: "运行已停止",
    summary: reason ?? "该多 Agent 运行已失联，用户已停止本次运行。",
    status: "stopped",
    timestamp: updatedAt,
    refs: [],
    visibility: "public",
  };
  const updated: DeepRunRecord = {
    ...record,
    run: { ...record.run, status: "stopped", updatedAt },
    agentRunTree: { ...record.agentRunTree, status: "stopped", updatedAt },
    eventSequence: [...record.eventSequence, stoppedEvent],
    liveProjection: {
      ...(record.liveProjection ?? fallbackLiveProjectionForRecord(record)),
      phase: "stopped",
      updatedAt,
    },
    updatedAt,
  };
  await feature.runRecordStore.upsert(updated);
  feature.forgetRun(runId);
  return updated;
}

async function requireMultiAgentRunRecord(
  feature: MultiAgentFeatureRuntime,
  runId: string,
): Promise<DeepRunRecord> {
  const record = await feature.runRecordStore.get(runId);
  if (record === undefined) {
    throw new MultiAgentFeatureError("run_not_found", "Multi-Agent run was not found.");
  }
  return record;
}

function requireMultiAgentContinuationFacts(
  record: DeepRunRecord,
): NonNullable<DeepRunRecord["run"]["continuationFacts"]> {
  if (
    record.run.continuationFacts === undefined ||
    record.run.continuationFacts.taskSoilInput === undefined
  ) {
    throw new MultiAgentFeatureError(
      "run_continuation_facts_missing",
      "Multi-Agent run has no durable continuation facts.",
    );
  }
  return record.run.continuationFacts;
}

function isContinuableTerminalChildRejection(
  result: Exclude<DeepChildInstructionQueueResult, { readonly status: "queued" }>,
): boolean {
  return result.status === "not_accepting" &&
    (
      result.childStatus === "completed" ||
      result.childStatus === "failed" ||
      result.childStatus === "blocked" ||
      result.childStatus === "interrupted"
  );
}

function createMultiAgentOperationBus(): InMemoryMessageBus {
  return new InMemoryMessageBus(new InMemoryEventLog());
}

function mergeMultiAgentConversationTaskSoil(
  conversation: DeepConversation,
  taskSoilInput: DeepConversation["taskSoilInput"] | undefined,
  birthWorkspaceDirectory?: string,
): DeepConversation {
  const nextBirthWorkspaceDirectory = conversation.birthWorkspaceDirectory ?? birthWorkspaceDirectory;
  if (
    taskSoilInput === undefined &&
    nextBirthWorkspaceDirectory === conversation.birthWorkspaceDirectory
  ) {
    return conversation;
  }
  return {
    ...conversation,
    birthWorkspaceDirectory: nextBirthWorkspaceDirectory,
    taskSoilInput: taskSoilInput ?? conversation.taskSoilInput,
    permissionBoundaryRefs: taskSoilInput?.permissionBoundaryRefs ?? conversation.permissionBoundaryRefs,
    updatedAt: nowIso(),
  };
}

function appendMultiAgentIntakeTurn(
  conversation: DeepConversation,
  intake: DeepIntakeTurn,
): DeepConversation {
  return {
    ...conversation,
    intakeTurns: [...(conversation.intakeTurns ?? []), intake],
    updatedAt: intake.createdAt,
  };
}

async function persistCollaborationObjective(
  feature: MultiAgentFeatureRuntime,
  conversation: DeepConversation,
  intake: DeepIntakeTurn,
): Promise<DeepConversation> {
  if (intake.normalizedObjective === undefined) {
    throw new MultiAgentFeatureError(
      "intake_missing_objective",
      "Multi-Agent intake requested collaboration without a normalized objective.",
    );
  }
  return feature.conversationStore.upsert({
    ...conversation,
    currentObjective: intake.normalizedObjective,
    updatedAt: nowIso(),
  });
}

function confirmedMultiAgentIntakeContext(input: {
  readonly conversation: DeepConversation;
  readonly intakeTurnId?: string;
  readonly confirmedObjective?: string;
  readonly confirmedPlan?: string;
}): DeepIntakeContext | undefined {
  const sourceTurn = confirmedMultiAgentIntakeSourceTurn(input.conversation, input.intakeTurnId);
  if (
    sourceTurn === undefined &&
    input.confirmedObjective === undefined &&
    input.confirmedPlan === undefined
  ) {
    return undefined;
  }
  return {
    normalizedObjective: input.confirmedObjective ?? sourceTurn?.normalizedObjective ?? input.conversation.currentObjective,
    plan: input.confirmedPlan ?? sourceTurn?.plan,
    assistantMessage: sourceTurn?.assistantMessage ?? "用户已确认计划，开始深度研究。",
    uncertainty: sourceTurn?.uncertainty,
    confidence: sourceTurn?.confidence,
  };
}

function confirmedMultiAgentIntakeSourceTurn(
  conversation: DeepConversation,
  intakeTurnId: string | undefined,
): DeepIntakeTurn | undefined {
  return intakeTurnId === undefined
    ? [...(conversation.intakeTurns ?? [])].reverse().find((turn) => turn.action === "start_collaboration")
    : conversation.intakeTurns?.find((turn) => turn.turnId === intakeTurnId);
}

function multiAgentConversationGoal(conversation: DeepConversation): string {
  return conversation.currentObjective ?? conversation.goal;
}

function isTerminalMultiAgentRun(record: DeepRunRecord): boolean {
  return record.run.status !== "running";
}

function defaultBackgroundFailureReporter(input: {
  readonly runId: string;
  readonly conversationId: string;
  readonly error: unknown;
}): void {
  console.error(
    `[multi-agent] background run lifecycle failed for ${input.runId} (${input.conversationId})`,
    input.error,
  );
}

function reportMultiAgentBackgroundFailure(
  reporter: MultiAgentBackgroundFailureReporter,
  input: Parameters<MultiAgentBackgroundFailureReporter>[0],
): void {
  try {
    reporter(input);
  } catch (reporterError) {
    defaultBackgroundFailureReporter(input);
    defaultBackgroundFailureReporter({
      ...input,
      error: reporterError,
    });
  }
}

function deepContextMaintenance(
  goal: string,
  taskSoil: StartDeepRuntimeInput["taskSoil"],
  capabilitySnapshot: BasicAgentCapabilitySnapshot,
) {
  return {
    goal,
    traceId: taskSoil.traceId ?? "deep-run",
    goalId: taskSoil.goalId ?? "deep-goal",
    agentIdentity: {
      agentId: "deep-runtime",
      displayName: "DeepRuntime",
    },
    activeModel: capabilitySnapshot.activeModel.model,
    modelCapabilities: capabilitySnapshot.modelCapabilities,
  };
}
