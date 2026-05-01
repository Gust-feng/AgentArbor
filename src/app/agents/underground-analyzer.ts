import { createMessage } from "../../kernel/messages/create-message.js";
import { createMinimalDirectionMaterial } from "../minimal-direction.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DirectionOutput } from "./types.js";

export class UndergroundAnalyzer {
  readonly agentId = "underground-analyzer";

  analyze(goalId: string, goal: string, traceId: string, runtime: MinimalRuntime): DirectionOutput {
    const material = createMinimalDirectionMaterial({
      goalId,
      goal,
      producedByAgentId: this.agentId,
      constraints: runtime.constraints,
    });
    const directionHandoffPackage = runtime.directionHandoffPackageStore.save(material.directionHandoffPackage);

    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "underground_center" },
        to: { role: "aboveground_center" },
        type: "direction_handoff.completed",
        intent: "complete_direction_handoff",
        payload: {
          directionHandoff: material.directionHandoff,
          directionPackage: {
            packageId: directionHandoffPackage.manifest.packageId,
            directionId: directionHandoffPackage.manifest.directionId,
            version: directionHandoffPackage.manifest.directionVersion,
            status: directionHandoffPackage.manifest.status,
          },
        },
      })
    );

    return { ...material, directionHandoffPackage };
  }
}
