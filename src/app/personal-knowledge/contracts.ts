export type PersonalNote = {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly materialRefs: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly revision: number;
};

export type PersonalKnowledgeActor = {
  readonly kind: "user" | "agent" | "system";
  readonly actorId?: string;
  readonly traceId?: string;
  readonly goalId?: string;
  readonly toolCallId?: string;
};

export type PersonalNoteRevision = {
  readonly noteId: string;
  readonly revision: number;
  readonly baseRevision?: number;
  readonly operation: "create" | "update" | "delete" | "snapshot";
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly actor: PersonalKnowledgeActor;
  readonly changeSummary?: string;
  readonly createdAt: number;
};

export type KnowledgePage = {
  readonly refId: string;
  readonly kind: "note" | "material" | "space_reference";
  readonly collectedAt: number;
  readonly asset?: {
    readonly status: "managed";
    readonly title: string;
    readonly sourceLabel: string;
    readonly contentKind: "file" | "directory";
    readonly sourceReferenceId?: string;
    readonly sourceRelativePath?: string;
  };
};

export type KnowledgeLink = { readonly from: string; readonly to: string };

export type KnowledgeTheme = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly origin: "agent" | "user";
};

export type KnowledgeThemeAssignment = {
  readonly refId: string;
  readonly themeId: string;
  readonly by: "agent" | "user";
  readonly locked: boolean;
};

export type PersonalKnowledgeSnapshot = {
  readonly notes: readonly PersonalNote[];
  readonly pages: readonly KnowledgePage[];
  readonly links: readonly KnowledgeLink[];
  readonly themes: readonly KnowledgeTheme[];
  readonly assignments: readonly KnowledgeThemeAssignment[];
  readonly recentlyOpened: Readonly<Record<string, number>>;
};

export type PersonalKnowledgeSearchResult = {
  readonly note: Omit<PersonalNote, "bodyMarkdown">;
  readonly snippet: string;
};

export type PersonalKnowledgeEvent =
  | { readonly type: "personal_knowledge.note_created"; readonly noteId: string; readonly spaceId: string }
  | { readonly type: "personal_knowledge.note_updated"; readonly noteId: string }
  | { readonly type: "personal_knowledge.note_deleted"; readonly noteId: string }
  | { readonly type: "personal_knowledge.changed"; readonly refIds?: readonly string[] };

export type PersonalKnowledgeCommand =
  | { readonly type: "note.create"; readonly note: PersonalNote; readonly actor: PersonalKnowledgeActor; readonly changeSummary?: string }
  | { readonly type: "note.update"; readonly id: string; readonly expectedRevision: number; readonly title?: string; readonly bodyMarkdown?: string; readonly updatedAt: number; readonly actor: PersonalKnowledgeActor; readonly changeSummary?: string }
  | { readonly type: "note.delete"; readonly id: string; readonly expectedRevision: number; readonly deletedAt: number; readonly actor: PersonalKnowledgeActor; readonly changeSummary?: string }
  | { readonly type: "note.reorder"; readonly orderedIds: readonly string[] }
  | { readonly type: "knowledge.collect"; readonly page: KnowledgePage }
  | { readonly type: "knowledge.uncollect"; readonly refId: string }
  | { readonly type: "knowledge.link_add"; readonly link: KnowledgeLink }
  | { readonly type: "knowledge.link_remove"; readonly link: KnowledgeLink }
  | { readonly type: "knowledge.opened"; readonly refId: string; readonly openedAt: number }
  | { readonly type: "space.cleanup"; readonly spaceId: string; readonly referenceIds: readonly string[] }
  | { readonly type: "theme.create"; readonly theme: KnowledgeTheme }
  | { readonly type: "theme.rename"; readonly themeId: string; readonly name: string }
  | { readonly type: "theme.delete"; readonly themeId: string }
  | { readonly type: "theme.merge"; readonly fromId: string; readonly toId: string }
  | { readonly type: "theme.assign"; readonly assignment: KnowledgeThemeAssignment }
  | { readonly type: "theme.unassign"; readonly refId: string; readonly themeId: string }
  | { readonly type: "theme.toggle_lock"; readonly refId: string; readonly themeId: string };

