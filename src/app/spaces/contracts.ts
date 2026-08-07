/** Durable metadata for the roots visible in one Space. File descendants stay in their owning filesystem. */
export const SPACE_TREE_SCHEMA_VERSION = "space-tree/v4" as const;

export type SpaceReference =
  | { readonly kind: "local_file"; readonly path: string }
  | { readonly kind: "workspace_folder"; readonly path: string }
  | { readonly kind: "managed_folder"; readonly path: string }
  | { readonly kind: "asset_folder" }
  | { readonly kind: "workbench_asset"; readonly assetId: string }
  | { readonly kind: "web_page"; readonly url: string }
  | { readonly kind: "generated_artifact"; readonly artifactRef: string }
  | { readonly kind: "conversation"; readonly conversationId: string; readonly conversationTitle?: string };

/** References that may be created through the ordinary Space reference command. */
export type SpaceAddableReference = Exclude<SpaceReference, { readonly kind: "conversation" }>;

/** The two user-owned filesystem sources. They are links only; Space never owns their content. */
export type SpaceExternalFileReference =
  | Extract<SpaceReference, { readonly kind: "local_file" }>
  | Extract<SpaceReference, { readonly kind: "workspace_folder" }>;

export type Space = {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SpaceReferenceItem = {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly parentId?: string;
  readonly reference: SpaceReference;
  /** Stable platform identity for an external source; never used as a model-facing path. */
  readonly sourceIdentity?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SpaceTreeSnapshot = {
  readonly schemaVersion: typeof SPACE_TREE_SCHEMA_VERSION;
  /** Space order is durable display order; content edits must not reorder Spaces. */
  readonly spaces: readonly Space[];
  /** Display order for top-level references; index 0 is the top of a Space. */
  readonly referenceItems: readonly SpaceReferenceItem[];
};

export type SpaceTreeEntry = { readonly kind: "reference"; readonly item: SpaceReferenceItem };
export type SpaceTree = { readonly space: Space; readonly entries: readonly SpaceTreeEntry[] };
export type SpaceSummary = Pick<Space, "id" | "title" | "createdAt" | "updatedAt"> & {
  readonly folderCount: number;
  readonly referenceItemCount: number;
};

/** A conversation reference is its unique owning link into one Space. */
export type SpaceConversationOwner = {
  readonly spaceId: string;
  readonly referenceItemId: string;
};

export interface SpaceRepository {
  read(): Promise<SpaceTreeSnapshot>;
  write(snapshot: SpaceTreeSnapshot): Promise<void>;
}

/** Narrow cross-feature port for deleting software-owned Workbench assets. */
export interface SpaceOwnedAssetDeletionPort {
  deleteWorkbenchAssets(assetIds: readonly string[]): Promise<void>;
}

export type SpaceTarget = { readonly kind: "space" | "reference"; readonly id: string };
export type SpaceMovableTarget = { readonly kind: "reference"; readonly id: string };

export type SpaceFeatureErrorCode =
  | "space_feature_released"
  | "space_not_found"
  | "space_reference_not_found"
  | "space_invalid_move"
  | "space_workspace_mount_conflict"
  | "space_asset_ownership_conflict"
  | "space_conversation_ownership_conflict"
  | "space_invalid_input"
  | "space_id_collision"
  | "space_snapshot_incompatible"
  | "space_deletion_journal_failure"
  | "space_deletion_recovery_failed"
  | "space_repository_failure";

export class SpaceFeatureError extends Error {
  readonly name = "SpaceFeatureError";
  constructor(readonly code: SpaceFeatureErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export type SpaceEvent =
  | { readonly type: "space.created"; readonly space: Space }
  | { readonly type: "space.deleted"; readonly spaceId: string; readonly removedReferenceIds: readonly string[] }
  | { readonly type: "space.reference_added"; readonly item: SpaceReferenceItem }
  | { readonly type: "space.renamed"; readonly target: SpaceTarget; readonly spaceId: string }
  | { readonly type: "space.moved"; readonly target: SpaceMovableTarget; readonly sourceSpaceId: string; readonly destinationSpaceId: string }
  | { readonly type: "space.reference_removed"; readonly itemId: string; readonly removedItemIds: readonly string[]; readonly spaceId: string };

export type SpaceFeature = {
  /** Startup deletion reconciliation must settle before the Host accepts requests. */
  ready(): Promise<void>;
  readonly commands: {
    createSpace(input: { readonly id?: string; readonly title: string }): Promise<Space>;
    /** Deletes the Space container and Space-owned assets; external sources remain untouched. */
    deleteSpace(spaceId: string): Promise<void>;
    addReference(input: { readonly id?: string; readonly spaceId: string; readonly title: string; readonly parentId?: string; readonly reference: SpaceAddableReference }): Promise<SpaceReferenceItem>;
    /** Creates the sole owning link for a Conversation. This is reserved for the Conversation coordinator. */
    linkConversationOwner(input: { readonly id?: string; readonly spaceId: string; readonly title: string; readonly conversationId: string; readonly conversationTitle?: string }): Promise<SpaceReferenceItem>;
    rename(input: { readonly target: SpaceTarget; readonly title: string }): Promise<SpaceTarget>;
    move(input: { readonly target: SpaceMovableTarget; readonly destinationSpaceId: string }): Promise<SpaceMovableTarget>;
    /** Removes only an external/metadata link and never deletes an external source. Conversation owners use the coordinator command. */
    unlinkReference(itemId: string): Promise<void>;
    /** Removes all Conversation owner links for this conversation; coordinator-only and idempotent. */
    unlinkConversationReference(conversationId: string): Promise<void>;
    /** Removes one known conversation link without affecting a newer link with the same conversation id. */
    unlinkConversationReferenceItem(itemId: string): Promise<void>;
    /** Removes a Space-owned material and its source content through the durable deletion lifecycle. */
    removeReference(itemId: string): Promise<void>;
  };
  readonly queries: {
    list(): Promise<readonly SpaceSummary[]>;
    getTree(spaceId: string): Promise<SpaceTree | undefined>;
    getReference(itemId: string): Promise<SpaceReferenceItem | undefined>;
    findConversationOwner(conversationId: string): Promise<SpaceConversationOwner | undefined>;
  };
  readonly events: { subscribe(listener: (event: SpaceEvent) => void): () => void };
  /** Stops admission, drains accepted commands, and leaves no formal deletion journal on success. */
  release(): Promise<void>;
};
