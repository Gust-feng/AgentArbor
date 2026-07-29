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

export type KnowledgePage = {
  readonly refId: string;
  readonly kind: "note" | "material" | "space_reference";
  readonly collectedAt: number;
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

export type LegacyPersonalKnowledgeImport = {
  readonly importKey: string;
  readonly fallbackSpaceId: string;
  readonly notes: readonly {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly materialRefs?: readonly string[];
  }[];
  readonly pages: readonly KnowledgePage[];
  readonly links: readonly KnowledgeLink[];
  readonly themes: readonly KnowledgeTheme[];
  readonly assignments: readonly KnowledgeThemeAssignment[];
  readonly recentlyOpened: Readonly<Record<string, number>>;
};

export type PersonalKnowledgeCommand =
  | { readonly type: "note.create"; readonly note: PersonalNote }
  | { readonly type: "note.update"; readonly id: string; readonly expectedRevision: number; readonly title?: string; readonly bodyMarkdown?: string; readonly updatedAt: number }
  | { readonly type: "note.delete"; readonly id: string; readonly expectedRevision: number }
  | { readonly type: "note.reorder"; readonly orderedIds: readonly string[] }
  | { readonly type: "knowledge.collect"; readonly page: KnowledgePage }
  | { readonly type: "knowledge.uncollect"; readonly refId: string }
  | { readonly type: "knowledge.link_add"; readonly link: KnowledgeLink }
  | { readonly type: "knowledge.link_remove"; readonly link: KnowledgeLink }
  | { readonly type: "knowledge.opened"; readonly refId: string; readonly openedAt: number }
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
  searchNotes(input: { readonly query: string; readonly spaceId?: string; readonly limit: number }): Promise<readonly PersonalKnowledgeSearchResult[]>;
  execute(command: PersonalKnowledgeCommand): Promise<void>;
  importLegacy(input: LegacyPersonalKnowledgeImport): Promise<boolean>;
}

export type PersonalKnowledgeFeature = {
  readonly commands: {
    createNote(input: { readonly id?: string; readonly spaceId: string; readonly title?: string; readonly bodyMarkdown?: string; readonly materialRefs?: readonly string[] }): Promise<PersonalNote>;
    updateNote(input: { readonly id: string; readonly expectedRevision: number; readonly title?: string; readonly bodyMarkdown?: string }): Promise<void>;
    deleteNote(input: { readonly id: string; readonly expectedRevision: number }): Promise<void>;
    reorderNotes(orderedIds: readonly string[]): Promise<void>;
    execute(command: Exclude<PersonalKnowledgeCommand, { readonly type: "note.create" | "note.update" | "note.delete" | "note.reorder" }>): Promise<void>;
    importLegacy(input: LegacyPersonalKnowledgeImport): Promise<boolean>;
  };
  readonly queries: {
    snapshot(): Promise<PersonalKnowledgeSnapshot>;
    note(id: string): Promise<PersonalNote | undefined>;
    search(input: { readonly query: string; readonly spaceId?: string; readonly limit?: number }): Promise<readonly PersonalKnowledgeSearchResult[]>;
  };
  release(): Promise<void>;
};

export type PersonalKnowledgeErrorCode =
  | "personal_knowledge_released"
  | "personal_knowledge_invalid_input"
  | "personal_note_not_found"
  | "personal_note_revision_conflict"
  | "knowledge_theme_not_found"
  | "personal_knowledge_repository_failure";

export class PersonalKnowledgeError extends Error {
  readonly name = "PersonalKnowledgeError";

  constructor(readonly code: PersonalKnowledgeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
