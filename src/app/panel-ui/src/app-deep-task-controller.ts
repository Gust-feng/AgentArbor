import type React from "react";
import { taskSoilInputFromAttachments } from "./app-attachments";
import type { VisibleAiMode } from "./app-config-projection";
import {
  decideDeepChildConfirmation,
  requestDeepChildMessage,
  requestDeepRunCorrection,
  requestDeepRunResynthesis,
  requestDeepRunStop,
} from "./app-deep-control";
import {
  deepConversationSummaryFromView,
  deepRunSummaryFromView,
  isTerminalDeepRunStatus,
  shouldKeepDeepRunBusy,
  shouldPollDeepRun,
  upsertDeepConversationSummary,
  upsertDeepRunSummary,
} from "./app-deep-history";
import { requestDeepIntake, requestStartConfirmedDeepRun } from "./app-deep-intake";
import type { DeepRunUpdateController } from "./app-deep-live-updates";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";
import type {
  DeepChildOperationResponse,
  DeepRunView,
} from "./contracts/deep";

export type AppDeepTaskController = {
  readonly submitDeepInput: (explicitGoal?: string) => Promise<void>;
  readonly startConfirmedDeepRun: (input: {
    readonly intakeTurnId?: string;
    readonly confirmedObjective: string;
    readonly confirmedPlan: string;
  }) => Promise<void>;
  readonly stopDeepTask: () => Promise<void>;
  readonly sendDeepChildMessage: (childRunId: string, message: string) => Promise<void>;
  readonly decideDeepChild: (
    childRunId: string,
    confirmationId: string,
    decision: "approve_once" | "deny" | "guidance",
    guidance?: string,
  ) => Promise<void>;
  readonly resynthesizeDeepRun: () => Promise<void>;
};

export type AppDeepTaskControllerOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setScreen: (screen: "chat-empty" | "chat-active") => void;
  readonly setGoal: React.Dispatch<React.SetStateAction<string>>;
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly attachments: readonly ContextAttachment[];
  readonly selectedWorkspaceDirectory?: string;
  readonly goal: string;
  readonly aiMode: VisibleAiMode;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly deepOpenEpochRef: React.MutableRefObject<number>;
  readonly deepRunUpdateController: DeepRunUpdateController;
  readonly deepChildOperationBusyId?: string;
  readonly setDeepChildOperationBusyId: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly deepResynthesisBusy: boolean;
  readonly setDeepResynthesisBusy: React.Dispatch<React.SetStateAction<boolean>>;
};

