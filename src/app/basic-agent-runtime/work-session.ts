import type {
  AgentDeliverable,
  AgentDeliverableSection,
  BasicAgentRun,
  ConfirmationRequest,
  ContextAttachment,
  DesktopWorkSessionReadModel,
  DesktopWorkSessionStage,
  RunEvent,
} from "../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { ToolDisplayProjection } from "../../domain/tools/index.js";
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { redactOrdinaryText } from "./safe-projection.js";

export type CreateDesktopWorkSessionReadModelInput = {
  readonly run: BasicAgentRun;
  readonly events: readonly RunEvent[];
  readonly canvas?: PanelRunCanvasReadModel;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly toolDisplays?: readonly ToolDisplayProjection[];
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
};

export function createDesktopWorkSessionReadModel(
  input: CreateDesktopWorkSessionReadModelInput
): DesktopWorkSessionReadModel {
  const visibleEvents = input.events.filter((event) => event.visibility !== "debug").slice(-18);
  const contextAttachments = contextAttachmentsFor(input);
  const toolDisplays = input.toolDisplays ?? [];
  const pendingConfirmation = pendingConfirmationFor(input.run, input.canvas);
  const deliverable = deliverableFor({
    run: input.run,
    canvas: input.canvas,
    toolDisplays,
    restoredResult: input.restoredResult,
  });
  const stage = stageFor(input.run, visibleEvents, pendingConfirmation, deliverable);
  return {
    run: input.run,
    stage,
    headline: headlineFor(input.run, stage, deliverable),
    currentAction: currentActionFor(input.run, stage, visibleEvents, pendingConfirmation),
    contextAttachments,
    pendingConfirmation,
    deliverable,
    visibleEvents,
    safetySummary: {
      summary: "普通视图只展示上下文引用、工具摘要、证据和交付结果的安全投影。",
      pendingActionCount: pendingConfirmation === undefined ? 0 : 1,
      toolResultCount: toolDisplays.length,
      contextAttachmentCount: contextAttachments.length,
    },
  };
}

function stageFor(
  run: BasicAgentRun,
  events: readonly RunEvent[],
  pendingConfirmation: ConfirmationRequest | undefined,
  deliverable: AgentDeliverable | undefined
): DesktopWorkSessionStage {
  if (run.status === "queued") return "queued";
  if (run.status === "approval_needed" || pendingConfirmation !== undefined) return "awaiting_approval";
  if (run.status === "blocked" || run.status === "needs_input") return "blocked";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "completed") return deliverable === undefined ? "completed" : "completed";
  const latest = events.at(-1);
  if (latest?.type.startsWith("tool.")) return "using_tools";
  if (latest?.type === "model.output.delta" || latest?.type === "model.output.completed") return "composing_result";
  if (events.some((event) => event.type.startsWith("tool."))) return "composing_result";
  if (events.length > 0) return "understanding";
  return "drafting";
}

function headlineFor(
  run: BasicAgentRun,
  stage: DesktopWorkSessionStage,
  deliverable: AgentDeliverable | undefined
): string {
  if (stage === "completed") return deliverable?.title ?? "任务已完成";
  if (stage === "awaiting_approval") return "需要你确认下一步";
  if (stage === "blocked") return "需要处理后再继续";
  if (stage === "failed") return "这次没有完成";
  if (stage === "cancelled") return "任务已取消";
  if (stage === "queued") return "已加入队列";
  if (stage === "using_tools") return "正在使用工具";
  if (stage === "gathering_context") return "正在整理上下文";
  if (stage === "composing_result") return "正在整理结果";
  return run.title || "正在理解任务";
}

function currentActionFor(
  run: BasicAgentRun,
  stage: DesktopWorkSessionStage,
  events: readonly RunEvent[],
  pendingConfirmation: ConfirmationRequest | undefined
): string {
  if (pendingConfirmation !== undefined) {
    return pendingConfirmation.actionSummary;
  }
  const latest = [...events].reverse().find((event) => event.summary !== undefined);
  if (latest?.summary !== undefined) {
    return latest.summary;
  }
  if (run.currentStep !== undefined) {
    return run.currentStep;
  }
  if (stage === "queued") return "等待前一个任务完成。";
  if (stage === "completed") return "结果已经整理好。";
  if (stage === "failed") return "查看失败摘要后可以补充材料或重新发起。";
  if (stage === "cancelled") return "运行已经停止。";
  return run.goalSummary;
}

