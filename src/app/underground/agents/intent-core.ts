import type {
  AgentLoop,
  AgentPercept,
  AgentDecision,
  AgentActionOutput,
  AgentProtocol,
  AgentRunContext,
  GoalIntentProfile,
  UndergroundExplorationPlan,
} from "../../../domain/underground/index.js";
import {
  acceptGuardedAction,
  rejectGuardedAction,
  createGuardViolation,
  evidenceId,
} from "../../../domain/underground/index.js";
import type { GuardedActionOutput } from "../../../domain/underground/index.js";
import type { Constraint } from "../../../domain/contracts.js";
import type { ModelMessage, ModelOutputContract } from "../../../domain/intelligence/index.js";
import type { WorkspaceSnapshot } from "../../../domain/underground/index.js";
import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { createGoalIntentProfileForMinimalUnderground } from "../../underground-goal-profile.js";
import { createMinimalUndergroundExplorationPlan } from "../../underground-rootlets.js";
import {
  fallbackReasoningTrace,
  reasonWithAgentTurn,
  reasoningTraceRefs,
  type UndergroundReasoningTraceEntry,
} from "./reasoning.js";

export type IntentCorePercept = AgentPercept & {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly constraints: readonly Constraint[];
};

export type IntentCoreDecision = AgentDecision & {
  readonly goalIntentProfile: GoalIntentProfile;
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

export type IntentCoreActionOutput = AgentActionOutput & {
  readonly goalIntentProfile: GoalIntentProfile;
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

type IntentCoreCapabilities = {
  readonly constraints: readonly Constraint[];
  readonly agentTurnRuntime?: AgentTurnRuntime;
};

const INTENT_CORE_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "mailbox", key: "goal.received", required: true },
    { source: "workspace", key: "constraints", required: false },
  ],
  outputs: [
    { type: "goal_intent_profile", payloadSchema: "GoalIntentProfile" },
    { type: "exploration_plan", payloadSchema: "UndergroundExplorationPlan" },
  ],
};

export class IntentCoreAgent implements
  AgentLoop<
    IntentCorePercept,
    IntentCoreDecision,
    IntentCoreActionOutput,
    WorkspaceSnapshot<unknown>,
    IntentCoreCapabilities
  > {
  readonly agentId = "underground-intent-core";
  readonly protocol = INTENT_CORE_PROTOCOL;

  observe(
    ctx: AgentRunContext<
      WorkspaceSnapshot<unknown>,
      IntentCoreCapabilities
    >,
  ): IntentCorePercept {
    const messages = ctx.mailbox.drainByType(this.agentId, "goal.received");
    const message = messages[0];
    const payload = message?.payload as Record<string, unknown> | undefined;
    const goalId = (payload?.goalId as string) ?? "";
    const rawGoal = (payload?.goal as string) ?? "";
    const constraints = ctx.capabilities?.constraints ?? [];
    return {
      inputRefs: message
        ? [goalId, message.id, "goal.received"]
        : [],
      observedAt: new Date().toISOString(),
      goalId,
      rawGoal,
      constraints,
    };
  }

  async reason(
    ctx: AgentRunContext<
      WorkspaceSnapshot<unknown>,
      IntentCoreCapabilities
    >,
    percept: IntentCorePercept,
  ): Promise<IntentCoreDecision> {
    const fallbackProfile = createGoalIntentProfileForMinimalUnderground({
      goalId: percept.goalId,
      rawGoal: percept.rawGoal,
      constraints: percept.constraints,
    });
    const ai = await reasonWithAgentTurn({
      agentId: this.agentId,
      agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
      traceId: ctx.workspace.snapshot().traceId,
      goalId: percept.goalId,
      purpose: "intent_profile",
      outputContract: INTENT_PROFILE_CONTRACT,
      callerRef: { kind: "goal", id: percept.goalId, label: "intent_profile" },
      inputRefs: [{ kind: "goal", id: percept.goalId }],
      inputRefIds: percept.inputRefs,
      messages: buildIntentProfileMessages(percept),
      constraints: percept.constraints,
      parse: (output) => parseIntentProfileOutput(output, fallbackProfile),
    });

    const goalIntentProfile = ai.value ?? fallbackProfile;
    const explorationPlan = createMinimalUndergroundExplorationPlan(percept.goalId, goalIntentProfile);
    const reasoningTrace =
      ai.reasoningTrace.length > 0
        ? ai.reasoningTrace
        : fallbackReasoningTrace({
            agentId: this.agentId,
            decisionSummary: "Intent Core used deterministic fallback goal profiling.",
            inputRefs: percept.inputRefs,
            fallbackRefs: ["deterministic_fallback"],
          });
    return {
      rationaleRefs: [
        evidenceId(percept.goalId, "goal-intent"),
        "goal.received",
        ...reasoningTraceRefs(reasoningTrace),
      ],
      decidedAt: new Date().toISOString(),
      goalIntentProfile,
      explorationPlan,
      source: ai.source,
      confidence: ai.confidence,
      reasoningTrace,
    };
  }

  act(
    _ctx: AgentRunContext<
      WorkspaceSnapshot<unknown>,
      IntentCoreCapabilities
    >,
    decision: IntentCoreDecision,
  ): IntentCoreActionOutput {
    return {
      outputRefs: [
        evidenceId(decision.goalIntentProfile.goalId, "goal-intent"),
        decision.explorationPlan.planId,
      ],
      goalIntentProfile: decision.goalIntentProfile,
      explorationPlan: decision.explorationPlan,
      source: decision.source,
      confidence: decision.confidence,
      reasoningTrace: decision.reasoningTrace,
    };
  }

  guard(
    ctx: AgentRunContext<
      WorkspaceSnapshot<unknown>,
      IntentCoreCapabilities
    >,
    output: IntentCoreActionOutput,
  ): GuardedActionOutput<IntentCoreActionOutput> {
    const violations = [];
    if (!output.goalIntentProfile.rawGoal.trim()) {
      violations.push(
        createGuardViolation({
          code: "intent_core:empty_goal",
          message: "Goal text must not be empty.",
          severity: "error",
        }),
      );
    }
    const constraints = ctx.capabilities?.constraints ?? [];
    const conflictingHard = findConflictingHardConstraints(constraints);
    if (conflictingHard.length > 0) {
      violations.push(
        createGuardViolation({
          code: "intent_core:conflicting_hard_constraints",
          message: `Hard constraints conflict: ${conflictingHard.join(", ")}.`,
          severity: "error",
        }),
      );
    }
    if (output.explorationPlan.budget.maxRootletClusters <= 0) {
      violations.push(
        createGuardViolation({
          code: "intent_core:zero_budget",
          message: "Exploration budget must allow at least one rootlet cluster.",
          severity: "error",
        }),
      );
    }
    if (output.explorationPlan.budget.maxCandidateOutputs <= 0) {
      violations.push(
        createGuardViolation({
          code: "intent_core:zero_candidate_budget",
          message: "Exploration budget must allow at least one candidate output.",
          severity: "warning",
        }),
      );
    }
    if (violations.some((v) => v.severity === "error")) {
      return rejectGuardedAction({ output, violations });
    }
    return acceptGuardedAction(output);
  }
}

