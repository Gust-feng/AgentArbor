const SPACE_REFERENCE_ATTACHMENT_PREFIX = "space-reference:";
const SPACE_REFERENCE_WRITE_PREFIX = "write:space-reference:";

/** Stable Task Soil identities shared by Space grant creation and execution. */
export function spaceReferenceAttachmentId(referenceId: string): string {
  return `${SPACE_REFERENCE_ATTACHMENT_PREFIX}${referenceId}`;
}

export function spaceReferenceIdFromAttachmentId(value: string): string | undefined {
  if (!value.startsWith(SPACE_REFERENCE_ATTACHMENT_PREFIX)) return undefined;
  const referenceId = value.slice(SPACE_REFERENCE_ATTACHMENT_PREFIX.length);
  return referenceId.length === 0 ? undefined : referenceId;
}

export function spaceReferenceWritePermission(referenceId: string): string {
  return `${SPACE_REFERENCE_WRITE_PREFIX}${referenceId}`;
}

export function isSpaceReferenceWritePermission(value: string): boolean {
  return value.startsWith(SPACE_REFERENCE_WRITE_PREFIX);
}
