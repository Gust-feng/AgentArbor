import { stringOrUndefined } from "../run-read-model/value-utils.js";

export function modelRequestedSummary(payload: Readonly<Record<string, unknown>>): string | undefined {
  const explicit = visibleModelProgressSummary(
    stringOrUndefined(payload.summary) ??
    stringOrUndefined(payload.statusText) ??
    stringOrUndefined(payload.progressText)
  );
  if (explicit !== undefined) {
    return explicit;
  }
  return purposeProgressLabel(stringOrUndefined(payload.purpose) ?? "unknown");
}

export function restoredModelRequestedSummary(summary: string): string | undefined {
  return visibleModelProgressSummary(summary);
}

export function visibleModelProgressSummary(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  if (text.length === 0 || isStaleModelProgressSummary(text)) {
    return undefined;
  }
  return text;
}

export function isStaleModelProgressSummary(value: string): boolean {
  const normalized = value.replace(/[。.!！?？；;:：、，,\s]/g, "");
  return normalized === "正在判断下一步" ||
    normalized === "等待模型输出" ||
    normalized === "正在组织直接回答" ||
    normalized === "等待模型路由结果";
}

function purposeProgressLabel(purpose: string): string | undefined {
  switch (purpose) {
    case "desktop_intent_gate":
      return "正在识别任务类型。";
    case "work_session_decision":
      return "正在整理任务。";
    case "work_session_child_material":
      return "正在准备材料。";
    case "work_session_synthesis":
      return "正在综合材料。";
    case "work_session_direct_answer":
    case "desktop_chat":
    case "desktop_agent":
      return undefined;
    default:
      return undefined;
  }
}