function deliverableFor(input: {
  readonly run: BasicAgentRun;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
}): AgentDeliverable | undefined {
  const canvas = input.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.answer !== undefined) {
    const answer = canvas.agent.answer;
    const sections = answer.resultBlocks.length > 0
      ? answer.resultBlocks.map((block): AgentDeliverableSection => ({
          sectionId: block.blockId,
          title: redactOrdinaryText(block.title, 120),
          content: redactOrdinaryText(block.summary, 900),
          evidenceRefs: observationRefs(answer.evidenceRefs),
        }))
      : [{
          sectionId: `${input.run.runId}:answer`,
          title: "回答",
          content: redactOrdinaryText(answer.answer, 1_200),
          evidenceRefs: observationRefs(answer.evidenceRefs),
        }];
    return deliverable({
      run: input.run,
      title: "已整理结果",
      summary: answer.answer,
      sections,
      evidenceRefs: observationRefs(answer.evidenceRefs),
      toolDisplays: input.toolDisplays,
    });
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.report !== undefined) {
    const report = canvas.workSession.report;
    return deliverable({
      run: input.run,
      title: report.title,
      summary: report.decisionSummary,
      sections: [
        section(`${input.run.runId}:findings`, "关键发现", report.keyFindings.join("\n"), report.evidenceRefs),
        section(`${input.run.runId}:recommendations`, "建议", report.recommendations.join("\n"), report.evidenceRefs),
      ],
      evidenceRefs: observationRefs(report.evidenceRefs),
      toolDisplays: input.toolDisplays,
      nextActions: report.nextActions,
    });
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.directAnswer !== undefined) {
    const answer = canvas.workSession.directAnswer;
    return deliverable({
      run: input.run,
      title: "已回答",
      summary: answer.answer,
      sections: [section(`${input.run.runId}:answer`, "回答", answer.answer, answer.evidenceRefs)],
      evidenceRefs: observationRefs(answer.evidenceRefs),
      toolDisplays: input.toolDisplays,
      nextActions: answer.followUpSuggestions,
    });
  }
  if (input.restoredResult !== undefined && input.run.status === "completed") {
    return deliverable({
      run: input.run,
      title: input.restoredResult.title,
      summary: input.restoredResult.summary,
      sections: [section(`${input.run.runId}:restored`, "结果摘要", input.restoredResult.summary, [])],
      evidenceRefs: [],
      toolDisplays: input.toolDisplays,
    });
  }
  return undefined;
}

function deliverable(input: {
  readonly run: BasicAgentRun;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly AgentDeliverableSection[];
  readonly evidenceRefs: readonly ObservationRef[];
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly nextActions?: readonly string[];
}): AgentDeliverable {
  return {
    deliverableId: `${input.run.runId}:deliverable`,
    runId: input.run.runId,
    title: redactOrdinaryText(input.title, 140),
    summary: redactOrdinaryText(input.summary, 1_000),
    sections: input.sections,
    evidenceRefs: input.evidenceRefs,
    toolDisplays: input.toolDisplays,
    fileChanges: input.toolDisplays.filter((display) => display.kind === "file_change_summary" || display.kind === "file_diff_preview"),
    commands: input.toolDisplays.filter((display) => display.kind === "command_summary"),
    nextActions: (input.nextActions ?? []).map((item) => redactOrdinaryText(item, 220)).filter((item) => item.length > 0).slice(0, 5),
    createdAt: input.run.updatedAt,
  };
}

function section(
  sectionId: string,
  title: string,
  content: string,
  refs: readonly string[]
): AgentDeliverableSection {
  return {
    sectionId,
    title: redactOrdinaryText(title, 120),
    content: redactOrdinaryText(content, 900),
    evidenceRefs: observationRefs(refs),
  };
}

function pendingConfirmationFor(
  run: BasicAgentRun,
  canvas: PanelRunCanvasReadModel | undefined
): ConfirmationRequest | undefined {
  if (canvas?.kind !== "desktop_agent_canvas" || canvas.agent.pendingConfirmation === undefined) {
    return undefined;
  }
  const pending = canvas.agent.pendingConfirmation;
  return {
    confirmationId: pending.confirmationId,
    runId: run.runId,
    conversationId: run.conversationId,
    title: redactOrdinaryText(pending.title, 120),
    actionSummary: redactOrdinaryText(`${pending.question}\n${pending.consequence}`, 600),
    affectedResources: pending.sourceRefs.map((ref) => redactOrdinaryText(ref, 180)),
    riskLevel: pending.riskLevel === "low" || pending.riskLevel === "medium" || pending.riskLevel === "high" ? pending.riskLevel : "medium",
    requestedAt: run.updatedAt,
    sourceRefs: pending.sourceRefs,
  };
}

