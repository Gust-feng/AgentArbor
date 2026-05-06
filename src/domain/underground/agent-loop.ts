import type { GuardedActionOutput } from "./guard.js";
import type { AgentMailbox } from "./mailbox.js";
import type { WorkspaceView } from "./workspace.js";
import type { Constraint, ConstraintRef } from "../constraints.js";
import type { ToolDefinition, ToolExecutionBroker } from "../tools/index.js";

export type AgentPercept = {
  readonly observedAt?: string;
  readonly inputRefs: readonly string[];
};

export type AgentDecision = {
  readonly decidedAt?: string;
  readonly rationaleRefs: readonly string[];
};

export type AgentActionOutput = {
  readonly outputRefs: readonly string[];
};

export type AgentReflection = {
  readonly reflectedAt?: string;
  readonly guardStatus: GuardedActionOutput<unknown>["status"];
  readonly outputRefs: readonly string[];
  readonly sourceRefs: readonly string[];
};

export type AgentNextDecision = {
  readonly action: "continue" | "stop" | "await_input";
  readonly decidedAt?: string;
  readonly reasonRefs: readonly string[];
};

export type AgentProtocol = {
  readonly inputs: readonly { source: "workspace" | "mailbox" | "event_log"; key: string; required: boolean }[];
  readonly outputs: readonly { type: string; payloadSchema: string }[];
};

export type AgentTurnRuntimeSurface = {
  execute(input: unknown): Promise<unknown>;
};

export type AgentMemoryView = {
  listRefs(scope?: string): readonly string[];
  read(ref: string): unknown;
};

export type AgentTraceWriter = {
  write(event: {
    readonly agentId: string;
    readonly phase: "observe" | "reason" | "act" | "guard" | "reflect" | "decide_next";
    readonly refs: readonly string[];
    readonly at: string;
  }): void;
};

export type AgentBudgetView = {
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly remainingModelRounds?: number;
  readonly remainingToolRounds?: number;
  readonly exhausted?: boolean;
};

export type AgentConstraintView = {
  readonly constraints: readonly Constraint[];
  readonly constraintRefs: readonly ConstraintRef[];
};

export type AgentToolSurface = {
  readonly tools: ToolExecutionBroker;
  listAllowedTools(agentId: string): readonly ToolDefinition[];
};

export type AgentRunContext<W, C = unknown> = {
  readonly workspace: WorkspaceView<W>;
  readonly mailbox: AgentMailbox;
  readonly capabilities?: C;
  readonly agentTurnRuntime?: AgentTurnRuntimeSurface;
  readonly toolSurface?: AgentToolSurface;
  readonly memoryView?: AgentMemoryView;
  readonly traceWriter?: AgentTraceWriter;
  readonly budgetView?: AgentBudgetView;
  readonly constraintView?: AgentConstraintView;
};

export interface AgentLoop<P, D, A, W, C = unknown> {
  readonly agentId: string;
  readonly protocol: AgentProtocol;
  observe(ctx: AgentRunContext<W, C>): P;
  reason(ctx: AgentRunContext<W, C>, percept: P): D | Promise<D>;
  act(ctx: AgentRunContext<W, C>, decision: D): A | Promise<A>;
  guard(ctx: AgentRunContext<W, C>, output: A): GuardedActionOutput<A>;
  reflect?(ctx: AgentRunContext<W, C>, output: A, guarded: GuardedActionOutput<A>): AgentReflection | Promise<AgentReflection>;
  decideNext?(ctx: AgentRunContext<W, C>, reflection: AgentReflection): AgentNextDecision | Promise<AgentNextDecision>;
  decide_next?(ctx: AgentRunContext<W, C>, reflection: AgentReflection): AgentNextDecision | Promise<AgentNextDecision>;
}

export async function runAgentLoopRound<P, D, A, W, C>(
  loop: AgentLoop<P, D, A, W, C>,
  context: Omit<AgentRunContext<W, C>, "capabilities"> & { readonly capabilities?: C },
): Promise<{
  readonly guarded: GuardedActionOutput<A>;
  readonly output: A;
  readonly reflection: AgentReflection;
  readonly nextDecision: AgentNextDecision;
}> {
  const ctx: AgentRunContext<W, C> = {
    ...context,
  };
  writeTrace(loop, ctx, "observe", []);
  const percept = loop.observe(ctx);
  writeTrace(loop, ctx, "reason", inputRefsFromPercept(percept));
  const decision = await loop.reason(ctx, percept);
  writeTrace(loop, ctx, "act", rationaleRefsFromDecision(decision));
  const output = await loop.act(ctx, decision);
  const guarded = loop.guard(ctx, output);
  writeTrace(loop, ctx, "guard", outputRefsFromAction(output));
  const reflection =
    loop.reflect === undefined
      ? defaultReflection(guarded.output, guarded)
      : await loop.reflect(ctx, guarded.output, guarded);
  writeTrace(loop, ctx, "reflect", reflection.sourceRefs);
  const decideNext = loop.decideNext ?? loop.decide_next;
  const nextDecision =
    decideNext === undefined
      ? defaultNextDecision(reflection)
      : await decideNext.call(loop, ctx, reflection);
  writeTrace(loop, ctx, "decide_next", nextDecision.reasonRefs);
  return { guarded, output: guarded.output, reflection, nextDecision };
}

function defaultReflection<A>(output: A, guarded: GuardedActionOutput<A>): AgentReflection {
  return {
    reflectedAt: new Date().toISOString(),
    guardStatus: guarded.status,
    outputRefs: outputRefsFromAction(output),
    sourceRefs: guarded.status === "fallback" ? guarded.fallbackSourceRefs : [],
  };
}

function defaultNextDecision(reflection: AgentReflection): AgentNextDecision {
  return {
    action: reflection.guardStatus === "accepted" ? "stop" : "await_input",
    decidedAt: new Date().toISOString(),
    reasonRefs: reflection.outputRefs,
  };
}

function writeTrace<W, C>(
  loop: Pick<AgentLoop<unknown, unknown, unknown, W, C>, "agentId">,
  ctx: AgentRunContext<W, C>,
  phase: Parameters<NonNullable<AgentTraceWriter["write"]>>[0]["phase"],
  refs: readonly string[],
): void {
  ctx.traceWriter?.write({
    agentId: loop.agentId,
    phase,
    refs: [...refs],
    at: new Date().toISOString(),
  });
}

function inputRefsFromPercept(value: unknown): string[] {
  return refsFromRecord(value, "inputRefs");
}

function rationaleRefsFromDecision(value: unknown): string[] {
  return refsFromRecord(value, "rationaleRefs");
}

function outputRefsFromAction(value: unknown): string[] {
  return refsFromRecord(value, "outputRefs");
}

function refsFromRecord(value: unknown, key: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const raw = (value as Readonly<Record<string, unknown>>)[key];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string");
}
