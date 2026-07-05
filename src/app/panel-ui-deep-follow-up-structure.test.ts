import path from "node:path";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("deep follow-up keeps the last run context while showing fresh intake turns", async () => {
  const [appWorkbenchInputPropsSource, deepViewSource, deepTranscriptModelSource, deepTaskControllerSource] = await Promise.all([
    readPanelUiSource("app-workbench-input-props.ts"),
    readPanelUiSource(path.join("components", "deep-view.tsx")),
    readPanelUiSource("deep-transcript-model.ts"),
    readPanelUiSource("app-deep-task-controller.ts"),
  ]);

  includes(appWorkbenchInputPropsSource, "const hasBusyDeepRun = shouldKeepDeepRunBusy(options.deep?.run);");
  includes(appWorkbenchInputPropsSource, "const hasPendingDeepRunBootstrap = options.deepActiveRunId !== undefined && options.deep === undefined;");
  includes(appWorkbenchInputPropsSource, "const hasActiveDeepRun = hasBusyDeepRun || hasPendingDeepRunBootstrap;");
  includes(deepTaskControllerSource, "const preservedView = terminalActiveRunId !== undefined && options.app.deep?.run.runId === terminalActiveRunId");
  includes(deepTaskControllerSource, "deep: preservedView,");
  includes(deepTaskControllerSource, "deepSelectedRunId: response.status === \"plan_ready\" ? terminalActiveRunId : undefined,");
  includes(deepTaskControllerSource, "deepPendingGoal: trimmed,");
  includes(deepTaskControllerSource, "deepPendingGoal: undefined,");

  includes(deepViewSource, "intakeStatus={props.intakeStatus}");
  includes(deepViewSource, 'from "../deep-transcript-model"');
  includes(deepTranscriptModelSource, "deepConversationTranscriptBlocks(effectiveConversation, view.run.runId, view.run.updatedAt, intakeStatus)");
  includes(deepTranscriptModelSource, "planInsertIndex: conversationBlocks.trailingBlocks.length > 0");
  includes(deepTranscriptModelSource, "blocks.push(...trailingConversationBlocks);");
  includes(deepTranscriptModelSource, "!trailingConversationBlocks.some((block) => block.kind === \"user_goal\" && block.text.trim() === pending)");
  includes(deepTranscriptModelSource, "conversation.followUpTurns ?? []");
  includes(deepTranscriptModelSource, "turn.runId === activeRunId");
});

function includes(source: string, pattern: string): void {
  if (!source.includes(pattern)) {
    throw new Error(`Expected source to include: ${pattern}`);
  }
}
