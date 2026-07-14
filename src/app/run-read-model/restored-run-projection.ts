import type { RuntimeRunRecord } from "../../domain/runtime-database/index.js";
import { redactOrdinaryText } from "../tool-projection/safe-projection.js";
import {
  friendlyUserFacingFailureText,
  sanitizeAssistantVisibleText,
} from "../text-projection/visible-text-safety.js";

export type RestoredRunResultProjection = {
  readonly title: string;
  readonly summary: string;
  readonly content?: string;
};

export const ORDINARY_RUN_BLOCKED_FALLBACK = "这次操作无法原地继续。你可以发送新消息，让我基于当前上下文继续。";

type RestoredRunResultSource = Pick<RuntimeRunRecord, "resultTitle" | "resultSummary" | "resultAnswer">;
type RestoredTerminalRunSource = Pick<RuntimeRunRecord, "error" | "resultTitle" | "resultSummary">;

export function restoredRunResultProjection(
  run: RestoredRunResultSource
): RestoredRunResultProjection | undefined {
  const title = optionalRestoredText(run.resultTitle, 160);
  const summary = optionalRestoredText(run.resultSummary, 1_000);
  const content = optionalRestoredAnswer(run.resultAnswer);
  if (title === undefined && summary === undefined && content === undefined) {
    return undefined;
  }
  return {
    title: title ?? "",
    summary: summary ?? optionalRestoredText(content, 1_000) ?? title ?? "",
    content,
  };
}

function optionalRestoredAnswer(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = sanitizeAssistantVisibleText(value);
  return text.length === 0 ? undefined : text;
}

export function restoredRunTerminalSummary(input: {
  readonly run: RestoredTerminalRunSource;
  readonly status: "blocked" | "cancelled" | "completed" | "failed";
}): string {
  const resultSummary = optionalRestoredText(input.run.resultSummary, 900);
  const errorMessage = optionalRestoredText(input.run.error?.message, 900);
  if (input.status === "failed") {
    return friendlyUserFacingFailureText(errorMessage ?? resultSummary);
  }
  if (input.status === "cancelled") {
    return resultSummary ?? errorMessage ?? "已取消。";
  }
  if (input.status === "blocked") {
    return errorMessage ?? resultSummary ?? ORDINARY_RUN_BLOCKED_FALLBACK;
  }
  return resultSummary ?? optionalRestoredText(input.run.resultTitle, 300) ?? "";
}

function optionalRestoredText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const text = redactOrdinaryText(value, maxLength).trim();
  return text.length === 0 ? undefined : text;
}
