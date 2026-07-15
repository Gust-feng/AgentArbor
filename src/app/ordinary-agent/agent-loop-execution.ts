import type { ModelMessage, ModelUsage } from "../../domain/intelligence/index.js";
import type { RunCapabilityResolution } from "../../domain/config/index.js";
import { executionErrorFacts } from "../execution-errors/index.js";
import type {
  AgentLoop,
  AgentLoopAgentTool,
  AgentLoopResult,
  AgentLoopToolBoundary,
} from "../model-runtime/index.js";
import type {
  OrdinaryExecutionContinuation,
  OrdinaryExecutionInput,
  OrdinaryExecutionOutcome,
  OrdinaryExecutionPort,
} from "./contracts.js";

export type AcquireOrdinaryAgentLoopRunResourcesInput = OrdinaryExecutionInput;

export type OrdinaryAgentLoopRunResources = {
  readonly loop: AgentLoop;
  /** Canonical messages with any request-scoped attachments resolved again. */
  readonly resolvedMessages: readonly ModelMessage[];
  readonly tools: AgentLoopToolBoundary;
  readonly agentTools?: readonly AgentLoopAgentTool[];
  readonly capabilityResolution?: RunCapabilityResolution;
  /** Releases every run-scoped resource created by the acquirer, including the loop. */
  release(): Promise<void>;
};

export interface OrdinaryAgentLoopRunResourceAcquirer {
  acquire(input: AcquireOrdinaryAgentLoopRunResourcesInput): Promise<OrdinaryAgentLoopRunResources>;
}

/**
 * Adapts the neutral model-tool loop to Ordinary's feature-owned execution outcomes.
 * SDK continuations remain live-only inside this lease and never enter durable state.
 */
export function createOrdinaryAgentLoopExecutionPort(input: {
  readonly resources: OrdinaryAgentLoopRunResourceAcquirer;
  readonly onReleaseError?: (error: unknown) => void;
}): OrdinaryExecutionPort {
  return {
    async execute(executionInput) {
      let resources: OrdinaryAgentLoopRunResources;
      try {
        resources = await input.resources.acquire(executionInput);
      } catch (error) {
        if (executionInput.abortSignal.aborted) {
          return {
            status: "cancelled",
            reason: cancellationReason(executionInput.abortSignal.reason),
            canonicalMessages: executionInput.messages,
            toolCalls: [],
            usage: {},
          };
        }
        const facts = executionErrorFacts(error);
        if (facts !== undefined) {
          return {
            status: "failed",
            error: facts,
            canonicalMessages: executionInput.messages,
            toolCalls: [],
            usage: {},
          };
        }
        throw error;
      }
      const lease = createResourceLease(resources);
      try {
        const result = await resources.loop.execute({
          instructions: executionInput.birth.instructions,
          messages: resources.resolvedMessages,
          tools: resources.tools,
          ...(resources.agentTools === undefined ? {} : { agentTools: resources.agentTools }),
          abortSignal: executionInput.abortSignal,
          onTextDelta: executionInput.onTextDelta,
          onToolResult: executionInput.onToolResult,
        });
        return await mapAgentLoopResult(result, lease, input.onReleaseError, {}, resources.capabilityResolution);
      } catch (error) {
        await releaseWithoutReplacingOutcome(lease, input.onReleaseError);
        throw error;
      }
    },
  };
}

function cancellationReason(value: unknown): string {
  return typeof value === "string" ? value : "cancelled";
}

type ResourceLease = {
  release(): Promise<void>;
};

function createResourceLease(resources: OrdinaryAgentLoopRunResources): ResourceLease {
  let releasePromise: Promise<void> | undefined;
  return {
    release() {
      releasePromise ??= Promise.resolve().then(() => resources.release());
      return releasePromise;
    },
  };
}

async function mapAgentLoopResult(
  result: AgentLoopResult,
  lease: ResourceLease,
  onReleaseError?: (error: unknown) => void,
  previousUsage: ModelUsage = {},
  capabilityResolution?: RunCapabilityResolution,
): Promise<OrdinaryExecutionOutcome> {
  const usage = latestCumulativeUsage(previousUsage, result.usage);
  const facts = {
    canonicalMessages: result.messages,
    toolCalls: result.toolResults,
    usage,
    ...(capabilityResolution === undefined ? {} : { capabilityResolution }),
  } as const;

  if (result.status === "approval_required") {
    return {
      ...facts,
      status: "approval_required",
      confirmationRequests: result.confirmationRequests,
      continuation: mapContinuation(result.continuation, lease, onReleaseError, usage, capabilityResolution),
    };
  }

  await releaseWithoutReplacingOutcome(lease, onReleaseError);
  if (result.status === "completed") {
    return { ...facts, status: "completed", answer: result.finalText };
  }
  if (result.status === "cancelled") {
    return { ...facts, status: "cancelled", reason: result.error ?? "cancelled" };
  }
  return {
    ...facts,
    status: "failed",
    error: { code: "agent_loop_failed", message: result.error },
  };
}

function mapContinuation(
  continuation: Extract<AgentLoopResult, { readonly status: "approval_required" }>["continuation"],
  lease: ResourceLease,
  onReleaseError?: (error: unknown) => void,
  previousUsage: ModelUsage = {},
  capabilityResolution?: RunCapabilityResolution,
): OrdinaryExecutionContinuation {
  let consumed = false;
  return {
    availability: "live_only",
    async decide(input) {
      if (consumed) throw new Error("Ordinary approval continuation has already been decided");
      consumed = true;
      try {
        return await mapAgentLoopResult(
          await continuation.decide(input),
          lease,
          onReleaseError,
          previousUsage,
          capabilityResolution,
        );
      } catch (error) {
        await releaseWithoutReplacingOutcome(lease, onReleaseError);
        throw error;
      }
    },
    release() {
      consumed = true;
      return releaseWithoutReplacingOutcome(lease, onReleaseError);
    },
  };
}

/** AgentLoop usage is cumulative; missing fields on a later failure must not erase prior observed totals. */
function latestCumulativeUsage(previous: ModelUsage, current: ModelUsage): ModelUsage {
  return { ...previous, ...current };
}

async function releaseWithoutReplacingOutcome(
  lease: ResourceLease,
  onReleaseError?: (error: unknown) => void,
): Promise<void> {
  try {
    await lease.release();
  } catch (error) {
    try {
      onReleaseError?.(error);
    } catch {
      // Diagnostics cannot replace the already-known model/tool outcome either.
    }
  }
}
