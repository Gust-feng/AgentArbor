import type {
  ArborMessageType,
  DirectionHandoff,
  GrowthPlan,
  TaskSpec,
  VerificationReport,
} from "../../domain/contracts.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { createMinimalGovernanceOutput } from "../minimal-governance.js";
import type { MinimalRuntime } from "../runtime.js";
import type { GovernanceOutput } from "./types.js";

export class GovernanceReview {
  readonly agentId = "governance-review";
  private readonly eventTypes: ArborMessageType[] = [
    "fruit.proposed",
    "governance.review.completed",
    "run_memory.captured",
    "experience_candidate.proposed",
    "path_bias.suggested",
  ];

  review(
    directionHandoff: DirectionHandoff,
    growthPlan: GrowthPlan,
    task: TaskSpec,
    artifactIds: string[],
    verification: VerificationReport,
    traceId: string,
    runtime: MinimalRuntime,
    finalEventTypes?: ArborMessageType[]
  ): GovernanceOutput {
    const { fruit, runMemory, experienceCandidate, pathBias } = createMinimalGovernanceOutput({
      directionHandoff,
      growthPlan,
      task,
      artifactIds,
      verification,
      reviewingAgentId: this.agentId,
      finalEventTypes: finalEventTypes ?? [...runtime.eventLog.types(), ...this.eventTypes],
    });

    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "fruit.proposed",
        intent: "propose_fruit",
        payload: { fruit },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "governance.review.completed",
        intent: "complete_governance_review",
        payload: {
          fruitId: fruit.id,
          decision: "approved_for_soil_review",
          checks: ["permissions", "lineage", "version", "applicability", "retirement_path"],
        },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "run_memory.captured",
        intent: "capture_run_memory",
        payload: { runMemory },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "experience_candidate.proposed",
        intent: "propose_experience_candidate",
        payload: { experienceCandidate },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "path_bias.suggested",
        intent: "suggest_path_bias",
        payload: { pathBias },
      })
    );

    return { fruit, runMemory, experienceCandidate, pathBias };
  }
}
