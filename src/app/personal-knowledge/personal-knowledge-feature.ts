import { randomUUID } from "node:crypto";

import {
  PersonalKnowledgeError,
  type PersonalKnowledgeCommand,
  type PersonalKnowledgeFeature,
  type PersonalKnowledgeRepository,
} from "./contracts.js";

export function createPersonalKnowledgeFeature(options: {
  readonly repository: PersonalKnowledgeRepository;
  readonly spaceExists: (spaceId: string) => Promise<boolean>;
  readonly spaceReferenceExists: (itemId: string) => Promise<boolean>;
  readonly captureSpaceReference?: (input: { readonly assetId: string; readonly referenceId: string; readonly relativePath: string }) => Promise<NonNullable<import("./contracts.js").KnowledgePage["asset"]>>;
  readonly removeManagedAsset?: (itemId: string) => Promise<void>;
}): PersonalKnowledgeFeature {
  const repository = options.repository;
  let released = false;
  let queue = Promise.resolve();

  const ensureActive = (): void => {
    if (released) throw new PersonalKnowledgeError("personal_knowledge_released", "Personal knowledge feature is released.");
  };
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    ensureActive();
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return await result;
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
          return note;
        });
      },
      async updateNote(input) {
        await run(() => repository.execute({
          type: "note.update",
          id: required(input.id, "id"),
          expectedRevision: input.expectedRevision,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.bodyMarkdown === undefined ? {} : { bodyMarkdown: input.bodyMarkdown }),
          updatedAt: Date.now(),
          actor: input.actor ?? SYSTEM_ACTOR,
          changeSummary: input.changeSummary,
        }));
      },
      async deleteNote(input) {
        await run(() => repository.execute({
          type: "note.delete",
          id: required(input.id, "id"),
          expectedRevision: input.expectedRevision,
          deletedAt: Date.now(),
          actor: input.actor ?? SYSTEM_ACTOR,
          changeSummary: input.changeSummary,
        }));
      },
      async reorderNotes(orderedIds) {
        await run(() => repository.execute({ type: "note.reorder", orderedIds }));
      },
      async collectSpaceReference(input) {
        return await run(async () => {
          const referenceId = required(input.referenceId, "referenceId");
          const relativePath = normalizeSpaceReferenceRelativePath(input.relativePath);
          if (!await options.spaceReferenceExists(referenceId)) {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", `Space reference ${referenceId} does not exist.`);
          }
          if (options.captureSpaceReference === undefined) {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "Managed knowledge asset storage is unavailable.");
          }
          const existing = (await repository.readSnapshot()).pages.find((page) => page.kind === "space_reference"
            && page.asset?.sourceReferenceId === referenceId
            && page.asset.sourceRelativePath === relativePath);
          if (existing !== undefined) return existing;
          const refId = randomUUID();
          const asset = await options.captureSpaceReference({ assetId: refId, referenceId, relativePath });
          const page = { refId, kind: "space_reference" as const, collectedAt: Date.now(), asset };
          try {
            await repository.execute({ type: "knowledge.collect", page });
          } catch (error) {
            await options.removeManagedAsset?.(refId);
            throw error;
          }
          return page;
        });
      },
      async uncollect(refIdInput) {
        await run(async () => {
          const refId = required(refIdInput, "refId");
          await repository.execute({ type: "knowledge.uncollect", refId });
          await options.removeManagedAsset?.(refId);
        });
      },
      async execute(command) {
        await run(async () => {
          const validated = validateCommand(command);
          if (validated.type === "knowledge.collect" && validated.page.kind === "space_reference") {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "Space references must be collected through managed asset capture.");
          }
          await repository.execute(validated);
          if (validated.type === "knowledge.uncollect") {
            await options.removeManagedAsset?.(validated.refId);
          }
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
    async release() {
      if (released) return;
      released = true;
      await queue;
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

function validateCommand<T extends Exclude<PersonalKnowledgeCommand, { readonly type: "note.create" | "note.update" | "note.delete" | "note.reorder" }>>(command: T): T {
  if (command.type === "knowledge.link_add" && command.link.from === command.link.to) {
    throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "A knowledge page cannot link to itself.");
  }
  if (command.type === "theme.merge" && command.fromId === command.toId) {
    throw new PersonalKnowledgeError("personal_knowledge_invalid_input", "A theme cannot be merged into itself.");
  }
  return command;
}
