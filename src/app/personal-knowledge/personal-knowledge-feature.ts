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
          await repository.execute({ type: "note.create", note });
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
        }));
      },
      async deleteNote(input) {
        await run(() => repository.execute({ type: "note.delete", id: required(input.id, "id"), expectedRevision: input.expectedRevision }));
      },
      async reorderNotes(orderedIds) {
        await run(() => repository.execute({ type: "note.reorder", orderedIds }));
      },
      async execute(command) {
        await run(async () => {
          const validated = validateCommand(command);
          if (validated.type === "knowledge.collect"
            && validated.page.kind === "space_reference"
            && !await options.spaceReferenceExists(validated.page.refId)) {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", `Space reference ${validated.page.refId} does not exist.`);
          }
          await repository.execute(validated);
        });
      },
      async importLegacy(legacyInput) {
        return await run(async () => {
          if (!await options.spaceExists(legacyInput.fallbackSpaceId)) {
            throw new PersonalKnowledgeError("personal_knowledge_invalid_input", `Space ${legacyInput.fallbackSpaceId} does not exist.`);
          }
          return await repository.importLegacy(legacyInput);
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