export function createAppDeepTaskController(
  options: AppDeepTaskControllerOptions,
): AppDeepTaskController {
  async function submitDeepInput(explicitGoal?: string): Promise<void> {
    const trimmed = (explicitGoal ?? options.goal).trim();
    if (trimmed.length === 0) return;
    const epoch = options.deepOpenEpochRef.current + 1;
    options.deepOpenEpochRef.current = epoch;
    const activeDeepRunId = options.app.deep?.run.runId ?? options.app.deepActiveRunId;
    if (options.app.deepBusy) {
      if (activeDeepRunId === undefined) {
        options.setApp((previous) => ({
          ...previous,
          error: "正在理解你的补充，请稍后再发送。",
        }));
        return;
      }
      options.setGoal("");
      options.setAttachments([]);
      options.setApp((previous) => ({
        ...previous,
        deepPendingGoal: trimmed,
        error: undefined,
      }));
      try {
        await requestDeepRunCorrection(activeDeepRunId, [trimmed]);
        if (!options.mountedRef.current || options.deepOpenEpochRef.current !== epoch) return;
        options.setApp((previous) => ({ ...previous, error: undefined }));
        options.deepRunUpdateController.startPolling(activeDeepRunId);
      } catch (error) {
        if (options.mountedRef.current && options.deepOpenEpochRef.current === epoch) {
          options.setApp((previous) => ({
            ...previous,
            deepPendingGoal: undefined,
            error: errorText(error, "补充 Agent 集群上下文失败。"),
          }));
        }
      }
      return;
    }
    const terminalActiveRunId =
      options.app.deep !== undefined && isTerminalDeepRunStatus(options.app.deep.run.status)
        ? options.app.deep.run.runId
        : undefined;
    const deepConversationId =
      options.app.deepConversation?.conversationId ??
      options.app.deep?.conversation?.conversationId ??
      options.app.deep?.run.conversationId;
    options.setGoal("");
    options.setAttachments([]);
    options.setScreen("chat-active");
    options.setApp((previous) => ({
      ...previous,
      deepBusy: true,
      deepPendingGoal: trimmed,
      deepActiveRunId: undefined,
      deepSelectedRunId: terminalActiveRunId,
      deepIntakeStatus: undefined,
      error: undefined,
    }));
    try {
      const response = await requestDeepIntake({
        conversationId: deepConversationId,
        activeRunId: terminalActiveRunId,
        message: trimmed,
        aiMode: options.aiMode,
        workspaceDirectory: options.selectedWorkspaceDirectory,
        taskSoilInput: taskSoilInputFromAttachments(options.attachments),
      });
      if (!options.mountedRef.current || options.deepOpenEpochRef.current !== epoch) return;
      const conversationSummary = deepConversationSummaryFromView(response.conversation);
      const preservedView = terminalActiveRunId !== undefined && options.app.deep?.run.runId === terminalActiveRunId
        ? options.app.deep
        : undefined;
      options.setApp((previous) => ({
        ...previous,
        deep: preservedView,
        deepConversation: response.conversation,
        deepConversations: upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
        deepIntakeStatus: response.status,
        deepBusy: false,
        deepPendingGoal: undefined,
        deepActiveRunId: undefined,
        deepSelectedRunId: response.status === "plan_ready" ? terminalActiveRunId : undefined,
        error: undefined,
      }));
    } catch (error) {
      if (options.mountedRef.current && options.deepOpenEpochRef.current === epoch) {
        options.setApp((previous) => ({
          ...previous,
          deepBusy: false,
          deepPendingGoal: undefined,
          error: errorText(error, "Agent 集群理解失败。"),
        }));
      }
    }
  }

  async function startConfirmedDeepRun(input: {
    readonly intakeTurnId?: string;
    readonly confirmedObjective: string;
    readonly confirmedPlan: string;
  }): Promise<void> {
    const conversationId = options.app.deepConversation?.conversationId;
    if (conversationId === undefined || options.app.deepBusy) {
      return;
    }
    const objective = input.confirmedObjective.trim();
    const plan = input.confirmedPlan.trim();
    if (objective.length === 0 || plan.length === 0) {
      options.setApp((previous) => ({ ...previous, error: "开始深度研究前需要保留主题和计划。" }));
      return;
    }
    const epoch = options.deepOpenEpochRef.current + 1;
    options.deepOpenEpochRef.current = epoch;
    options.setApp((previous) => ({
      ...previous,
      deepBusy: true,
      deepPendingGoal: objective,
      deepActiveRunId: undefined,
      deepSelectedRunId: undefined,
      error: undefined,
    }));
    try {
      const parentRunStatus = options.app.deepSelectedRunId === undefined
        ? undefined
        : options.app.deep?.run.runId === options.app.deepSelectedRunId
          ? options.app.deep.run.status
          : options.app.deepRuns.find((run) => run.runId === options.app.deepSelectedRunId)?.status;
      const parentRunConversationId = options.app.deepSelectedRunId === undefined
        ? undefined
        : options.app.deep?.run.runId === options.app.deepSelectedRunId
          ? options.app.deep.run.conversationId
          : options.app.deepRuns.find((run) => run.runId === options.app.deepSelectedRunId)?.conversationId;
      const parentRunId =
        options.app.deepIntakeStatus === "plan_ready" &&
        options.app.deepSelectedRunId !== undefined &&
        parentRunStatus !== undefined &&
        isTerminalDeepRunStatus(parentRunStatus) &&
        parentRunConversationId === conversationId
          ? options.app.deepSelectedRunId
          : undefined;
      const response = await requestStartConfirmedDeepRun({
        conversationId,
        parentRunId,
        intakeTurnId: input.intakeTurnId,
        confirmedObjective: objective,
        confirmedPlan: plan,
        aiMode: options.aiMode,
        workspaceDirectory: options.selectedWorkspaceDirectory,
      });
      if (!options.mountedRef.current || options.deepOpenEpochRef.current !== epoch) return;
      const conversationSummary = response.conversation === undefined
        ? undefined
        : {
            ...deepConversationSummaryFromView(response.conversation),
            intakeStatus: "running" as const,
          };
      options.setApp((previous) => ({
        ...previous,
        deep: undefined,
        deepConversation: response.conversation ?? previous.deepConversation,
        deepConversations: conversationSummary === undefined
          ? previous.deepConversations
          : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
        deepIntakeStatus: "running",
        deepBusy: true,
        deepPendingGoal: objective,
        deepActiveRunId: response.run.runId,
        deepSelectedRunId: response.run.runId,
        error: undefined,
      }));
      options.deepRunUpdateController.startPolling(response.run.runId);
    } catch (error) {
      if (options.mountedRef.current && options.deepOpenEpochRef.current === epoch) {
        options.setApp((previous) => ({
          ...previous,
          deepBusy: false,
          deepPendingGoal: undefined,
          error: errorText(error, "启动深度研究失败。"),
        }));
      }
    }
  }

  async function stopDeepTask(): Promise<void> {
    const activeDeepRunId = options.app.deep?.run.runId ?? options.app.deepActiveRunId;
    const canStop = options.app.deep?.run.runtimeHealth?.canStop === true || options.app.deepBusy;
    if (activeDeepRunId === undefined || !canStop) {
      return;
    }
    try {
      const response = await requestDeepRunStop(activeDeepRunId);
      if (!options.mountedRef.current) return;
      if (response.status === "stopped") {
        const view = response.view;
        options.setApp((previous) => applyDeepViewUpdate(previous, view, {
          deepBusy: false,
          deepActiveRunId: undefined,
          deepPendingGoal: undefined,
        }));
        options.deepRunUpdateController.stopPolling();
        return;
      }
      options.setApp((previous) => ({ ...previous, deepBusy: true, error: undefined }));
      options.deepRunUpdateController.startPolling(activeDeepRunId);
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "停止 Agent 集群运行失败。") }));
      }
    }
  }

  async function sendDeepChildMessage(childRunId: string, message: string): Promise<void> {
    const activeDeepRunId = options.app.deep?.run.runId ?? options.app.deepActiveRunId;
    if (activeDeepRunId === undefined || options.deepChildOperationBusyId !== undefined) {
      return;
    }
    options.setDeepChildOperationBusyId(childRunId);
    try {
      const response = await requestDeepChildMessage(activeDeepRunId, childRunId, message);
      if (!options.mountedRef.current) return;
      const view = applyQueuedChildOperationProjection(response);
      const keepBusy = response.status === "queued" || shouldKeepDeepRunBusy(view.run);
      const keepPolling = shouldPollDeepRun(view.run);
      options.setApp((previous) => applyDeepViewUpdate(previous, view, {
        deepBusy: keepBusy,
        deepActiveRunId: view.run.runId,
        deepPendingGoal: previous.deepPendingGoal,
      }));
      if (keepPolling) {
        options.deepRunUpdateController.startPolling(activeDeepRunId);
      } else {
        options.deepRunUpdateController.stopPolling();
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "继续协作项失败。") }));
      }
    } finally {
      if (options.mountedRef.current) {
        options.setDeepChildOperationBusyId(undefined);
      }
    }
  }

  async function decideDeepChild(
    childRunId: string,
    confirmationId: string,
    decision: "approve_once" | "deny" | "guidance",
    guidance?: string,
  ): Promise<void> {
    const activeDeepRunId = options.app.deep?.run.runId ?? options.app.deepActiveRunId;
    if (activeDeepRunId === undefined || options.deepChildOperationBusyId !== undefined) {
      return;
    }
    options.setDeepChildOperationBusyId(childRunId);
    try {
      const response = await decideDeepChildConfirmation(
        activeDeepRunId,
        childRunId,
        confirmationId,
        decision,
        guidance,
      );
      if (!options.mountedRef.current) return;
      const keepBusy = shouldKeepDeepRunBusy(response.view.run);
      const keepPolling = shouldPollDeepRun(response.view.run);
      options.setApp((previous) => applyDeepViewUpdate(previous, response.view, {
        deepBusy: keepBusy,
        deepActiveRunId: response.view.run.runId,
        deepPendingGoal: previous.deepPendingGoal,
      }));
      if (keepPolling) {
        options.deepRunUpdateController.startPolling(activeDeepRunId);
      } else {
        options.deepRunUpdateController.stopPolling();
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "处理协作项确认失败。") }));
      }
    } finally {
      if (options.mountedRef.current) {
        options.setDeepChildOperationBusyId(undefined);
      }
    }
  }

  async function resynthesizeDeepRun(): Promise<void> {
    const activeDeepRunId = options.app.deep?.run.runId ?? options.app.deepActiveRunId;
    if (activeDeepRunId === undefined || options.deepResynthesisBusy || options.deepChildOperationBusyId !== undefined) {
      return;
    }
    options.setDeepResynthesisBusy(true);
    try {
      const response = await requestDeepRunResynthesis(activeDeepRunId);
      if (!options.mountedRef.current) return;
      const keepBusy = shouldKeepDeepRunBusy(response.view.run);
      const keepPolling = shouldPollDeepRun(response.view.run);
      options.setApp((previous) => applyDeepViewUpdate(previous, response.view, {
        deepBusy: keepBusy,
        deepActiveRunId: response.view.run.runId,
        deepPendingGoal: previous.deepPendingGoal,
      }));
      if (keepPolling) {
        options.deepRunUpdateController.startPolling(activeDeepRunId);
      } else {
        options.deepRunUpdateController.stopPolling();
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "重新综合失败。") }));
      }
    } finally {
      if (options.mountedRef.current) {
        options.setDeepResynthesisBusy(false);
      }
    }
  }

  return {
    submitDeepInput,
    startConfirmedDeepRun,
    stopDeepTask,
    sendDeepChildMessage,
    decideDeepChild,
    resynthesizeDeepRun,
  };
}

