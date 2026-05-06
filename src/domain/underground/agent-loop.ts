import type { Mailbox } from "./mailbox.js";
import type { GuardedActionOutput } from "./guard.js";
import type { WorkspaceSnapshot, WorkspaceView } from "./workspace.js";

export type MaybePromise<T> = T | Promise<T>;

export type AgentProtocolInput = {
  readonly source: "workspace" | "mailbox" | "event_log";
  readonly key: string;
  readonly required: boolean;
};

export type AgentProtocolOutput = {
  readonly type: string;
  readonly payloadSchema: string;
};

export type AgentProtocol = {
  readonly inputs: readonly AgentProtocolInput[];
  readonly outputs: readonly AgentProtocolOutput[];
};

export type AgentRunContext<
  TWorkspaceSnapshot extends WorkspaceSnapshot = WorkspaceSnapshot,
  TCapabilities = unknown,
> = {
  readonly workspace: WorkspaceView<TWorkspaceSnapshot>;
  readonly mailbox: Mailbox;
  readonly capabilities?: TCapabilities;
};

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

export type AgentLoop<
  TPercept extends AgentPercept = AgentPercept,
  TDecision extends AgentDecision = AgentDecision,
  TActionOutput extends AgentActionOutput = AgentActionOutput,
  TWorkspaceSnapshot extends WorkspaceSnapshot = WorkspaceSnapshot,
  TCapabilities = unknown,
> = {
  readonly agentId: string;
  readonly protocol: AgentProtocol;
  observe(ctx: AgentRunContext<TWorkspaceSnapshot, TCapabilities>): TPercept;
  reason(ctx: AgentRunContext<TWorkspaceSnapshot, TCapabilities>, percept: TPercept): MaybePromise<TDecision>;
  act(ctx: AgentRunContext<TWorkspaceSnapshot, TCapabilities>, decision: TDecision): MaybePromise<TActionOutput>;
  guard(
    ctx: AgentRunContext<TWorkspaceSnapshot, TCapabilities>,
    output: TActionOutput
  ): GuardedActionOutput<TActionOutput>;
};

export type AgentLoopRoundResult<TOutput extends AgentActionOutput = AgentActionOutput> = {
  readonly percept: AgentPercept;
  readonly decision: AgentDecision;
  readonly output: TOutput;
  readonly guarded: GuardedActionOutput<TOutput>;
};

export async function runAgentLoopRound<
  TPercept extends AgentPercept,
  TDecision extends AgentDecision,
  TActionOutput extends AgentActionOutput,
  TWorkspaceSnapshot extends WorkspaceSnapshot,
  TCapabilities,
>(
  loop: AgentLoop<TPercept, TDecision, TActionOutput, TWorkspaceSnapshot, TCapabilities>,
  ctx: AgentRunContext<TWorkspaceSnapshot, TCapabilities>
): Promise<AgentLoopRoundResult<TActionOutput>> {
  const percept = loop.observe(ctx);
  const decision = await loop.reason(ctx, percept);
  const output = await loop.act(ctx, decision);
  const guarded = loop.guard(ctx, output);
  return {
    percept,
    decision,
    output,
    guarded,
  };
}

