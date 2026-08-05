import type { DesktopTaskSoilInput, DesktopTaskSoilContextRefInput } from "../task-soil/task-soil-workspace.js";
import {
  spaceReferenceAttachmentId,
  spaceReferenceWritePermission,
  type SpaceFeature,
  type SpaceReferenceItem,
} from "../spaces/index.js";

export type ConversationSpaceAccess = {
  readonly spaceId?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
};

type AgentAccessibleSpaceReferenceItem = SpaceReferenceItem & {
  readonly reference:
    | { readonly kind: "local_file"; readonly path: string }
    | { readonly kind: "workspace_folder"; readonly path: string }
    | { readonly kind: "managed_folder"; readonly path: string };
};

/**
 * Resolves the unique Space owning a conversation and freezes that Space's
 * local references into this turn's Task Soil. Later Space edits affect only
 * later turns; they cannot expand or revoke a run that already started.
 */
export async function resolveConversationSpaceAccess(
  spaces: Pick<SpaceFeature, "queries">,
  conversationId: string | undefined,
  taskSoilInput: DesktopTaskSoilInput | undefined,
): Promise<ConversationSpaceAccess> {
  if (conversationId === undefined) return { taskSoilInput };
  const owner = await spaces.queries.findConversationOwner(conversationId);
  if (owner === undefined) return { taskSoilInput };
  const tree = await spaces.queries.getTree(owner.spaceId);
  if (tree === undefined) return { taskSoilInput };

  const fileItems = tree.entries
    .map((entry) => entry.item)
    .filter(isAgentAccessibleLocalReference);
  if (fileItems.length === 0) return { spaceId: owner.spaceId, taskSoilInput };

  const generatedAttachmentIds = new Set(fileItems.map((item) => spaceReferenceAttachmentId(item.id)));
  const contextRefs = [
    ...fileItems.map(contextRefFor),
    ...(taskSoilInput?.contextRefs ?? []).filter((ref) =>
      ref.attachmentId === undefined || !generatedAttachmentIds.has(ref.attachmentId)
    ),
  ];
  const permissionBoundaryRefs = unique([
    ...fileItems.flatMap(permissionRefsFor),
    ...(taskSoilInput?.permissionBoundaryRefs ?? []),
  ]);
  return {
    spaceId: owner.spaceId,
    taskSoilInput: { contextRefs, permissionBoundaryRefs },
  };
}

function isAgentAccessibleLocalReference(item: SpaceReferenceItem): item is AgentAccessibleSpaceReferenceItem {
  // An unavailable source cannot be read or written, so freezing a grant for it
  // would hand the model an authorization that can only fail at execution time.
  if (item.status === "unavailable") return false;
  return item.reference.kind === "local_file" ||
    item.reference.kind === "workspace_folder" ||
    item.reference.kind === "managed_folder";
}

function contextRefFor(
  item: AgentAccessibleSpaceReferenceItem,
): DesktopTaskSoilContextRefInput {
  const file = item.reference.kind === "local_file";
  return {
    attachmentId: spaceReferenceAttachmentId(item.id),
    ref: `${file ? "local-file" : "local-project"}:${item.reference.path}`,
    kind: file ? "file" : "project",
    title: item.title,
    summary: "当前对话所属空间授权的本地资源。",
  };
}

function permissionRefsFor(
  item: AgentAccessibleSpaceReferenceItem,
): readonly string[] {
  const readKind = item.reference.kind === "local_file" ? "local-file" : "local-project";
  return [`read:${readKind}:${item.reference.path}`, spaceReferenceWritePermission(item.id)];
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