function applyDeepViewUpdate(
  previous: AppState,
  view: DeepRunView,
  input: {
    readonly deepBusy: boolean;
    readonly deepActiveRunId: string | undefined;
    readonly deepPendingGoal: string | undefined;
  },
): AppState {
  const summary = deepRunSummaryFromView(view);
  const conversationSummary = view.conversation === undefined
    ? undefined
    : deepConversationSummaryFromView(view.conversation, summary);
  const intakeStatus = conversationSummary?.intakeStatus;
  return {
    ...previous,
    deep: view,
    deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
    deepConversations: conversationSummary === undefined
      ? previous.deepConversations
      : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
    deepConversation: view.conversation ?? previous.deepConversation,
    deepActiveRunId: input.deepActiveRunId,
    deepSelectedRunId: view.run.runId,
    deepIntakeStatus: intakeStatus,
    deepPendingGoal: input.deepPendingGoal,
    deepBusy: input.deepBusy,
    error: undefined,
  };
}

function applyQueuedChildOperationProjection(response: DeepChildOperationResponse): DeepRunView {
  if (
    response.status !== "queued" ||
    response.childRunId === undefined ||
    response.messageRef === undefined ||
    response.queuedAt === undefined
  ) {
    return response.view;
  }
  const childRunId = response.childRunId;
  const messageRef = response.messageRef;
  const queuedAt = response.queuedAt;
  const queuedCount = response.queuedCount;
  const children = response.view.liveProjection.children.map((child) =>
    child.childRunId === childRunId
      ? {
          ...child,
          parentOperation: {
            status: "queued" as const,
            messageRef,
            queuedCount,
            updatedAt: queuedAt,
          },
          updatedAt: queuedAt,
        }
      : child
  );
  return {
    ...response.view,
    liveProjection: {
      ...response.view.liveProjection,
      activeNodeId: childRunId,
      children,
      updatedAt: queuedAt,
    },
  };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
