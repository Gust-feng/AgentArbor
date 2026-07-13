import type { DeepChildParentMessageContext } from "./deep-child-run-contracts.js";
import {
  createDeepChildMessageRecord,
  type DeepChildMessageStore,
} from "./deep-child-messages.js";
import type {
  DeepChildExecutedQueuedInstruction,
  DeepChildInstructionRecord,
} from "./deep-child-scheduler-contracts.js";

/** Persist parent instructions and reconstruct the executed instruction history for child continuation. */
export async function persistDeepChildInstructionRecords(
  store: DeepChildMessageStore | undefined,
  runId: string,
  instructions: readonly DeepChildInstructionRecord[],
): Promise<void> {
  for (const instruction of instructions) {
    await persistDeepChildInstructionRecord(store, runId, instruction);
  }
}

export async function loadDeepChildParentMessageContext(
  store: DeepChildMessageStore | undefined,
  runId: string,
  childRunId: string,
  recordedInstructions: readonly DeepChildInstructionRecord[] = [],
): Promise<readonly DeepChildParentMessageContext[]> {
  const contexts = new Map<string, DeepChildParentMessageContext>();
  if (store === undefined) {
    return parentMessageContextsFromRecordedInstructions(childRunId, recordedInstructions);
  }
  const records = await store.listForChild(runId, childRunId);
  for (const record of records) {
    if (record.status !== "executed") {
      continue;
    }
    contexts.set(record.messageRef, {
      messageRef: record.messageRef,
      source: record.source,
      status: record.status,
      content: record.content,
      updatedAt: record.updatedAt,
    });
  }
  for (const context of parentMessageContextsFromRecordedInstructions(childRunId, recordedInstructions)) {
    contexts.set(context.messageRef, context);
  }
  return [...contexts.values()].sort(compareParentMessageContexts);
}

export async function persistExecutedQueuedChildMessages(
  store: DeepChildMessageStore | undefined,
  runId: string,
  instructions: readonly DeepChildExecutedQueuedInstruction[],
): Promise<void> {
  if (store === undefined || instructions.length === 0) {
    return;
  }
  await Promise.all(instructions.map((instruction) =>
    store.upsert(createDeepChildMessageRecord({
      runId,
      childRunId: instruction.childRunId,
      instructionId: instruction.instructionId,
      messageRef: instruction.messageRef,
      source: instruction.source,
      status: "executed",
      content: instruction.instruction,
      requestedAt: instruction.queuedAt,
      queuedAt: instruction.queuedAt,
      executedAt: instruction.executedAt,
    }))
  ));
}

export function persistDeepChildInstructionRecord(
  store: DeepChildMessageStore | undefined,
  runId: string,
  instruction: DeepChildInstructionRecord,
): Promise<void> {
  if (store === undefined) {
    return Promise.resolve();
  }
  return store.upsert(createDeepChildMessageRecord({
    runId,
    childRunId: instruction.childRunId,
    instructionId: instruction.instructionId,
    messageRef: instruction.messageRef,
    source: instruction.source,
    status: instruction.status,
    content: instruction.instruction,
    requestedAt: instruction.requestedAt,
    queuedAt: instruction.queuedAt,
    executedAt: instruction.executedAt,
    cancelledAt: instruction.cancelledAt,
  })).then(() => undefined);
}

function parentMessageContextsFromRecordedInstructions(
  childRunId: string,
  instructions: readonly DeepChildInstructionRecord[],
): readonly DeepChildParentMessageContext[] {
  return instructions
    .filter((instruction) =>
      instruction.childRunId === childRunId && instruction.status === "executed"
    )
    .map((instruction) => ({
      messageRef: instruction.messageRef,
      source: instruction.source,
      status: instruction.status,
      content: instruction.instruction,
      updatedAt: instruction.executedAt ?? instruction.queuedAt ?? instruction.requestedAt,
    }))
    .sort(compareParentMessageContexts);
}

function compareParentMessageContexts(
  left: DeepChildParentMessageContext,
  right: DeepChildParentMessageContext,
): number {
  const byTime = left.updatedAt.localeCompare(right.updatedAt);
  return byTime === 0 ? left.messageRef.localeCompare(right.messageRef) : byTime;
}
