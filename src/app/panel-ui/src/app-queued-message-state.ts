import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskStatus } from "./contracts/common.js";

/** Node-testable queue fact; the Panel composer projects it into its own props contract. */
export type QueuedChatMessage = {
  readonly id: string;
  readonly content: string;
};

export type AppQueuedMessageState = {
  readonly queuedMessages: readonly QueuedChatMessage[];
  readonly enqueueMessage: (content: string) => void;
  readonly removeQueuedMessage: (id: string) => void;
  readonly updateQueuedMessage: (id: string, content: string) => void;
  readonly guideQueuedMessage: (id: string) => Promise<boolean>;
};

export type AppQueuedMessageStateOptions = {
  readonly busy: boolean;
  readonly currentRun: QueuedMessageDispatchRun | undefined;
  readonly startTask: (explicitGoal?: string) => Promise<boolean>;
};

export type QueuedMessageDispatchRun = {
  readonly runId: string;
  readonly status: TaskStatus;
  readonly requiresUserAction: boolean;
};

export type QueuedMessageDispatchDecision =
  | { readonly kind: "none" }
  | {
      readonly kind: "dispatch";
      readonly message: QueuedChatMessage;
      readonly sourceRunId: string;
    };

export function queuedMessageDispatchDecision(input: {
  readonly busy: boolean;
  readonly currentRun: QueuedMessageDispatchRun | undefined;
  readonly queuedMessages: readonly QueuedChatMessage[];
  readonly dispatchedAfterRunId: string | undefined;
}): QueuedMessageDispatchDecision {
  const settledRun = input.currentRun;
  if (
    input.busy ||
    settledRun === undefined ||
    !queuedMessageMayFollow(settledRun) ||
    input.dispatchedAfterRunId === settledRun.runId
  ) {
    return { kind: "none" };
  }
  const message = input.queuedMessages[0];
  if (message === undefined) {
    return { kind: "none" };
  }
  return {
    kind: "dispatch",
    message,
    sourceRunId: settledRun.runId,
  };
}

export function useAppQueuedMessages(
  options: AppQueuedMessageStateOptions,
): AppQueuedMessageState {
  const [queuedMessages, setQueuedMessages] = useState<readonly QueuedChatMessage[]>([]);
  const dispatchedQueueAfterRunRef = useRef<string | undefined>(undefined);
  const guidedAfterRunRef = useRef<string | undefined>(undefined);

  const enqueueMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    setQueuedMessages((previous) => [
      ...previous,
      { id: crypto.randomUUID(), content: trimmed },
    ]);
  }, []);

  const removeQueuedMessage = useCallback((id: string) => {
    setQueuedMessages((previous) => previous.filter((message) => message.id !== id));
  }, []);

  const updateQueuedMessage = useCallback((id: string, content: string) => {
    setQueuedMessages((previous) =>
      previous.map((message) => message.id === id ? { ...message, content } : message),
    );
  }, []);

  const guideQueuedMessage = useCallback(async (id: string): Promise<boolean> => {
    const run = options.currentRun;
    if (run === undefined || !queuedMessageCanGuide(run)) return false;
    if (guidedAfterRunRef.current === run.runId) return false;
    const message = queuedMessages.find((candidate) => candidate.id === id);
    if (message === undefined) return false;

    guidedAfterRunRef.current = run.runId;
    const accepted = await options.startTask(message.content);
    if (accepted) {
      setQueuedMessages((previous) => previous.filter((candidate) => candidate.id !== id));
    } else if (guidedAfterRunRef.current === run.runId) {
      guidedAfterRunRef.current = undefined;
    }
    return accepted;
  }, [options.currentRun, options.startTask, queuedMessages]);

  useEffect(() => {
    const decision = queuedMessageDispatchDecision({
      busy: options.busy,
      currentRun: options.currentRun,
      queuedMessages,
      dispatchedAfterRunId: dispatchedQueueAfterRunRef.current,
    });
    if (decision.kind !== "dispatch") return;
    // A settled run may remain visible across several renders. Bind one
    // dispatch to that run id so StrictMode and unrelated renders cannot send
    // the same or subsequent queued message early.
    dispatchedQueueAfterRunRef.current = decision.sourceRunId;
    void options.startTask(decision.message.content).then((accepted) => {
      if (accepted) {
        setQueuedMessages((previous) =>
          previous[0]?.id === decision.message.id
            ? previous.slice(1)
            : previous.filter((message) => message.id !== decision.message.id)
        );
      } else if (dispatchedQueueAfterRunRef.current === decision.sourceRunId) {
        dispatchedQueueAfterRunRef.current = undefined;
      }
    });
  }, [options.busy, options.currentRun, options.startTask, queuedMessages]);

  return {
    queuedMessages,
    enqueueMessage,
    removeQueuedMessage,
    updateQueuedMessage,
    guideQueuedMessage,
  };
}

function queuedMessageMayFollow(run: QueuedMessageDispatchRun): boolean {
  return !run.requiresUserAction &&
    (run.status === "completed" || run.status === "failed" ||
      run.status === "cancelled" || run.status === "blocked");
}

function queuedMessageCanGuide(run: QueuedMessageDispatchRun): boolean {
  return !run.requiresUserAction &&
    (run.status === "queued" || run.status === "planning" || run.status === "running");
}
