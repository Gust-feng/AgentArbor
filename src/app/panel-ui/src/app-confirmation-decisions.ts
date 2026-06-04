import { postJson } from "./api";
import { createRunReadModelPatch } from "./app-run-projection";
import { shouldKeepRefreshing } from "./app-runtime-controls";
import type { AppState } from "./app-state";
import { emptyLiveRun } from "../../panel-ui-live-run-buffer";
import {
  safeBasicRun,
  safeDesktopDetail,
  safeWorkSession,
} from "./runtime";
import type { BasicAgentRun } from "./contracts/run";

export type ConfirmationDecision = "approve_once" | "deny" | "guidance";

type SetApp = (update: (previous: AppState) => AppState) => void;

export async function decideRunConfirmation(input: {
  readonly app: AppState;
  readonly currentRunId: string | undefined;
  readonly decision: ConfirmationDecision;
  readonly guidance?: string;
  readonly confirmationBusy: boolean;
  readonly setConfirmationBusy: (busy: boolean) => void;
  readonly setApp: SetApp;
  readonly mountedRef: { readonly current: boolean };
  readonly refreshConversations: () => Promise<void>;
  readonly startLiveUpdates: (runId: string, cursor: number) => void;
}): Promise<void> {
  const confirmation = pendingConfirmationFromApp(input.app);
  if (input.currentRunId === undefined || confirmation === undefined || input.confirmationBusy) return;
  const currentRunId = input.currentRunId;
  if (input.app.run?.status !== "approval_needed") {
    await refreshRunAfterConfirmationSettled({
      runId: currentRunId,
      mountedRef: input.mountedRef,
      setApp: input.setApp,
      refreshConversations: input.refreshConversations,
    });
    return;
  }
  const localError = localConfirmationDecisionError(input.decision, confirmation.resumeAvailability, input.guidance);
  if (localError !== undefined) {
    input.setApp((previous) => ({ ...previous, error: localError }));
    return;
  }
  input.setConfirmationBusy(true);
  input.setApp((previous) => ({ ...previous, error: undefined }));

  try {
    const response = await postJson<{ readonly run: BasicAgentRun }>(
      `/api/basic-agent/runs/${encodeURIComponent(currentRunId)}/confirmations/${encodeURIComponent(confirmation.confirmationId)}/decision`,
      { decision: input.decision, guidance: input.guidance?.trim() }
    );
    const [workSession, detail] = await Promise.all([
      safeWorkSession(currentRunId),
      safeDesktopDetail(currentRunId),
    ]);
    const shouldResumeLiveUpdates = shouldKeepRefreshing(response.run.status);
    input.setApp((previous) => {
      const readModel = createRunReadModelPatch(previous, { runId: currentRunId, workSession, detail });
      return {
        ...previous,
        run: response.run,
        live: shouldResumeLiveUpdates ? emptyLiveRun(currentRunId) : previous.live,
        error: undefined,
        ...readModel,
      };
    });
    if (shouldResumeLiveUpdates) {
      input.startLiveUpdates(currentRunId, response.run.eventCursor.lastSequence);
    }
    void input.refreshConversations();
  } catch (error) {
    if (isStaleConfirmationError(error)) {
      await refreshRunAfterConfirmationSettled({
        runId: currentRunId,
        mountedRef: input.mountedRef,
        setApp: input.setApp,
        refreshConversations: input.refreshConversations,
      });
      return;
    }
    input.setApp((previous) => ({
      ...previous,
      error: `提交确认失败：${error instanceof Error ? error.message : "请重试。"}`,
    }));
  } finally {
    input.setConfirmationBusy(false);
  }
}

function pendingConfirmationFromApp(app: AppState) {
  return app.workSession?.pendingConfirmation ?? app.detail?.canvas?.agent?.pendingConfirmation;
}

function localConfirmationDecisionError(
  decision: ConfirmationDecision,
  resumeAvailability: "live" | "lost_after_restart" | undefined,
  guidance: string | undefined
): string | undefined {
  if (decision === "approve_once" && resumeAvailability === "lost_after_restart") {
    return "应用重启后无法继续原操作。请补充指导或重新发起后续任务。";
  }
  if (decision === "guidance" && (guidance ?? "").trim().length === 0) {
    return "请先输入补充指导，再提交。";
  }
  return undefined;
}

async function refreshRunAfterConfirmationSettled(input: {
  readonly runId: string;
  readonly mountedRef: { readonly current: boolean };
  readonly setApp: SetApp;
  readonly refreshConversations: () => Promise<void>;
}): Promise<void> {
  const [run, workSession, detail] = await Promise.all([
    safeBasicRun(input.runId),
    safeWorkSession(input.runId),
    safeDesktopDetail(input.runId),
  ]);
  if (!input.mountedRef.current) return;
  input.setApp((previous) => {
    const readModel = createRunReadModelPatch(previous, { runId: input.runId, workSession, detail });
    return {
      ...previous,
      run: run ?? previous.run,
      error: undefined,
      ...readModel,
    };
  });
  void input.refreshConversations();
}

function isStaleConfirmationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /没有等待确认|已经处理过|没有找到仍可处理的确认请求/.test(error.message);
}
