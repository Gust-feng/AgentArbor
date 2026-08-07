import { randomUUID } from "node:crypto";

import {
  PersonalKnowledgeError,
  type PersonalKnowledgeCommand,
  type PersonalKnowledgeFeature,
  type PersonalKnowledgeEvent,
  type KnowledgePage,
  type PersonalKnowledgeRepository,
} from "./contracts.js";

export function createPersonalKnowledgeFeature<TManagedAssetTextWriteResult = unknown>(options: {
  readonly repository: PersonalKnowledgeRepository;
  readonly spaceExists: (spaceId: string) => Promise<boolean>;
  readonly captureSpaceReference?: (input: { readonly assetId: string; readonly referenceId: string; readonly relativePath: string }) => Promise<NonNullable<import("./contracts.js").KnowledgePage["asset"]> | undefined>;
  readonly removeManagedAsset?: (itemId: string) => Promise<void>;
  readonly stageManagedAssetRemoval?: (itemId: string) => Promise<{
    readonly commit: () => Promise<void>;
    readonly rollback: () => Promise<void>;
  } | undefined>;
  readonly runManagedAssetMutation?: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly writeManagedAssetText?: (input: {
    readonly page: KnowledgePage;
    readonly relativePath: string;
    readonly expectedFingerprint: string;
    readonly text: string;
  }) => Promise<TManagedAssetTextWriteResult>;
}): PersonalKnowledgeFeature<TManagedAssetTextWriteResult> {
  const repository = options.repository;
  let released = false;
  let queue = Promise.resolve();
  const listeners = new Set<(event: PersonalKnowledgeEvent) => void>();

  const ensureActive = (): void => {
    if (released) throw new PersonalKnowledgeError("personal_knowledge_released", "Personal knowledge feature is released.");
  };
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    ensureActive();
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return await result;
  };
  const runManagedAssetMutation = async <T>(operation: () => Promise<T>): Promise<T> =>
    options.runManagedAssetMutation === undefined ? await operation() : await options.runManagedAssetMutation(operation);
  const publish = (event: PersonalKnowledgeEvent): void => {
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* Observers cannot change the committed knowledge command result. */ }
    }
  };

  return {
    commands: {
      async createNote(noteInput) {
        return await run(async () => {
          const spaceId = required(noteInput.spaceId, "spaceId");
          if (!await options.spaceExists(spaceId)) {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", `Space ${spaceId} does not exist.`);
          }
          const now = Date.now();
          const note = {
            id: noteInput.id === undefined ? randomUUID() : required(noteInput.id, "id"),
            spaceId,
            title: noteInput.title ?? "",
            bodyMarkdown: noteInput.bodyMarkdown ?? "",
            materialRefs: noteInput.materialRefs ?? [],
            createdAt: now,
            updatedAt: now,
            revision: 1,
          };
          await repository.execute({ type: "note.create", note, actor: noteInput.actor ?? SYSTEM_ACTOR, changeSummary: noteInput.changeSummary });
          publish({ type: "personal_knowledge.note_created", noteId: note.id, spaceId: note.spaceId });
          return note;
        });
      },
      async updateNote(input) {
        await run(async () => {
          const id = required(input.id, "id");
          await repository.execute({
            type: "note.update",
            id,
            expectedRevision: input.expectedRevision,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.bodyMarkdown === undefined ? {} : { bodyMarkdown: input.bodyMarkdown }),
            updatedAt: Date.now(),
            actor: input.actor ?? SYSTEM_ACTOR,
            changeSummary: input.changeSummary,
          });
          publish({ type: "personal_knowledge.note_updated", noteId: id });
        });
      },
      async deleteNote(input) {
        await run(async () => {
          const id = required(input.id, "id");
          await repository.execute({
            type: "note.delete",
            id,
            expectedRevision: input.expectedRevision,
            deletedAt: Date.now(),
            actor: input.actor ?? SYSTEM_ACTOR,
            changeSummary: input.changeSummary,
          });
          publish({ type: "personal_knowledge.note_deleted", noteId: id });
        });
      },
      async reorderNotes(orderedIds) {
        await run(async () => {
          await repository.execute({ type: "note.reorder", orderedIds });
          publish({ type: "personal_knowledge.changed" });
        });
      },
      async collectSpaceReference(input) {
        return await run(() => runManagedAssetMutation(async () => {
          const referenceId = required(input.referenceId, "referenceId");
          const relativePath = normalizeSpaceReferenceRelativePath(input.relativePath);
          if (options.captureSpaceReference === undefined) {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "Managed knowledge asset storage is unavailable.");
          }
          const existing = (await repository.readSnapshot()).pages.find((page) => page.kind === "space_reference"
            && page.asset?.sourceReferenceId === referenceId
            && page.asset.sourceRelativePath === relativePath);
          if (existing !== undefined) return existing;
          const refId = randomUUID();
          const asset = await options.captureSpaceReference({ assetId: refId, referenceId, relativePath });
          if (asset === undefined) {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", `Space reference ${referenceId} does not exist.`);
          }
          const page = { refId, kind: "space_reference" as const, collectedAt: Date.now(), asset };
          try {
            await repository.execute({ type: "knowledge.collect", page });
          } catch (error) {
            await options.removeManagedAsset?.(refId);
            throw error;
          }
          publish({ type: "personal_knowledge.changed", refIds: [page.refId] });
          return page;
        }));
      },
      async updateManagedAssetText(input) {
        return await run(async () => {
          const refId = required(input.refId, "refId");
          const page = (await repository.readSnapshot()).pages.find((candidate) => candidate.refId === refId);
          if (page === undefined) {
            throw new PersonalKnowledgeError("knowledge_asset_not_found", "知识条目已不存在。");
          }
          if (page.asset?.status !== "managed") {
            throw new PersonalKnowledgeError("knowledge_asset_not_found", "这条旧知识尚未生成托管副本。");
          }
          if (options.writeManagedAssetText === undefined) {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "Managed knowledge asset storage is unavailable.");
          }
          const writeResult = await options.writeManagedAssetText({
            page,
            relativePath: input.relativePath,
            expectedFingerprint: input.expectedFingerprint,
            text: input.text,
          });
          publish({ type: "personal_knowledge.changed", refIds: [refId] });
          return { page, writeResult };
        });
      },
      async cleanupSpace(input) {
        await run(async () => {
          const referenceIds = [...new Set(input.referenceIds.map((value) => required(value, "referenceId")))];
          const spaceId = required(input.spaceId, "spaceId");
          const sourceReferenceIdSet = new Set(referenceIds);
          const snapshot = await repository.readSnapshot();
          const affectedPageIds = snapshot.pages
            .filter((page) => {
              if (page.asset?.status === "managed") {
                return page.asset?.sourceReferenceId !== undefined && sourceReferenceIdSet.has(page.asset.sourceReferenceId);
              }
              return snapshot.notes.some((note) => note.spaceId === spaceId && note.id === page.refId);
            })
            .map((page) => page.refId);
          await repository.execute({ type: "space.cleanup", spaceId, referenceIds });
          publish({
            type: "personal_knowledge.changed",
            ...(affectedPageIds.length === 0 ? {} : { refIds: affectedPageIds }),
          });
        });
      },
      async uncollect(refIdInput) {
        await run(() => runManagedAssetMutation(async () => {
          const refId = required(refIdInput, "refId");
          const staged = await options.stageManagedAssetRemoval?.(refId);
          try {
            await repository.execute({ type: "knowledge.uncollect", refId });
          } catch (error) {
            await staged?.rollback();
            throw error;
          }
          await staged?.commit();
          publish({ type: "personal_knowledge.changed", refIds: [refId] });
        }));
      },
      async execute(command) {
        await run(async () => {
          const validated = validateCommand(command);
          if (validated.type === "knowledge.collect" && validated.page.kind === "space_reference") {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "Space references must be collected through managed asset capture.");
          }
          await repository.execute(validated);
          publish({
            type: "personal_knowledge.changed",
            ...("refId" in validated && typeof validated.refId === "string" ? { refIds: [validated.refId] } : {}),
          });
        });
      },
    },
    queries: {
      async snapshot() {
        ensureActive();
        await queue;
        return await repository.readSnapshot();
      },
      async note(id) {
        ensureActive();
        await queue;
        return await repository.getNote(required(id, "id"));
      },
      async noteRevisions(id, limit = 50) {
        ensureActive();
        await queue;
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
          throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "limit must be an integer from 1 to 200.");
        }
        return await repository.listNoteRevisions(required(id, "id"), limit);
      },
      async search(input) {
        ensureActive();
        await queue;
        const query = required(input.query, "query");
        const spaceId = input.spaceId === undefined ? undefined : required(input.spaceId, "spaceId");
        const limit = input.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "limit must be an integer from 1 to 100.");
        }
        return await repository.searchNotes({ query, spaceId, limit });
      },
    },
    events: {
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    async release() {
      if (released) return;
      released = true;
      await queue;
      listeners.clear();
    },
  };
}

const SYSTEM_ACTOR = { kind: "system" } as const;

function normalizeSpaceReferenceRelativePath(value: string | undefined): string {
  return (value ?? "").trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new PersonalKnowledgeError("personal_knowledge_invalid_input", `${field} must not be empty.`);
  }
  return normalized;
}

function validateCommand<T extends Exclude<PersonalKnowledgeCommand,
  { readonly type: "note.create" | "note.update" | "note.delete" | "note.reorder" | "knowledge.uncollect" }
>>(command: T): T {
  if (command.type === "knowledge.link_add" && command.link.from === command.link.to) {
    throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "A knowledge page cannot link to itself.");
  }
  if (command.type === "theme.merge" && command.fromId === command.toId) {
    throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "A theme cannot be merged into itself.");
  }
  return command;
}
