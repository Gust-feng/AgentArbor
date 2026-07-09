import type { EventLogEntry } from "../../../kernel/events/in-memory-event-log.js";
import { asRecord } from "../../panel-read-model-utils.js";
import { friendlyUserFacingModelFailureText } from "../../visible-text-safety.js";

export function latestModelFailureTextForUser(
  eventEntries: readonly EventLogEntry[]
): string | undefined {
  const latestFailure = [...eventEntries].reverse().find((entry) => entry.type === "model.failed");
  if (latestFailure === undefined) {
    return undefined;
  }
  const failureText = friendlyUserFacingModelFailureText(asRecord(latestFailure.message.payload));
  return shouldExplainPostToolContinuationFailure(eventEntries, latestFailure)
    ? `工具已执行，但后续模型续跑失败。${failureText}`
    : failureText;
}

function shouldExplainPostToolContinuationFailure(
  eventEntries: readonly EventLogEntry[],
  latestFailure: EventLogEntry
): boolean {
  const failureIndex = eventEntries.findIndex((entry) => entry.message.id === latestFailure.message.id);
  if (failureIndex <= 0) {
    return false;
  }
  return eventEntries
    .slice(0, failureIndex)
    .some((entry) => entry.type === "tool.completed");
}
