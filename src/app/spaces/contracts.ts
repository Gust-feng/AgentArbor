/**
 * 可操作空间的公开契约。
 *
 * SpaceTree 是用户组织工作材料的引用树，而不是平行文件系统：外部文件、网页、
 * 生成物和 Ordinary conversation 仍由各自 owner 持有。这里仅保存引用及其组织元数据。
 */
export const SPACE_TREE_SCHEMA_VERSION = "space-tree/v1" as const;

export type SpaceReference =
  | { readonly kind: "local_file"; readonly path: string }
  | { readonly kind: "workspace_folder"; readonly path: string }
  /** App-owned directory created by Space; its contents are real files on disk. */
  | { readonly kind: "managed_folder"; readonly path: string }
  | { readonly kind: "web_page"; readonly url: string }
  | { readonly kind: "generated_artifact"; readonly artifactRef: string }
  | {
      readonly kind: "conversation";
      /** Ordinary conversation identity remains owned by OrdinaryAgentFeature. */
      readonly conversationId: string;
      readonly conversationTitle?: string;
    };

export type Space = {
  readonly id: string;
  readonly title: string;
  readonly demoDataset?: "learning-workspace";
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SpaceFolder = {
  readonly id: string;
  readonly spaceId: string;
  /** Undefined means the folder is directly under its Space root. */
  readonly parentFolderId?: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SpaceReferenceItem = {
  readonly id: string;
  readonly spaceId: string;
  /** Undefined means the reference is directly under its Space root. */
  readonly parentFolderId?: string;
  readonly title: string;
  readonly reference: SpaceReference;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** The durable source fact. It is intentionally flat so cross-space moves are one write. */
export type SpaceTreeSnapshot = {
  readonly schemaVersion: typeof SPACE_TREE_SCHEMA_VERSION;
  readonly spaces: readonly Space[];
  readonly folders: readonly SpaceFolder[];
  readonly referenceItems: readonly SpaceReferenceItem[];
};

export type SpaceTreeEntry =
  | {
      readonly kind: "folder";
      readonly folder: SpaceFolder;
      readonly children: readonly SpaceTreeEntry[];
    }
  | { readonly kind: "reference"; readonly item: SpaceReferenceItem };

/** One-way query projection for Panel and protocol adapters. */
export type SpaceTree = {
  readonly space: Space;
  readonly entries: readonly SpaceTreeEntry[];
};

export type SpaceSummary = Pick<Space, "id" | "title" | "createdAt" | "updatedAt"> & {
  readonly folderCount: number;
  readonly referenceItemCount: number;
};

export interface SpaceRepository {
  read(): Promise<SpaceTreeSnapshot>;
  write(snapshot: SpaceTreeSnapshot): Promise<void>;
}

export type SpaceTarget =
  | { readonly kind: "space"; readonly id: string }
  | { readonly kind: "folder"; readonly id: string }
  | { readonly kind: "reference"; readonly id: string };

export type SpaceMovableTarget = Exclude<SpaceTarget, { readonly kind: "space" }>;

export type SpaceFeatureErrorCode =
  | "space_feature_released"
  | "space_not_found"
  | "space_folder_not_found"
  | "space_reference_not_found"
  | "space_parent_not_found"
  | "space_invalid_move"
  | "space_workspace_mount_conflict"
  | "space_invalid_input"
  | "space_id_collision"
  | "space_snapshot_incompatible"
  | "space_repository_failure";

export class SpaceFeatureError extends Error {
  readonly name = "SpaceFeatureError";

  constructor(
    readonly code: SpaceFeatureErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type SpaceEvent =
  | { readonly type: "space.created"; readonly space: Space }
  | { readonly type: "space.folder_created"; readonly folder: SpaceFolder }
  | { readonly type: "space.reference_added"; readonly item: SpaceReferenceItem }
  | { readonly type: "space.renamed"; readonly target: SpaceTarget }
  | { readonly type: "space.moved"; readonly target: SpaceMovableTarget; readonly destinationSpaceId: string; readonly destinationFolderId?: string }
  /** Removes an internal organization subtree. External objects referenced by that subtree remain untouched. */
  | { readonly type: "space.folder_removed"; readonly folderId: string }
  /** This only removes the SpaceTree reference; the referenced external object is untouched. */
  | { readonly type: "space.reference_removed"; readonly itemId: string };

export type SpaceFeature = {
  readonly commands: {
    createSpace(input: { readonly title: string }): Promise<Space>;
    createFolder(input: { readonly spaceId: string; readonly parentFolderId?: string; readonly title: string }): Promise<SpaceFolder>;
    addReference(input: {
      readonly spaceId: string;
      readonly parentFolderId?: string;
      readonly title: string;
      readonly reference: SpaceReference;
    }): Promise<SpaceReferenceItem>;
    rename(input: { readonly target: SpaceTarget; readonly title: string }): Promise<SpaceTarget>;
    move(input: {
      readonly target: SpaceMovableTarget;
      readonly destinationSpaceId: string;
      readonly destinationFolderId?: string;
    }): Promise<SpaceMovableTarget>;
    /** Removes an internal folder subtree and its metadata edges without deleting external resources. */
    removeFolder(folderId: string): Promise<void>;
    /** Removes only the SpaceTree entry; it must never delete the external resource. */
    removeReference(itemId: string): Promise<void>;
  };
  readonly queries: {
    list(): Promise<readonly SpaceSummary[]>;
    getTree(spaceId: string): Promise<SpaceTree | undefined>;
    getReference(itemId: string): Promise<SpaceReferenceItem | undefined>;
    /** True when the same physical workspace root is linked by another Space reference. */
    hasWorkspaceMountConflict(itemId: string): Promise<boolean>;
  };
  readonly events: {
    subscribe(listener: (event: SpaceEvent) => void): () => void;
  };
  release(): Promise<void>;
};
