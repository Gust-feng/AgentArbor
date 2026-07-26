import type {
  ChildAgentRun,
  ChildAgentRunParentInstruction,
  ChildAgentRunParentReview,
} from "../../domain/underground/agent-fabric.js";
import {
  markChildAgentRunParentInstructionCancelled,
  markChildAgentRunParentInstructionExecuted,
  recordChildAgentRunParentInstruction,
  replaceChildAgentRunParentInstructions,
} from "../../domain/underground/agent-fabric.js";

/** Owns parent-to-child instruction history independently from scheduling state. */
export class DeepChildParentInstructionHistory {
  private readonly byChildRunId = new Map<string, readonly ChildAgentRunParentInstruction[]>();

  record(
    childRunId: string,
    childRun: ChildAgentRun | undefined,
    instruction: ChildAgentRunParentInstruction & { readonly childRunId?: string },
  ): ChildAgentRun | undefined {
    if (childRun === undefined) {
      const history = this.byChildRunId.get(childRunId) ?? [];
      const existingIndex = history.findIndex((item) => item.instructionId === instruction.instructionId);
      const next = cloneParentInstruction(instruction);
      this.byChildRunId.set(childRunId, existingIndex >= 0
        ? history.map((item, index) => index === existingIndex ? next : cloneParentInstruction(item))
        : [...history.map(cloneParentInstruction), next]);
      return undefined;
    }
    this.seed(childRun);
    const updated = recordChildAgentRunParentInstruction(this.apply(childRun), instruction);
    this.remember(updated);
    return updated;
  }

  markExecuted(
    childRunId: string,
    childRun: ChildAgentRun | undefined,
    instructionId: string,
    executedAt: string,
  ): ChildAgentRun | undefined {
    if (childRun === undefined) {
      this.replaceFallback(childRunId, instructionId, (instruction) => ({ ...instruction, status: "executed", executedAt }));
      return undefined;
    }
    const updated = markChildAgentRunParentInstructionExecuted(this.apply(childRun), instructionId, executedAt);
    this.remember(updated);
    return updated;
  }

  markCancelled(
    childRunId: string,
    childRun: ChildAgentRun | undefined,
    instructionId: string,
    cancelledAt: string,
  ): ChildAgentRun | undefined {
    if (childRun === undefined) {
      this.replaceFallback(childRunId, instructionId, (instruction) =>
        instruction.status === "queued" ? { ...instruction, status: "cancelled", cancelledAt } : cloneParentInstruction(instruction)
      );
      return undefined;
    }
    const updated = markChildAgentRunParentInstructionCancelled(this.apply(childRun), instructionId, cancelledAt);
    this.remember(updated);
    return updated;
  }

  /** Force a prepared instruction to cancelled when execution admission never completed. */
  markAdmissionRejected(
    childRunId: string,
    childRun: ChildAgentRun | undefined,
    instructionId: string,
    cancelledAt: string,
  ): ChildAgentRun | undefined {
    const reject = (instruction: ChildAgentRunParentInstruction): ChildAgentRunParentInstruction =>
      instruction.instructionId === instructionId
        ? {
            ...instruction,
            status: "cancelled",
            executedAt: undefined,
            cancelledAt,
          }
        : cloneParentInstruction(instruction);
    if (childRun === undefined) {
      const history = this.byChildRunId.get(childRunId) ?? [];
      this.byChildRunId.set(childRunId, history.map(reject));
      return undefined;
    }
    const applied = this.apply(childRun);
    const updated = replaceChildAgentRunParentInstructions(
      applied,
      (applied.parentInstructions ?? []).map(reject),
    );
    this.remember(updated);
    return updated;
  }

  apply(childRun: ChildAgentRun): ChildAgentRun {
    this.seed(childRun);
    return replaceChildAgentRunParentInstructions(childRun, this.byChildRunId.get(childRun.childRunId));
  }

  private seed(childRun: ChildAgentRun): void {
    if (!this.byChildRunId.has(childRun.childRunId)) {
      this.byChildRunId.set(childRun.childRunId, childRun.parentInstructions?.map(cloneParentInstruction) ?? []);
    }
  }

  private remember(childRun: ChildAgentRun): void {
    this.byChildRunId.set(childRun.childRunId, childRun.parentInstructions?.map(cloneParentInstruction) ?? []);
  }

  private replaceFallback(
    childRunId: string,
    instructionId: string,
    replace: (instruction: ChildAgentRunParentInstruction) => ChildAgentRunParentInstruction,
  ): void {
    const history = this.byChildRunId.get(childRunId) ?? [];
    this.byChildRunId.set(childRunId, history.map((instruction) =>
      instruction.instructionId === instructionId ? replace(instruction) : cloneParentInstruction(instruction)
    ));
  }
}

export function summarizeDeepChildParentInstruction(instruction: string): string {
  const normalized = instruction.replace(/\s+/g, " ").trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

export function deepChildParentInstructionMessageRef(instructionId: string): string {
  return `child_message:${instructionId}`;
}

export function cloneDeepChildParentReview(
  review: ChildAgentRunParentReview | undefined,
): ChildAgentRunParentReview | undefined {
  return review === undefined ? undefined : { ...review, evidenceRefs: [...review.evidenceRefs] };
}

function cloneParentInstruction(instruction: ChildAgentRunParentInstruction): ChildAgentRunParentInstruction {
  return { ...instruction, review: cloneDeepChildParentReview(instruction.review) };
}
