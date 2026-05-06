import type { ArborMessage } from "../../domain/common.js";
import type { IntelligenceChannel } from "../../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../../domain/tools/index.js";
import {
  acceptGuardedAction,
  createGuardViolation,
  InMemoryMailbox,
  InMemoryWorkspace,
  rejectGuardedAction,
  type AgentActionOutput,
  type AgentDecision,
  type AgentLoop,
  type AgentPercept,
  type AgentRunContext,
  type GuardedActionOutput,
  type WorkspaceSnapshot,
} from "../../domain/underground/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/index.js";
import type { MinimalRuntime } from "../runtime.js";
import { UndergroundAgentRunner, type UndergroundAgentRunnerResult } from "./cluster/agent-runner.js";

const DIRECTION_SESSION_COMPATIBILITY_AGENT_ID = "underground-direction-session-compatibility-adapter";

type DirectionSessionGoalMessage = ArborMessage<{ readonly goalId: string; readonly goal: string }>;

export type UndergroundAgentOrchestratorOptions = {
  readonly runtime: MinimalRuntime;
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly enableAutonomy?: boolean;
  readonly maxAutonomyCycles?: number;
  readonly maxDispatchSteps?: number;
};

export type UndergroundAgentOrchestratorRunTrace = {
  readonly orchestratorRunId: string;
  readonly route: "agent_loop_compatibility_adapter";
  readonly agentLoopIds: readonly string[];
  readonly compatibilityPathUsed: boolean;
  readonly guardedStatus: GuardedActionOutput<DirectionSessionCompatibilityActionOutput>["status"];
  readonly outputRefs: readonly string[];
};

export type UndergroundAgentOrchestratorResult = UndergroundAgentRunnerResult & {
  readonly orchestratorRun: UndergroundAgentOrchestratorRunTrace;
};

type DirectionSessionWorkspaceData = Readonly<{
  route: "agent_loop_compatibility_adapter";
  dispatchResult?: UndergroundAgentRunnerResult;
}>;

type DirectionSessionWorkspaceSnapshot = WorkspaceSnapshot<DirectionSessionWorkspaceData>;

type DirectionSessionCompatibilityCapabilities = UndergroundAgentOrchestratorOptions & {
  readonly executionMode: "sync" | "async";
};

type DirectionSessionCompatibilityPercept = AgentPercept & {
  readonly goalMessage: DirectionSessionGoalMessage;
};

type DirectionSessionCompatibilityDecision = AgentDecision & {
  readonly goalMessage: DirectionSessionGoalMessage;
  readonly dispatchMode: "compatibility_runner";
};

type DirectionSessionCompatibilityActionOutput = AgentActionOutput & {
  readonly dispatchResult?: UndergroundAgentRunnerResult;
  readonly compatibilityPathUsed: boolean;
};

export class UndergroundAgentOrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundAgentOrchestratorError";
  }
}

export class UndergroundAgentOrchestrator {
  private readonly compatibilityAgent = new DirectionSessionCompatibilityAgent();

  constructor(private readonly options: UndergroundAgentOrchestratorOptions) {}

  run(goalMessage: DirectionSessionGoalMessage): UndergroundAgentOrchestratorResult {
    const ctx = this.createRunContext(goalMessage, "sync");
    const percept = this.compatibilityAgent.observe(ctx);
    const decision = this.compatibilityAgent.reason(ctx, percept);
    if (isPromiseLike(decision)) {
      throw new UndergroundAgentOrchestratorError("Synchronous underground orchestrator received async decision.");
    }
    const output = this.compatibilityAgent.act(ctx, decision);
    if (isPromiseLike(output)) {
      throw new UndergroundAgentOrchestratorError("Synchronous underground orchestrator received async action.");
    }
    const guarded = this.compatibilityAgent.guard(ctx, output);
    return this.completeRun(ctx.workspace as InMemoryWorkspace<DirectionSessionWorkspaceSnapshot>, guarded);
  }

