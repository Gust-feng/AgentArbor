import type { TaskSpec, VerificationReport } from "../../domain/contracts.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { createMinimalVerificationReport } from "../minimal-verification.js";
import type { MinimalRuntime } from "../runtime.js";

export class Verifier {
  readonly agentId = "verifier";

  verify(task: TaskSpec, artifactIds: string[], traceId: string, runtime: MinimalRuntime): VerificationReport {
    const verification = createMinimalVerificationReport(task, artifactIds);
    runtime.bus.publish(
      createMessage({
        traceId,
        taskId: task.id,
        from: { id: this.agentId, role: "verification" },
        to: { role: "governance" },
        type: "verification.completed",
        intent: "complete_verification",
        payload: { verification },
      })
    );
    return verification;
  }
}
