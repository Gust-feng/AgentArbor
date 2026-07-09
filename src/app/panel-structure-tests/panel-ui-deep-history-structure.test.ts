import path from "node:path";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("deep conversation summaries prefer newer intake state over stale run badges", async () => {
  const source = await readPanelUiSource("app-deep-history.ts");

  includes(source, "const intakeStatus = latestIntakeStatus(conversation);");
  includes(source, "const latestRunIsCurrent = latestRun !== undefined &&");
  includes(source, "!conversationHasFreshIntake(conversation.updatedAt, intakeStatus, latestRun.updatedAt);");
  includes(source, "intakeStatus: latestRunIsCurrent ? undefined : intakeStatus,");
  includes(source, "latestRun: latestRunIsCurrent ? latestRun : undefined,");
  includes(source, "function conversationHasFreshIntake(");
  includes(source, "return intakeStatus !== undefined && timestampValue(conversationUpdatedAt) > timestampValue(latestRunUpdatedAt);");
});

function includes(source: string, pattern: string): void {
  if (!source.includes(pattern)) {
    throw new Error(`Expected source to include: ${pattern}`);
  }
}
