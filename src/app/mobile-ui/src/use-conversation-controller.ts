import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { errorMessage } from "./mobile-error";
import type { MobileRemoteState, RemoteMobileClient } from "./remote-client";

type ConversationControllerInput = {
  readonly client: RemoteMobileClient;
  readonly state: MobileRemoteState;
  readonly conversationId: string;
  readonly modelSelectionId?: string;
};

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set(["queued", "running", "awaiting_approval"]);

type ConversationSummary = MobileRemoteState["conversations"][number];

/**
 * Selects the run that may affect a Conversation surface. A missing activeRunId
 * is only tolerated for old snapshots when there is exactly one live candidate;
 * a completed historical run must never become the current UI state.
 */
export function selectConversationRun(
  conversation: ConversationSummary | undefined,
  runs: MobileRemoteState["runs"],
) {
  if (conversation === undefined) return undefined;
  if (conversation.activeRunId !== undefined) {
    return runs.find((run) => run.runId === conversation.activeRunId);
  }
  const candidates = runs.filter((run) => run.conversationId === conversation.conversationId && ACTIVE_RUN_STATUSES.has(run.status));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Owns the mobile Conversation interaction loop without turning it into a
 * second business runtime. Conversation and Run facts remain remote read-model
 * projections; this controller only coordinates local input and scroll state.
 */
export function useConversationController(input: ConversationControllerInput) {
  const [draft, setDraft] = useState("");
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string>();
  const [earlierCommandId, setEarlierCommandId] = useState<string>();
  const [initialPageCommandId, setInitialPageCommandId] = useState<string>();
  const [pageError, setPageError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "failed">("idle");
  const [submitCommandId, setSubmitCommandId] = useState<string>();
  const [cancelState, setCancelState] = useState<"idle" | "sending" | "submitted">("idle");
  const [cancelError, setCancelError] = useState<string | undefined>(undefined);
  const [cancelCommandId, setCancelCommandId] = useState<string>();
  const [hasUnreadLiveContent, setHasUnreadLiveContent] = useState(false);
  const requestedVersions = useRef(new Map<string, string>());
  const submittedMessage = useRef<string | undefined>(undefined);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followsLiveContent = useRef(true);
  const previousContentVersion = useRef<string | undefined>(undefined);
  const earlierScrollAnchor = useRef<{
    readonly beforeTurnId: string;
    readonly scrollHeight: number;
    readonly scrollTop: number;
  } | undefined>(undefined);

  const conversation = input.state.conversations.find((item) => item.conversationId === input.conversationId);
  const page = input.state.conversationPages[input.conversationId];
  const run = selectConversationRun(conversation, input.state.runs);
  const canCancel = run !== undefined && ["running", "queued", "awaiting_approval"].includes(run.status);

  useEffect(() => {
    setCancelState("idle");
    setCancelError(undefined);
    setCancelCommandId(undefined);
  }, [run?.runId, run?.status]);

  useEffect(() => {
    if (submitCommandId === undefined) return;
    const result = input.state.commandResults.find((candidate) => candidate.commandId === submitCommandId);
    if (result === undefined) return;
    setSubmitCommandId(undefined);
    if (result.status === "applied") {
      submittedMessage.current = undefined;
      setSubmitState("idle");
      return;
    }
    const message = submittedMessage.current;
    if (message !== undefined) setDraft((current) => current || message);
    submittedMessage.current = undefined;
    setSubmitState("failed");
    setSubmitError(result.error?.message ?? "电脑未能发送这条消息");
  }, [input.state.commandResults, submitCommandId]);

  useEffect(() => {
    if (cancelCommandId === undefined) return;
    const result = input.state.commandResults.find((candidate) => candidate.commandId === cancelCommandId);
    if (result === undefined) return;
    if (result.status === "applied") {
      setCancelState("submitted");
      return;
    }
    setCancelState("idle");
    setCancelError(result.error?.message ?? "电脑未能停止运行");
  }, [cancelCommandId, input.state.commandResults]);

  useEffect(() => {
    if (initialPageCommandId === undefined) return;
    const result = input.state.commandResults.find((candidate) => candidate.commandId === initialPageCommandId);
    if (result === undefined) return;
    setInitialPageCommandId(undefined);
    if (result.status === "applied") return;
    setPageError(result.error?.message ?? "电脑未能加载这段对话");
  }, [initialPageCommandId, input.conversationId, input.state.commandResults]);

  useEffect(() => {
    if (earlierCommandId === undefined) return;
    const result = input.state.commandResults.find((candidate) => candidate.commandId === earlierCommandId);
    if (result === undefined) return;
    setEarlierCommandId(undefined);
    setLoadingEarlier(false);
    if (result.status === "applied") return;
    setEarlierError(result.error?.message ?? "电脑未能加载更早内容");
  }, [earlierCommandId, input.state.commandResults]);

  useEffect(() => {
    if (conversation === undefined || !input.state.peerOnline || requestedVersions.current.get(conversation.conversationId) === conversation.updatedAt) return;
    setPageError(undefined);
    requestedVersions.current.set(conversation.conversationId, conversation.updatedAt);
    void input.client.requestConversationPage(conversation.conversationId).then(setInitialPageCommandId).catch(() => {
      setPageError("对话未能加载，请重试");
    });
  }, [conversation?.conversationId, conversation?.updatedAt, input.client, input.state.peerOnline]);

  const retryPage = async (): Promise<void> => {
    if (conversation === undefined || !input.state.peerOnline || initialPageCommandId !== undefined) return;
    setPageError(undefined);
    requestedVersions.current.set(conversation.conversationId, conversation.updatedAt);
    try {
      const commandId = await input.client.requestConversationPage(conversation.conversationId);
      setInitialPageCommandId(commandId);
    } catch {
      setPageError("对话未能加载，请重试");
    }
  };

  const submit = async (): Promise<void> => {
    const message = draft.trim();
    if (message.length === 0 || submitState === "sending") return;
    setSubmitError(undefined);
    setSubmitState("sending");
    submittedMessage.current = message;
    setDraft("");
    try {
      const commandId = await input.client.sendCommand({
        kind: "conversation.submit",
        conversationId: input.conversationId,
        message,
        ...(input.modelSelectionId === undefined ? {} : { modelSelectionId: input.modelSelectionId }),
      });
      setSubmitCommandId(commandId);
    } catch (cause) {
      submittedMessage.current = undefined;
      setDraft(message);
      setSubmitState("failed");
      setSubmitError(errorMessage(cause, "消息未能保存"));
    }
  };

  const changeDraft = (value: string): void => {
    setDraft(value);
    if (submitError !== undefined) setSubmitError(undefined);
    if (submitState === "failed") setSubmitState("idle");
  };

  const loadEarlier = async (): Promise<void> => {
    if (page?.nextBeforeTurnId === undefined || loadingEarlier) return;
    const transcript = transcriptRef.current;
    if (transcript !== null) {
      earlierScrollAnchor.current = {
        beforeTurnId: page.nextBeforeTurnId,
        scrollHeight: transcript.scrollHeight,
        scrollTop: transcript.scrollTop,
      };
    }
    setEarlierError(undefined);
    setLoadingEarlier(true);
    try {
      const commandId = await input.client.requestConversationPage(input.conversationId, page.nextBeforeTurnId);
      setEarlierCommandId(commandId);
    } catch {
      earlierScrollAnchor.current = undefined;
      setLoadingEarlier(false);
      setEarlierError("更早内容未能加载，请重试");
    }
  };

  const cancel = async (): Promise<void> => {
    if (run === undefined || !canCancel || !input.state.peerOnline || cancelState !== "idle") return;
    setCancelState("sending");
    setCancelError(undefined);
    try {
      const commandId = await input.client.sendCommand({ kind: "run.cancel", runId: run.runId });
      setCancelCommandId(commandId);
    } catch (cause) {
      setCancelState("idle");
      setCancelError(cause instanceof Error && cause.message.trim().length > 0 ? cause.message : "未能停止运行");
    }
  };

  const liveText = run?.visibleAssistantText?.trim() ?? "";
  const liveRun = run?.status === "running" || run?.status === "queued" || run?.status === "awaiting_approval";
  const liveTurnExists = page?.turns.some((turn) => turn.role === "assistant" && turn.runId === run?.runId) ?? false;
  const contentVersion = JSON.stringify({
    turns: page?.turns.map((turn) => [turn.turnId, turn.role, turn.content]),
    liveText,
  });

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript === null || previousContentVersion.current === contentVersion) return;
    const initial = previousContentVersion.current === undefined;
    previousContentVersion.current = contentVersion;
    const anchor = earlierScrollAnchor.current;
    if (anchor !== undefined && page?.beforeTurnId === anchor.beforeTurnId) {
      transcript.scrollTop = anchor.scrollTop + Math.max(0, transcript.scrollHeight - anchor.scrollHeight);
      earlierScrollAnchor.current = undefined;
      return;
    }
    if (initial || followsLiveContent.current) {
      transcript.scrollTop = transcript.scrollHeight;
      setHasUnreadLiveContent(false);
    } else {
      setHasUnreadLiveContent(true);
    }
  }, [contentVersion, page?.beforeTurnId]);

  const followLatestContent = (): void => {
    const transcript = transcriptRef.current;
    if (transcript === null) return;
    followsLiveContent.current = true;
    transcript.scrollTop = transcript.scrollHeight;
    setHasUnreadLiveContent(false);
  };

  const observeTranscriptScroll = (transcript: HTMLDivElement): void => {
    followsLiveContent.current = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 48;
    if (followsLiveContent.current) setHasUnreadLiveContent(false);
  };

  return {
    cancel,
    cancelError,
    cancelState,
    canCancel,
    conversation,
    draft,
    followLatestContent,
    hasUnreadLiveContent,
    liveRun,
    liveText,
    liveTurnExists,
    loadEarlier,
    earlierError,
    loadingEarlier,
    pageError,
    observeTranscriptScroll,
    page,
    run,
    setDraft: changeDraft,
    submit,
    retryPage,
    submitState,
    submitError,
    transcriptRef,
  };
}
