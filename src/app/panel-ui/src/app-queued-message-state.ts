import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BasicAgentRun } from "./contracts/run";

export type QueuedChatMessage = {
  readonly id: string;
  readonly content: string;
};

export type AppQueuedMessageState = {
  readonly queuedMessages: readonly QueuedChatMessage[];
  readonly enqueueMessage: (content: string) => void;
  readonly removeQueuedMessage: (id: string) => void;
  readonly updateQueuedMessage: (id: string, content: string) => void;
  readonly clearQueuedMessages: () => void;
};

export type AppQueuedMessageStateOptions = {
  readonly busy: boolean;
  readonly currentRun: BasicAgentRun | undefined;
  readonly modelResponding: boolean;
  readonly setGoal: Dispatch<SetStateAction<string>>;
  readonly startTask: (explicitGoal?: string) => Promise<void>;
};

export function useAppQueuedMessages(
  options: AppQueuedMessageStateOptions,
): AppQueuedMessageState {
  const [queuedMessages, setQueuedMessages] = useState<readonly QueuedChatMessage[]>([]);
  const previousRunActivityRef = useRef<{ readonly runId?: string; readonly responding: boolean }>({ responding: false });
  const queueReadyAfterRunRef = useRef<string | undefined>(undefined);
  const dispatchedQueueAfterRunRef = useRef<string | undefined>(undefined);

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

  const clearQueuedMessages = useCallback(() => {
    queueReadyAfterRunRef.current = undefined;
    dispatchedQueueAfterRunRef.current = undefined;
    setQueuedMessages([]);
  }, []);

  useEffect(() => {
    const previousRunActivity = previousRunActivityRef.current;
    const activeRun = options.currentRun;
    previousRunActivityRef.current = {
      runId: activeRun?.runId,
      responding: options.modelResponding,
    };
    if (!previousRunActivity.responding || options.modelResponding) return;
    if (activeRun === undefined || activeRun.runId !== previousRunActivity.runId) return;
    queueReadyAfterRunRef.current = activeRun.status === "completed" ? activeRun.runId : undefined;
  }, [options.currentRun, options.modelResponding]);

  useEffect(() => {
    const readyRunId = queueReadyAfterRunRef.current;
    if (readyRunId === undefined || options.busy) return;
    if (options.currentRun?.runId !== readyRunId) return;
    if (dispatchedQueueAfterRunRef.current === readyRunId) return;
    if (queuedMessages.length === 0) return;
    const next = queuedMessages[0];
    if (next === undefined) return;
    dispatchedQueueAfterRunRef.current = readyRunId;
    queueReadyAfterRunRef.current = undefined;
    setQueuedMessages((previous) => previous.slice(1));
    options.setGoal(next.content);
    void options.startTask(next.content);
  }, [options.busy, options.currentRun, options.setGoal, options.startTask, queuedMessages]);

  return {
    queuedMessages,
    enqueueMessage,
    removeQueuedMessage,
    updateQueuedMessage,
    clearQueuedMessages,
  };
}
