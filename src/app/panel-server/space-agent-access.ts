import type { DesktopTaskSoilInput, DesktopTaskSoilContextRefInput } from "../task-soil/task-soil-workspace.js";
import {
  spaceReferenceAttachmentId,
  spaceReferenceWritePermission,
  spaceScopePermission,
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
 * local references into this turn's Task Soil. Later additions affect only
 * later turns; removals are enforced separately by the live deny overlay.
 */
export async function resolveConversationSpaceAccess(
  spaces: Pick<SpaceFeature, "commands" | "queries">,
  conversationId: string | undefined,
  taskSoilInput: DesktopTaskSoilInput | undefined,
  requestedSpaceId?: string,
): Promise<ConversationSpaceAccess> {
  const owner = conversationId === undefined
    ? (requestedSpaceId === undefined ? undefined : { spaceId: requestedSpaceId })
    : await spaces.queries.findConversationOwner(conversationId);
  if (owner === undefined) return { taskSoilInput };
  if (conversationId !== undefined && requestedSpaceId !== undefined && owner.spaceId !== requestedSpaceId) {
    throw new Error(`Conversation ${conversationId} belongs to Space ${owner.spaceId}, not ${requestedSpaceId}.`);
  }
  const tree = await spaces.queries.getTree(owner.spaceId);
  if (tree === undefined) return { taskSoilInput };
  const fileItems = tree.entries
    .map((entry) => entry.item)
    .filter(isAgentAccessibleLocalReference);
  const generatedAttachmentIds = new Set(fileItems.map((item) => spaceReferenceAttachmentId(item.id)));
  const contextRefs = [
    ...fileItems.map(contextRefFor),
    ...(taskSoilInput?.contextRefs ?? []).filter((ref) =>
      ref.attachmentId === undefined || !generatedAttachmentIds.has(ref.attachmentId)
    ),
  ];
  const permissionBoundaryRefs = unique([
    spaceScopePermission(owner.spaceId),
    ...fileItems.flatMap(permissionRefsFor),
    ...(taskSoilInput?.permissionBoundaryRefs ?? []),
  ]);
  return {
    spaceId: owner.spaceId,
    taskSoilInput: { contextRefs, permissionBoundaryRefs },
  };
}

function isAgentAccessibleLocalReference(item: SpaceReferenceItem): item is AgentAccessibleSpaceReferenceItem {
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
    pathGranted: true,
    ...(item.sourceIdentity === undefined ? {} : { sourceIdentity: item.sourceIdentity }),
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
