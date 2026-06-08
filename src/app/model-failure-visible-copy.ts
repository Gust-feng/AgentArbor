import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { asRecord } from "./panel-read-model-utils.js";
import { friendlyUserFacingModelFailureText } from "./visible-text-safety.js";

export function latestModelFailureTextForUser(
  eventEntries: readonly EventLogEntry[]
): string | undefined {
  const latestFailure = [...eventEntries].reverse().find((entry) => entry.type === "model.failed");
  return latestFailure === undefined
    ? undefined
    : friendlyUserFacingModelFailureText(asRecord(latestFailure.message.payload));
}
