export type AssistantRunLike = {
  readonly status: string;
};

export type AssistantWorkSessionProblemLike = {
  readonly headline?: string;
  readonly currentAction?: string;
};

export type AssistantRunDetailLike = {
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly canvas?: {
    readonly agent?: {
      readonly answer?: {
        readonly answer: string;
      };
    };
    readonly workSession?: {
      readonly directAnswer?: {
        readonly answer: string;
      };
      readonly report?: {
        readonly decisionSummary?: string;
      };
    };
  };
  readonly restoredResult?: {
    readonly summary: string;
  };
};

export type AssistantRunProblem = {
  readonly title: string;
  readonly message: string;
  readonly tone: "warning" | "error";
};

export function visibleRunProblem(
  run: AssistantRunLike | undefined,
  workSession: AssistantWorkSessionProblemLike | undefined,
  detail: AssistantRunDetailLike | undefined,
  error: string | undefined
): AssistantRunProblem | undefined {
  if (error !== undefined) {
    return { title: "出现错误", message: readableAppError(error), tone: "error" };
  }
  if (run?.status === "blocked" || run?.status === "paused") {
    return {
      title: workSession?.headline ?? "任务没有完成",
      message: visibleBlockedMessage(detail?.error?.code, detail?.error?.message) ?? workSession?.currentAction ?? "任务暂停了。你可以继续发送消息让我接着处理。",
      tone: "warning",
    };
  }
  if (run?.status === "failed") {
    return {
      title: "运行失败",
      message: detail?.error?.message ?? workSession?.currentAction ?? "模型没有返回可用结果。你可以补充材料或重新发起。",
      tone: "error",
    };
  }
  return undefined;
}

export function visibleResultText(detail: AssistantRunDetailLike | undefined): string | undefined {
  return (
    detail?.canvas?.agent?.answer?.answer ??
    detail?.canvas?.workSession?.directAnswer?.answer ??
    nonEmptyText(detail?.canvas?.workSession?.report?.decisionSummary) ??
    detail?.restoredResult?.summary
  );
}

function readableAppError(error: string): string {
  return error.replace(/^系统错误[:：]\s*/, "").trim() || "发生了错误，但没有返回详情。";
}

function visibleBlockedMessage(code: string | undefined, message: string | undefined): string | undefined {
  if (code === "out_of_fuel") {
    return "这轮调用次数已到上限，任务没有完成。你可以继续发送消息让我接着处理。";
  }
  return message;
}

function nonEmptyText(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}