function contextAttachmentsFor(input: CreateDesktopWorkSessionReadModelInput): readonly ContextAttachment[] {
  const fromCanvas = taskSoilContextAttachments(input.canvas);
  const fromInput = (input.taskSoilInput?.contextRefs ?? []).map((ref, index): ContextAttachment => ({
    attachmentId: `${input.run.runId}:context:${index}`,
    kind: ref.kind,
    ref: ref.ref,
    title: contextTitle(ref.kind, ref.ref),
    summary: redactOrdinaryText(ref.summary ?? ref.ref, 280),
    permissionRefs: [],
    readonlyPreviewMeta: {
      available: true,
      title: ref.readonlyPreview?.title,
      truncated: ref.readonlyPreview?.text !== undefined ? ref.readonlyPreview.text.length > 0 : undefined,
    },
    status: "ready",
  }));
  if (fromCanvas.length === 0) {
    return fromInput;
  }
  if (fromInput.length === 0) {
    return fromCanvas;
  }
  return mergeContextAttachments(fromCanvas, fromInput);
}

function mergeContextAttachments(
  primary: readonly ContextAttachment[],
  fallback: readonly ContextAttachment[]
): readonly ContextAttachment[] {
  const merged: ContextAttachment[] = [];
  const seen = new Set<string>();
  for (const attachment of [...primary, ...fallback]) {
    const key = `${attachment.kind}:${attachment.ref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(attachment);
  }
  return merged;
}

function taskSoilContextAttachments(canvas: PanelRunCanvasReadModel | undefined): readonly ContextAttachment[] {
  const taskSoil = canvas?.kind === "desktop_agent_canvas" || canvas?.kind === "work_session_canvas" || canvas?.kind === "desktop_shell_canvas"
    ? canvas.taskSoil
    : undefined;
  if (taskSoil === undefined) {
    return [];
  }
  return taskSoil.contextRefs
    .filter((ref) => ref.kind !== "user_goal" && ref.kind !== "runtime")
    .map((ref, index): ContextAttachment => ({
      attachmentId: `${taskSoil.taskSoilId}:context:${index}`,
      kind: ref.kind === "file" || ref.kind === "project" || ref.kind === "web" ? ref.kind : "workspace",
      ref: redactOrdinaryText(ref.ref, 220),
      title: contextTitle(ref.kind, ref.ref),
      summary: redactOrdinaryText(ref.summary ?? ref.ref, 280),
      permissionRefs: taskSoil.permissionBoundaryRefs.filter((permission) => permission.startsWith("read:")).map((permission) => redactOrdinaryText(permission, 220)),
      readonlyPreviewMeta: {
        available: true,
        title: ref.readonlyPreview?.title,
        byteLength: ref.readonlyPreview?.text.length,
        truncated: ref.readonlyPreview?.truncated,
      },
      status: "ready",
    }));
}

function contextTitle(kind: string, ref: string): string {
  const clean = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
  if (kind === "web") return redactOrdinaryText(clean, 120);
  if (kind === "file") return redactOrdinaryText(clean.split(/[\\/]/).at(-1) || clean, 120);
  if (kind === "project") return redactOrdinaryText(clean || "项目", 120);
  return "当前工作区";
}

function observationRefs(refs: readonly string[]): readonly ObservationRef[] {
  return refs.slice(0, 20).map((ref): ObservationRef => {
    const separator = ref.indexOf(":");
    if (separator > 0) {
      const kind = observationKind(ref.slice(0, separator));
      return {
        kind,
        id: redactOrdinaryText(ref.slice(separator + 1), 180),
      };
    }
    return { kind: "event", id: redactOrdinaryText(ref, 180) };
  });
}

function observationKind(value: string): ObservationRef["kind"] {
  if (value === "trace") return "trace";
  if (value === "goal") return "goal";
  if (value === "tool" || value === "tool_call") return "tool_call";
  if (value === "model" || value === "model_call") return "model_call";
  if (value === "artifact") return "artifact";
  return "event";
}