const INTENT_PROFILE_CONTRACT: ModelOutputContract = {
  contractId: "underground.intent_profile.v1",
  outputKind: "explanation",
  format: "json_object",
  requiredFields: [
    "goalStatement",
    "keyConcepts",
    "domainConcepts",
    "nonGoals",
    "acceptanceCriteria",
    "assumptions",
    "riskHints",
    "constraintHints",
    "unknowns",
    "decisionSummary",
    "uncertainty",
    "confidence",
  ],
  requiredStringFields: ["goalStatement", "decisionSummary", "uncertainty"],
  visibleOutput: {
    fields: ["goalStatement", "decisionSummary", "uncertainty"],
    fieldTypes: {
      goalStatement: "string",
      decisionSummary: "string",
      uncertainty: "string",
    },
    maxFieldLength: 240,
  },
};

function buildIntentProfileMessages(percept: IntentCorePercept): readonly ModelMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are AgentArbor Underground Intent Core.",
        "Shape the user goal into a GoalIntentProfile candidate for parent agents.",
        "Return JSON only. Do not include chain-of-thought. Use decisionSummary for a short displayable decision summary and uncertainty for open concerns.",
        "Engineering guards will validate schema, hard constraints, and package boundaries; do not claim final approval.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Goal id: ${percept.goalId}`,
        `Raw goal: ${percept.rawGoal}`,
        "Hard constraints:",
        ...percept.constraints
          .filter((constraint) => constraint.level === "hard")
          .map((constraint) => `- ${constraint.id}: ${constraint.statement}`),
        "Return fields: goalStatement, keyConcepts, domainConcepts, nonGoals, acceptanceCriteria, assumptions, riskHints, constraintHints, unknowns, decisionSummary, uncertainty, confidence.",
      ].join("\n"),
    },
  ];
}

function parseIntentProfileOutput(output: unknown, fallback: GoalIntentProfile) {
  const record = asRecord(output);
  const goalStatement = stringOrUndefined(record.goalStatement) ?? fallback.goalStatement;
  return {
    ok: true as const,
    value: {
      ...fallback,
      goalStatement,
      keyConcepts: nonEmptyStringArray(record.keyConcepts, fallback.keyConcepts),
      domainConcepts: nonEmptyStringArray(record.domainConcepts, fallback.domainConcepts),
      nonGoals: stringArray(record.nonGoals, fallback.nonGoals),
      acceptanceCriteria: nonEmptyStringArray(record.acceptanceCriteria, fallback.acceptanceCriteria),
      assumptions: nonEmptyStringArray(record.assumptions, fallback.assumptions),
      riskHints: stringArray(record.riskHints, fallback.riskHints),
      constraintHints: stringArray(record.constraintHints, fallback.constraintHints),
      unknowns: stringArray(record.unknowns, fallback.unknowns),
    },
    decisionSummary: stringOrUndefined(record.decisionSummary) ?? `Intent profile shaped for ${goalStatement}.`,
    uncertainty: stringOrUndefined(record.uncertainty),
    confidence: numberOrUndefined(record.confidence),
  };
}

function findConflictingHardConstraints(
  constraints: readonly Constraint[],
): string[] {
  const hard = constraints.filter(
    (c) => c.level === "hard" && c.status === "active",
  );
  const byAppliesTo = new Map<string, Constraint[]>();
  for (const c of hard) {
    for (const target of c.appliesTo) {
      const group = byAppliesTo.get(target) ?? [];
      group.push(c);
      byAppliesTo.set(target, group);
    }
  }
  const conflicting: string[] = [];
  for (const [, group] of byAppliesTo) {
    if (group.length < 2) continue;
    const blockCount = group.filter(
      (c) => c.conflictPolicy === "block",
    ).length;
    if (blockCount >= 2) {
      conflicting.push(
        ...group.map((c) => c.id),
      );
    }
  }
  return [...new Set(conflicting)];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return uniqueStrings(value.filter((item): item is string => typeof item === "string"));
}

function nonEmptyStringArray(value: unknown, fallback: readonly string[]): string[] {
  const parsed = stringArray(value, []);
  return parsed.length > 0 ? parsed : [...fallback];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