  async runAsync(goalMessage: DirectionSessionGoalMessage): Promise<UndergroundAgentOrchestratorResult> {
    const ctx = this.createRunContext(goalMessage, "async");
    const percept = this.compatibilityAgent.observe(ctx);
    const decision = await this.compatibilityAgent.reason(ctx, percept);
    const output = await this.compatibilityAgent.act(ctx, decision);
    const guarded = this.compatibilityAgent.guard(ctx, output);
    return this.completeRun(ctx.workspace as InMemoryWorkspace<DirectionSessionWorkspaceSnapshot>, guarded);
  }

  private createRunContext(
    goalMessage: DirectionSessionGoalMessage,
    executionMode: "sync" | "async"
  ): AgentRunContext<DirectionSessionWorkspaceSnapshot, DirectionSessionCompatibilityCapabilities> {
    const mailbox = new InMemoryMailbox();
    mailbox.route({
      id: createId("agent-message"),
      traceId: goalMessage.traceId,
      fromAgentId: goalMessage.from.id,
      toAgentId: this.compatibilityAgent.agentId,
      type: goalMessage.type,
      payload: goalMessage,
      createdAt: goalMessage.createdAt,
      sourceRef: goalMessage.id,
    });
    const workspace = new InMemoryWorkspace<DirectionSessionWorkspaceSnapshot>({
      traceId: goalMessage.traceId,
      goalId: goalMessage.payload.goalId,
      goal: goalMessage.payload.goal,
      data: {
        route: "agent_loop_compatibility_adapter",
      },
    });
    return {
      workspace,
      mailbox,
      capabilities: {
        ...this.options,
        executionMode,
      },
    };
  }

  private completeRun(
    workspace: InMemoryWorkspace<DirectionSessionWorkspaceSnapshot>,
    guarded: GuardedActionOutput<DirectionSessionCompatibilityActionOutput>
  ): UndergroundAgentOrchestratorResult {
    if (guarded.status === "rejected") {
      const reason =
        guarded.guard.violations[0]?.message ??
        "Underground orchestrator rejected the compatibility adapter result.";
      throw new UndergroundAgentOrchestratorError(reason);
    }
    if (guarded.output.dispatchResult === undefined) {
      throw new UndergroundAgentOrchestratorError("Underground orchestrator completed without a dispatch result.");
    }
    workspace.patch(this.compatibilityAgent.agentId, {
      data: {
        route: "agent_loop_compatibility_adapter",
        dispatchResult: guarded.output.dispatchResult,
      },
    });
    return {
      ...guarded.output.dispatchResult,
      orchestratorRun: {
        orchestratorRunId: createId("underground-orchestrator-run"),
        route: "agent_loop_compatibility_adapter",
        agentLoopIds: [this.compatibilityAgent.agentId],
        compatibilityPathUsed: guarded.output.compatibilityPathUsed,
        guardedStatus: guarded.status,
        outputRefs: [...guarded.output.outputRefs],
      },
    };
  }
}

