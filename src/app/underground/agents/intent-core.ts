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
import type { WorkspaceSnapshot } from "../../../domain/underground/index.js";
import { createGoalIntentProfileForMinimalUnderground } from "../../underground-goal-profile.js";
import { createMinimalUndergroundExplorationPlan } from "../../underground-rootlets.js";

export type IntentCorePercept = AgentPercept & {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly constraints: readonly Constraint[];
};

export type IntentCoreDecision = AgentDecision & {
  readonly goalIntentProfile: GoalIntentProfile;
  readonly explorationPlan: UndergroundExplorationPlan;
};

export type IntentCoreActionOutput = AgentActionOutput & {
  readonly goalIntentProfile: GoalIntentProfile;
  readonly explorationPlan: UndergroundExplorationPlan;
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
    { readonly constraints: readonly Constraint[] }
  > {
  readonly agentId = "underground-intent-core";
  readonly protocol = INTENT_CORE_PROTOCOL;

  observe(
    ctx: AgentRunContext<
      WorkspaceSnapshot<unknown>,
      { readonly constraints: readonly Constraint[] }
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

  reason(
    _ctx: AgentRunContext<
      WorkspaceSnapshot<unknown>,
      { readonly constraints: readonly Constraint[] }
    >,
    percept: IntentCorePercept,
  ): IntentCoreDecision {
    const goalIntentProfile = createGoalIntentProfileForMinimalUnderground({
      goalId: percept.goalId,
      rawGoal: percept.rawGoal,
      constraints: percept.constraints,
    });
    const explorationPlan = createMinimalUndergroundExplorationPlan(
      percept.goalId,
      goalIntentProfile,
    );
    return {
      rationaleRefs: [
        evidenceId(percept.goalId, "goal-intent"),
        "goal.received",
      ],
      decidedAt: new Date().toISOString(),
      goalIntentProfile,
      explorationPlan,
    };
  }

  act(
    _ctx: AgentRunContext<
      WorkspaceSnapshot<unknown>,
      { readonly constraints: readonly Constraint[] }
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
    };
  }

  guard(
    ctx: AgentRunContext<
      WorkspaceSnapshot<unknown>,
      { readonly constraints: readonly Constraint[] }
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
