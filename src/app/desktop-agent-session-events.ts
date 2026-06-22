import type { TaskSoil } from "../domain/soil/task-soil.js";
import { createMessage } from "../kernel/messages/create-message.js";
import type { DesktopAgentPendingConfirmation } from "./desktop-agent-session-contracts.js";
import type { DesktopAgentSkillContext } from "./desktop-agent-prompts.js";
import type { MinimalRuntime } from "./runtime.js";

export function publishGoalReceived(input: {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: "desktop-shell", role: "user" },
      to: { group: "desktop-shell" },
      type: "goal.received",
      intent: "start_desktop_agent_session",
      payload: {
        goalId: input.goalId,
        taskSoilId: input.taskSoil.taskSoilId,
        goalSummary: safeText(input.goal, 300),
        contextRefCount: input.taskSoil.contextRefs.length,
        permissionBoundaryRefs: input.taskSoil.permissionBoundaryRefs,
      },
    })
  );
}

export function publishConfirmationRequested(input: {
  readonly runtime: MinimalRuntime;
  readonly agentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly pendingConfirmation: DesktopAgentPendingConfirmation;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "agent" },
      to: { group: "desktop-shell" },
      type: "user_approval.requested",
      intent: "request_user_confirmation",
      payload: {
        confirmationId: input.pendingConfirmation.confirmationId,
        goalId: input.goalId,
        title: input.pendingConfirmation.title,
        question: input.pendingConfirmation.question,
        consequence: input.pendingConfirmation.consequence,
        riskLevel: input.pendingConfirmation.riskLevel,
        sourceRefs: input.pendingConfirmation.sourceRefs,
      },
    })
  );
}

export function publishTriggeredSkills(input: {
  readonly runtime: MinimalRuntime;
  readonly agentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly skills: readonly DesktopAgentSkillContext[];
}): void {
  for (const context of input.skills) {
    input.runtime.bus.publish(
      createMessage({
        traceId: input.traceId,
        from: { id: input.agentId, role: "agent" },
        to: { group: "desktop-shell" },
        type: "skill.triggered",
        intent: "inject_desktop_agent_skill",
        payload: {
          goalId: input.goalId,
          skillId: context.skill.id,
          name: context.skill.name,
          triggerReason: safeText(context.triggerReason, 240),
          summary: context.summary === undefined ? undefined : safeText(context.summary, 360),
          loadStatus: context.loadStatus ?? "loaded",
          loadedAt: context.loadedAt,
          bodyHash: context.bodyHash,
          contentHash: context.contentHash,
          bodyCharCount: context.bodyCharCount,
          truncated: context.truncated === true,
          omitted: context.omitted === true,
          error: context.error === undefined ? undefined : safeText(context.error, 240),
          warning: context.warning === undefined ? undefined : safeText(context.warning, 240),
          markUsedStatus: context.markUsedStatus,
          selection: context.selection,
          sourceRef: `skill:${context.skill.id}`,
        },
      })
    );
  }
}

export function publishContextCompactionCompleted(input: {
  readonly runtime: MinimalRuntime;
  readonly agentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly summaryId: string;
  readonly tokenCount: number;
  readonly threshold: number;
  readonly coveredRefCount: number;
  readonly messageCountAfter: number;
  readonly requestId?: string;
  readonly responseId?: string;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "runtime" },
      to: { group: "desktop-shell" },
      type: "context.compaction.completed",
      intent: "compact_desktop_agent_context",
      payload: {
        goalId: input.goalId,
        summaryId: input.summaryId,
        tokenCount: input.tokenCount,
        threshold: input.threshold,
        coveredRefCount: input.coveredRefCount,
        messageCountAfter: input.messageCountAfter,
        requestId: input.requestId,
        responseId: input.responseId,
        summary: `上下文达到 ${input.tokenCount}/${input.threshold} tokens，已压缩 ${input.coveredRefCount} 条较早上下文。`,
      },
    })
  );
}

export function publishContextCompactionFailed(input: {
  readonly runtime: MinimalRuntime;
  readonly agentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly tokenCount: number;
  readonly threshold: number;
  readonly message: string;
  readonly requestId?: string;
  readonly responseId?: string;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "runtime" },
      to: { group: "desktop-shell" },
      type: "context.compaction.failed",
      intent: "compact_desktop_agent_context_failed",
      payload: {
        goalId: input.goalId,
        tokenCount: input.tokenCount,
        threshold: input.threshold,
        requestId: input.requestId,
        responseId: input.responseId,
        summary: `上下文达到 ${input.tokenCount}/${input.threshold} tokens，但压缩没有成功。`,
        error: safeText(input.message, 500),
      },
    })
  );
}

function safeText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}