class DirectionSessionCompatibilityAgent
  implements
    AgentLoop<
      DirectionSessionCompatibilityPercept,
      DirectionSessionCompatibilityDecision,
      DirectionSessionCompatibilityActionOutput,
      DirectionSessionWorkspaceSnapshot,
      DirectionSessionCompatibilityCapabilities
    >
{
  readonly agentId = DIRECTION_SESSION_COMPATIBILITY_AGENT_ID;
  readonly protocol = {
    inputs: [
      {
        source: "mailbox",
        key: "goal.received",
        required: true,
      },
      {
        source: "workspace",
        key: "traceId",
        required: true,
      },
    ],
    outputs: [
      {
        type: "underground_agent_runner_result",
        payloadSchema: "underground.agent_loop.compatibility_result.v1",
      },
    ],
  } as const;

  observe(
    ctx: AgentRunContext<DirectionSessionWorkspaceSnapshot, DirectionSessionCompatibilityCapabilities>
  ): DirectionSessionCompatibilityPercept {
    const [message] = ctx.mailbox.drainByType(this.agentId, "goal.received");
    if (message === undefined) {
      throw new UndergroundAgentOrchestratorError("Compatibility agent requires a goal.received mailbox message.");
    }
    const goalMessage = message.payload as DirectionSessionGoalMessage;
    return {
      observedAt: nowIso(),
      inputRefs: [message.id, message.sourceRef ?? goalMessage.id],
      goalMessage,
    };
  }

  reason(
    _ctx: AgentRunContext<DirectionSessionWorkspaceSnapshot, DirectionSessionCompatibilityCapabilities>,
    percept: DirectionSessionCompatibilityPercept
  ): DirectionSessionCompatibilityDecision {
    return {
      decidedAt: nowIso(),
      rationaleRefs: ["adr-0021:first-slice:compatibility-adapter"],
      goalMessage: percept.goalMessage,
      dispatchMode: "compatibility_runner",
    };
  }

  act(
    ctx: AgentRunContext<DirectionSessionWorkspaceSnapshot, DirectionSessionCompatibilityCapabilities>,
    decision: DirectionSessionCompatibilityDecision
  ): DirectionSessionCompatibilityActionOutput | Promise<DirectionSessionCompatibilityActionOutput> {
    if (ctx.capabilities === undefined) {
      throw new UndergroundAgentOrchestratorError("Compatibility agent requires orchestrator capabilities.");
    }
    return ctx.capabilities.executionMode === "async"
      ? this.dispatchAsync(ctx.capabilities, decision.goalMessage)
      : this.dispatchSync(ctx.capabilities, decision.goalMessage);
  }

  guard(
    _ctx: AgentRunContext<DirectionSessionWorkspaceSnapshot, DirectionSessionCompatibilityCapabilities>,
    output: DirectionSessionCompatibilityActionOutput
  ): GuardedActionOutput<DirectionSessionCompatibilityActionOutput> {
    if (output.dispatchResult === undefined) {
      return rejectGuardedAction({
        output,
        violations: [
          createGuardViolation({
            code: "UNDERGROUND_ORCHESTRATOR_NO_TERMINAL_RESULT",
            message: "Compatibility runner reached idle state without a terminal underground result.",
          }),
        ],
      });
    }
    return acceptGuardedAction(output);
  }

  private dispatchSync(
    capabilities: DirectionSessionCompatibilityCapabilities,
    goalMessage: DirectionSessionGoalMessage
  ): DirectionSessionCompatibilityActionOutput {
    const runner = this.createRunner(capabilities);
    try {
      capabilities.runtime.bus.publish(goalMessage);
      const dispatchResult = runner.dispatchUntilIdle();
      return createCompatibilityActionOutput(dispatchResult);
    } finally {
      runner.dispose();
    }
  }

  private async dispatchAsync(
    capabilities: DirectionSessionCompatibilityCapabilities,
    goalMessage: DirectionSessionGoalMessage
  ): Promise<DirectionSessionCompatibilityActionOutput> {
    const runner = this.createRunner(capabilities);
    try {
      capabilities.runtime.bus.publish(goalMessage);
      const dispatchResult = await runner.dispatchUntilIdleAsync();
      return createCompatibilityActionOutput(dispatchResult);
    } finally {
      runner.dispose();
    }
  }

  private createRunner(capabilities: DirectionSessionCompatibilityCapabilities): UndergroundAgentRunner {
    return new UndergroundAgentRunner({
      runtime: capabilities.runtime,
      intelligenceChannel: capabilities.intelligenceChannel,
      toolCenter: capabilities.toolCenter,
      agentTurnRuntime: capabilities.agentTurnRuntime,
      enableAutonomy: capabilities.enableAutonomy,
      maxAutonomyCycles: capabilities.maxAutonomyCycles,
      maxDispatchSteps: capabilities.maxDispatchSteps,
    });
  }
}

function createCompatibilityActionOutput(
  dispatchResult: UndergroundAgentRunnerResult | undefined
): DirectionSessionCompatibilityActionOutput {
  return {
    dispatchResult,
    compatibilityPathUsed: true,
    outputRefs:
      dispatchResult === undefined
        ? []
        : [
            dispatchResult.undergroundReport.convergenceReport.reviewId,
            dispatchResult.directionHandoffPackageRef.packageId,
          ],
  };
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}
