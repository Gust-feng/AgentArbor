import path from "node:path";
import test from "node:test";
import { readAppSource, readPanelUiSource } from "./panel-structure-test-utils.js";

test("deep follow-up keeps the last run context while showing fresh intake turns", async () => {
  const [appSource, deepViewSource] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource(path.join("components", "deep-view.tsx")),
  ]);

  includes(appSource, "const preservedView = terminalActiveRunId !== undefined && app.deep?.run.runId === terminalActiveRunId");
  includes(appSource, "deep: preservedView,");
  includes(appSource, "deepSelectedRunId: response.status === \"plan_ready\" ? terminalActiveRunId : undefined,");
  includes(appSource, "const hasBusyDeepRun = shouldKeepDeepRunBusy(app.deep?.run);");
  includes(appSource, "const hasPendingDeepRunBootstrap = app.deepActiveRunId !== undefined && app.deep === undefined;");
  includes(appSource, "const hasActiveDeepRun = hasBusyDeepRun || hasPendingDeepRunBootstrap;");
  includes(appSource, "deepPendingGoal: trimmed,");
  includes(appSource, "deepPendingGoal: undefined,");

  includes(deepViewSource, "intakeStatus={props.intakeStatus}");
  includes(deepViewSource, "deepConversationTranscriptBlocks(effectiveConversation, view.run.runId, view.run.updatedAt, intakeStatus)");
  includes(deepViewSource, "planInsertIndex: conversationBlocks.trailingBlocks.length > 0");
  includes(deepViewSource, "blocks.push(...trailingConversationBlocks);");
  includes(deepViewSource, "!trailingConversationBlocks.some((block) => block.kind === \"user_goal\" && block.text.trim() === pending)");
  includes(deepViewSource, "conversation.followUpTurns ?? []");
  includes(deepViewSource, "turn.runId === activeRunId");
});

function includes(source: string, pattern: string): void {
  if (!source.includes(pattern)) {
    throw new Error(`Expected source to include: ${pattern}`);
  }
}
