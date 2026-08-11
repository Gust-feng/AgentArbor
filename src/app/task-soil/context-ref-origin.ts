import type { TaskSoilContextRef } from "../../domain/soil/index.js";

const LEGACY_SPACE_REFERENCE_ATTACHMENT_PREFIX = "space-reference:";

/**
 * Distinguishes standing resources injected by the conversation owner from
 * attachments explicitly selected for the current turn. The id fallback keeps
 * historical run snapshots truthful after the explicit origin flag was added.
 */
export function isConversationOwnerContextRef(
  ref: Pick<TaskSoilContextRef, "attachmentId" | "automaticSpaceReference">,
): boolean {
  return ref.automaticSpaceReference === true ||
    ref.attachmentId?.startsWith(LEGACY_SPACE_REFERENCE_ATTACHMENT_PREFIX) === true;
}
