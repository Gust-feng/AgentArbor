import { isStaleModelProgressSummary } from "../../panel-model-progress-copy.js";

export function isOrdinaryTranscriptSuppressedEvent(input: {
  readonly type: string;
  readonly visibility?: string;
}): boolean {
  return input.visibility === "debug" ||
    input.type === "run.started" ||
    input.type === "goal.received" ||
    input.type === "model.output.delta" ||
    input.type === "model.output.completed";
}

export function isOrdinaryTranscriptReasoningSettlementEvent(type: string): boolean {
  return type === "model.output.completed" ||
    type === "model.side.completed" ||
    type === "agent.note.completed" ||
    type === "tool.requested" ||
    type === "tool.completed" ||
    type === "tool.failed" ||
    type === "sub_agent.started" ||
    type === "sub_agent.completed" ||
    type === "sub_agent_batch.started" ||
    type === "sub_agent_batch.completed" ||
    type === "confirmation.needed" ||
    type === "user_approval.received" ||
    type === "user.guidance" ||
    type === "context.compaction.requested" ||
    type === "context.compaction.completed" ||
    type === "context.compaction.failed" ||
    type === "final.result" ||
    type === "run.failed" ||
    type === "run.blocked" ||
    type === "run.cancelled";
}

export function isLowValueOrdinaryAgentNote(value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  return text.length === 0 ||
    text === "等待模型输出。" ||
    isGenericOrdinaryProgressNote(text) ||
    isStaleModelProgressSummary(text) ||
    staleToolProgressNote(text) ||
    text === "Intelligence Channel requested model output." ||
    text === "Intelligence Channel completed model output validation.";
}

function isGenericOrdinaryProgressNote(value: string): boolean {
  const normalized = value.replace(/[。.!！?？；;:：、，,\s]/g, "");
  return normalized === "任务处理中" ||
    normalized === "正在整理结果" ||
    normalized === "正在整理结果材料";
}

function staleToolProgressNote(value: string): boolean {
  const normalized = value.replace(/[。.!！?？；;:：、，,\s]/g, "");
  return normalized.includes("助手已选择使用工具") &&
    normalized.includes("工具结果") &&
    normalized.includes("后续处理");
}
