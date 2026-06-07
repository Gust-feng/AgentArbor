import { friendlyUserFacingFailureText } from "./visible-text-safety.js";

export type AssistantRunLike = {
  readonly status: string;
};

export type AssistantWorkViewProblemLike = {
  readonly headline?: string;
  readonly currentAction?: string;
};

export type AssistantRunDetailLike = {
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly canvas?:
    | {
        readonly kind: "desktop_agent_canvas";
        readonly agent?: {
          readonly answer?: {
            readonly answer: string;
          };
        };
      }
    | {
        readonly kind: "work_session_canvas";
        readonly workSession?: {
          readonly directAnswer?: {
            readonly answer: string;
          };
          readonly report?: {
            readonly decisionSummary?: string;
          };
        };
      }
    | {
        readonly kind?: string;
        readonly [key: string]: unknown;
      };
  readonly restoredResult?: {
    readonly summary: string;
  };
};

type AssistantDesktopAgentCanvasLike = Extract<
  NonNullable<AssistantRunDetailLike["canvas"]>,
  { readonly kind: "desktop_agent_canvas" }
>;

type AssistantWorkSessionCanvasLike = Extract<
  NonNullable<AssistantRunDetailLike["canvas"]>,
  { readonly kind: "work_session_canvas" }
>;

export type AssistantRunProblem = {
  readonly title: string;
  readonly message: string;
  readonly tone: "warning" | "error";
};

export function visibleRunProblem(
  run: AssistantRunLike | undefined,
  workView: AssistantWorkViewProblemLike | undefined,
  detail: AssistantRunDetailLike | undefined,
  error: string | undefined
): AssistantRunProblem | undefined {
  if (error !== undefined) {
    return { title: "出现错误", message: readableAppError(error), tone: "error" };
  }
  if (run?.status === "blocked" || run?.status === "paused") {
    return {
      title: workView?.headline ?? "任务没有完成",
      message: visibleBlockedMessage(detail?.error?.code, detail?.error?.message) ?? visibleProblemText(workView?.currentAction) ?? "任务暂停了。你可以继续发送消息让我接着处理。",
      tone: "warning",
    };
  }
  if (run?.status === "failed") {
    return {
      title: "未完成",
      message: visibleProblemText(detail?.error?.message) ?? visibleProblemText(workView?.currentAction) ?? "没有返回可用结果。你可以补充材料或重新发起。",
      tone: "error",
    };
  }
  return undefined;
}

export function visibleResultText(detail: AssistantRunDetailLike | undefined): string | undefined {
  const canvas = detail?.canvas;
  const desktopCanvas = canvas?.kind === "desktop_agent_canvas" ? (canvas as AssistantDesktopAgentCanvasLike) : undefined;
  const legacyWorkSessionCanvas = canvas?.kind === "work_session_canvas" ? (canvas as AssistantWorkSessionCanvasLike) : undefined;
  return (
    desktopCanvas?.agent?.answer?.answer ??
    legacyWorkSessionCanvas?.workSession?.directAnswer?.answer ??
    nonEmptyText(legacyWorkSessionCanvas?.workSession?.report?.decisionSummary) ??
    detail?.restoredResult?.summary
  );
}

function readableAppError(error: string): string {
  const message = error.replace(/^系统错误[:：]\s*/, "").trim();
  return message.length === 0 ? "发生了错误，但没有返回详情。" : friendlyUserFacingFailureText(message);
}

function visibleBlockedMessage(code: string | undefined, message: string | undefined): string | undefined {
  if (code === "out_of_fuel") {
    return "任务没有完成。你可以继续发送消息让我接着处理。";
  }
  return visibleProblemText(message);
}

function visibleProblemText(message: string | undefined): string | undefined {
  return message === undefined || message.trim().length === 0
    ? undefined
    : friendlyUserFacingFailureText(message);
}

function nonEmptyText(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}
