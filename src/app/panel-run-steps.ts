import { toolDisplayName } from "../domain/tools/presentation.js";
import type { PanelRunStreamEvent } from "./panel-run-stream-contracts.js";
import type { PanelRunStep, PanelRunStepToolItem } from "./panel-run-transcript-contracts.js";

export function deriveRunSteps(
  streamEvents: readonly PanelRunStreamEvent[]
): readonly PanelRunStep[] {
  const steps: PanelRunStep[] = [];
  let currentToolCalls: PanelRunStepToolItem[] = [];
  let stepNumber = 0;

  for (const event of streamEvents) {
    if (
      event.type === "agent.note.delta" ||
      event.type === "agent.note.completed" ||
      event.type === "agent.child.started" ||
      event.type === "agent.delegation.planned"
    ) {
      if (currentToolCalls.length > 0) {
        stepNumber += 1;
        steps.push({
          stepId: `${event.runId}:step:${stepNumber}`,
          stepNumber,
          toolCalls: currentToolCalls,
          status: currentToolCalls.some((toolCall) => toolCall.status === "failed") ? "failed" : "completed",
        });
        currentToolCalls = [];
      }
    }

    if (
      event.type === "tool.requested" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed"
    ) {
      const status: "running" | "completed" | "failed" =
        event.type === "tool.failed" ? "failed" :
        event.type === "tool.completed" ? "completed" :
        "running";

      const target = event.detail?.path ?? event.detail?.query ?? event.detail?.command;

      currentToolCalls.push({
        toolName: event.toolName,
        title: event.summary ?? (event.toolName === undefined ? "工具调用" : toolDisplayName(event.toolName)),
        target,
        preview: event.detail?.preview,
        display: event.detail?.display,
        exitCode: event.detail?.exitCode,
        truncated: event.detail?.truncated,
        error: event.detail?.error,
        status,
      });
    }
  }

  if (currentToolCalls.length > 0) {
    stepNumber += 1;
    steps.push({
      stepId: `${streamEvents[0]?.runId ?? "unknown"}:step:${stepNumber}`,
      stepNumber,
      toolCalls: currentToolCalls,
      status: currentToolCalls.some((toolCall) => toolCall.status === "failed") ? "failed" : "completed",
    });
  }

  return steps;
}