export interface PersonalKnowledgeRepository {
  readSnapshot(): Promise<PersonalKnowledgeSnapshot>;
  getNote(id: string): Promise<PersonalNote | undefined>;
  listNoteRevisions(id: string, limit: number): Promise<readonly PersonalNoteRevision[]>;
  searchNotes(input: { readonly query: string; readonly spaceId?: string; readonly limit: number }): Promise<readonly PersonalKnowledgeSearchResult[]>;
  execute(command: PersonalKnowledgeCommand): Promise<void>;
}

export type PersonalKnowledgeManagedAssetTextUpdate<TWriteResult = unknown> = {
  readonly page: KnowledgePage;
  readonly writeResult: TWriteResult;
};

export type PersonalKnowledgeFeature<TManagedAssetTextWriteResult = unknown> = {
  readonly commands: {
    createNote(input: { readonly id?: string; readonly spaceId: string; readonly title?: string; readonly bodyMarkdown?: string; readonly materialRefs?: readonly string[]; readonly actor?: PersonalKnowledgeActor; readonly changeSummary?: string }): Promise<PersonalNote>;
    updateNote(input: { readonly id: string; readonly expectedRevision: number; readonly title?: string; readonly bodyMarkdown?: string; readonly actor?: PersonalKnowledgeActor; readonly changeSummary?: string }): Promise<void>;
    deleteNote(input: { readonly id: string; readonly expectedRevision: number; readonly actor?: PersonalKnowledgeActor; readonly changeSummary?: string }): Promise<void>;
    reorderNotes(orderedIds: readonly string[]): Promise<void>;
    collectSpaceReference(input: { readonly referenceId: string; readonly relativePath?: string }): Promise<KnowledgePage>;
    updateManagedAssetText(input: {
      readonly refId: string;
      readonly relativePath: string;
      readonly expectedFingerprint: string;
      readonly text: string;
    }): Promise<PersonalKnowledgeManagedAssetTextUpdate<TManagedAssetTextWriteResult>>;
    uncollect(refId: string): Promise<void>;
    /** Deletes Space-owned notes and detaches copied knowledge assets from Space references. */
    cleanupSpace(input: { readonly spaceId: string; readonly referenceIds: readonly string[] }): Promise<void>;
    execute(command: Exclude<PersonalKnowledgeCommand, {
      readonly type: "note.create" | "note.update" | "note.delete" | "note.reorder" | "knowledge.uncollect" | "space.cleanup";
    }>): Promise<void>;
  };
  readonly queries: {
    snapshot(): Promise<PersonalKnowledgeSnapshot>;
    note(id: string): Promise<PersonalNote | undefined>;
    noteRevisions(id: string, limit?: number): Promise<readonly PersonalNoteRevision[]>;
    search(input: { readonly query: string; readonly spaceId?: string; readonly limit?: number }): Promise<readonly PersonalKnowledgeSearchResult[]>;
  };
  readonly events: { subscribe(listener: (event: PersonalKnowledgeEvent) => void): () => void };
  release(): Promise<void>;
};

export type PersonalKnowledgeErrorCode =
  | "personal_knowledge_released"
  | "personal_knowledge_invalid_input"
  | "personal_note_not_found"
  | "personal_note_revision_conflict"
  | "knowledge_asset_not_found"
  | "knowledge_asset_revision_conflict"
  | "knowledge_asset_source_missing"
  | "knowledge_asset_not_editable"
  | "knowledge_asset_write_failed"
  | "knowledge_theme_not_found"
  | "personal_knowledge_repository_failure";

export class PersonalKnowledgeError extends Error {
  readonly name = "PersonalKnowledgeError";

  constructor(readonly code: PersonalKnowledgeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
