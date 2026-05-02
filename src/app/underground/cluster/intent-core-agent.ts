import { evidenceId } from "../../../domain/underground/index.js";
import { createGoalIntentProfileForMinimalUnderground } from "../../underground-goal-profile.js";
import { createMinimalUndergroundExplorationPlan } from "../../underground-rootlets.js";
import { createUndergroundAgentClusterPlan, startUndergroundAgentInvocation } from "../../underground-agent-cluster-runtime.js";
import { completeUndergroundAgentInvocation } from "../../underground-agent-cluster-runtime.js";
import { publishUndergroundExplorationPlanned } from "../../underground-events.js";
import type { UndergroundAgent, UndergroundAgentContext } from "./agent-context.js";
import { ensureMessageFromAgent, readPayloadRecord, readRequiredString } from "./agent-context.js";

export class IntentCoreAgent implements UndergroundAgent {
  readonly agentId = "underground-intent-core";
  private subscriptions: Array<() => void> = [];

  start(ctx: UndergroundAgentContext): void {
    this.subscriptions.push(ctx.subscribe(this.agentId, "goal.received", (message) => this.handleGoalReceived(ctx, message)));
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
  }

  private handleGoalReceived(ctx: UndergroundAgentContext, message: Parameters<UndergroundAgentContext["subscribe"]>[2] extends (message: infer T) => unknown ? T : never): void {
    ensureMessageFromAgent(message, "user");
    const payload = readPayloadRecord(message);
    const goalId = readRequiredString(payload, "goalId", message.type);
    const rawGoal = readRequiredString(payload, "goal", message.type);
    const intentInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "intent_core",
      inputRefs: [goalId, message.id, "goal.received"],
    });
    const goalIntentProfile = createGoalIntentProfileForMinimalUnderground({
      goalId,
      rawGoal,
      constraints: ctx.runtime.constraints,
    });
    const completedIntentInvocation = completeUndergroundAgentInvocation(intentInvocation, [
      evidenceId(goalId, "goal-intent"),
    ]);
    const explorationPlan = createMinimalUndergroundExplorationPlan(goalId, goalIntentProfile);
    const agentClusterPlan = createUndergroundAgentClusterPlan({
      rawGoal,
      explorationPlan,
      goalIntentProfile,
    });

    ctx.shared.write(this.agentId, {
      traceId: message.traceId,
      goalId,
      rawGoal,
      goalIntentProfile,
      explorationPlan,
      agentClusterPlan,
      centerInvocations: [completedIntentInvocation],
    });

    publishUndergroundExplorationPlanned({
      runtime: ctx.runtime,
      traceId: message.traceId,
      agentId: completedIntentInvocation.agentId,
      plan: explorationPlan,
      agentCluster: {
        plan: agentClusterPlan,
        invocations: [completedIntentInvocation],
      },
    });
  }
}
