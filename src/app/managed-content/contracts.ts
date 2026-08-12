export const MANAGED_CONTENT_MAX_TEXT_BYTES = 5 * 1024 * 1024;

export type ManagedContentRoot = {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
};

export type ManagedContentTextFile = {
  readonly managedRootId: string;
  readonly relativePath: string;
  readonly text: string;
  readonly fingerprint: string;
};

export type ManagedContentEntryKind = "file" | "directory";

export type ManagedContentEvent =
  | { readonly type: "managed_content.root_changed"; readonly rootId: string }
  | { readonly type: "managed_content.file_changed"; readonly managedRootId: string; readonly relativePath: string }
  | { readonly type: "managed_content.file_deleted"; readonly managedRootId: string; readonly relativePath: string };

export type ManagedContentErrorCode =
  | "managed_content_released"
  | "managed_content_root_not_found"
  | "managed_content_space_not_found"
  | "managed_content_invalid_path"
  | "managed_content_path_escape"
  | "managed_content_entry_exists"
  | "managed_content_entry_not_found"
  | "managed_content_not_text"
  | "managed_content_revision_conflict"
  | "managed_content_io_failure";

export class ManagedContentError extends Error {
  readonly name = "ManagedContentError";

  constructor(readonly code: ManagedContentErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/** Narrow Space facade used by ManagedContentFeature; no Space store crosses the boundary. */
export type ManagedContentSpacePort = {
  listManagedRoots(): Promise<readonly ManagedContentRootRecord[]>;
  readManagedRoot(id: string): Promise<ManagedContentRootRecord | undefined>;
  createManagedRoot(input: ManagedContentRootRecord): Promise<void>;
  renameManagedRoot(id: string, title: string): Promise<void>;
  moveManagedRoot(id: string, spaceId: string): Promise<void>;
  removeManagedRoot(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
};

export type ManagedContentRootRecord = ManagedContentRoot & { readonly path: string };

export type ManagedContentFeature = {
  readonly commands: {
    createRoot(input: { readonly id?: string; readonly spaceId: string; readonly title: string }): Promise<ManagedContentRoot>;
    applyRoot(root: ManagedContentRoot): Promise<void>;
    deleteRoot(id: string): Promise<void>;
    createEntry(input: { readonly rootId: string; readonly parentRelativePath: string; readonly name: string; readonly kind: ManagedContentEntryKind }): Promise<{ readonly relativePath: string }>;
    renameEntry(input: { readonly rootId: string; readonly relativePath: string; readonly name: string }): Promise<{ readonly relativePath: string }>;
    deleteEntry(input: { readonly rootId: string; readonly relativePath: string }): Promise<void>;
    writeText(input: { readonly rootId: string; readonly relativePath: string; readonly text: string; readonly expectedFingerprint?: string }): Promise<ManagedContentTextFile>;
    deleteText(input: { readonly rootId: string; readonly relativePath: string }): Promise<void>;
  };
  readonly queries: {
    listRoots(): Promise<readonly ManagedContentRoot[]>;
    readRoot(id: string): Promise<ManagedContentRoot | undefined>;
    listTextFiles(rootId: string): Promise<readonly ManagedContentTextFile[]>;
    readTextFile(rootId: string, relativePath: string): Promise<ManagedContentTextFile | undefined>;
  };
  readonly events: { subscribe(listener: (event: ManagedContentEvent) => void): () => void };
  release(): Promise<void>;
};
