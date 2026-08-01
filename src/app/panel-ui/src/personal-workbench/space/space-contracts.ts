/**
 * Redesign Space 只消费这些领域投影和动作契约。
 *
 * 文件树的事实仍由 SpaceFeature 提供；这里仅定义 Panel 需要的显示投影，
 * 不复制文件系统状态，也不区分另一套“旧空间”语义。
 */
export type PersonalSpaceItemProjection = {
  readonly itemId: string;
  readonly title: string;
  readonly kind:
    | "folder"
    | "local_file"
    | "workspace_folder"
    | "managed_folder"
    | "workbench_asset"
    | "web_reference"
    | "generated_artifact"
    | "conversation_reference";
  readonly detail?: string;
  readonly updatedAtLabel?: string;
  readonly openable?: boolean;
  readonly conversationId?: string;
  readonly openUrl?: string;
  readonly referenceId?: string;
  readonly assetId?: string;
  readonly children?: readonly PersonalSpaceItemProjection[];
};

export type PersonalSpaceProjection = {
  readonly spaceId: string;
  readonly title: string;
  readonly itemCount?: number;
  readonly description?: string;
  readonly color?: string;
  readonly items: readonly PersonalSpaceItemProjection[];
};

export type PersonalSpaceActions = {
  readonly createManagedFolder?: (spaceId: string, title: string) => void | Promise<void>;
  readonly addLocalFile?: (spaceId: string) => void | Promise<void>;
  readonly addWorkspaceFolder?: (spaceId: string) => void | Promise<void>;
  readonly addWebReference?: (spaceId: string, title: string, url: string) => void | Promise<void>;
  readonly addConversation?: (spaceId: string, conversationId: string, title: string) => void | Promise<void>;
  readonly move?: (
    sourceSpaceId: string,
    target: { readonly kind: "reference"; readonly id: string },
    destinationSpaceId: string,
  ) => void | Promise<void>;
  readonly rename?: (target: PersonalSpaceRenameTarget, title: string) => void | Promise<void>;
  /** Removes only the Space link and preserves the referenced source. */
  readonly unlinkReference?: (itemId: string) => void | Promise<void>;
  /** Removes the Space reference; the backend owns the physical deletion policy. */
  readonly removeReference?: (itemId: string) => void | Promise<void>;
};

export type PersonalSpaceRenameTarget = {
  readonly kind: "space" | "reference";
  readonly id: string;
};

export type PersonalSpaceConversationContext = {
  readonly conversationId: string;
  readonly title: string;
};
