import {
  parseContentVaultPayload,
  type ContentVaultResource,
} from "../content-vault/index.js";
import type { ContentVaultLocalResource, ContentVaultSyncContributor } from "./contracts.js";

export type PersonalNoteSyncRecord = {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly materialRefs: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly revision: number;
};

/** Host-facing port implemented from Personal Knowledge's public facade. */
export type PersonalNoteSyncPort = {
  list(): Promise<readonly PersonalNoteSyncRecord[]>;
  read(id: string): Promise<PersonalNoteSyncRecord | undefined>;
  create(input: {
    readonly id: string;
    readonly spaceId: string;
    readonly title: string;
    readonly bodyMarkdown: string;
    readonly materialRefs: readonly string[];
  }): Promise<void>;
  update(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly title: string;
    readonly bodyMarkdown: string;
  }): Promise<void>;
  delete(input: { readonly id: string; readonly expectedRevision: number }): Promise<void>;
  subscribe(listener: () => void): () => void;
};

export function createPersonalNoteContentVaultContributor(port: PersonalNoteSyncPort): ContentVaultSyncContributor {
  return {
    kind: "personal_note",
    async list() {
      return (await port.list()).map(projectPersonalNote);
    },
    async read(resourceId) {
      const note = await port.read(resourceId);
      return note === undefined ? undefined : projectPersonalNote(note);
    },
    async apply(resource) {
      const current = await port.read(resource.resourceId);
      if (resource.deleted) {
        if (current !== undefined) await port.delete({ id: current.id, expectedRevision: current.revision });
        return;
      }
      const payload = personalNotePayload(resource);
      if (current === undefined) {
        await port.create({
          id: resource.resourceId,
          spaceId: payload.spaceId,
          title: payload.title,
          bodyMarkdown: payload.bodyMarkdown,
          materialRefs: payload.materialRefs,
        });
        return;
      }
      if (current.spaceId !== payload.spaceId || !sameStrings(current.materialRefs, payload.materialRefs)) {
        throw new Error("Personal Knowledge cannot replace a note's Space or material references through its public command facade");
      }
      if (current.title === payload.title && current.bodyMarkdown === payload.bodyMarkdown) return;
      await port.update({
        id: current.id,
        expectedRevision: current.revision,
        title: payload.title,
        bodyMarkdown: payload.bodyMarkdown,
      });
    },
    subscribe: port.subscribe,
  };
}

function projectPersonalNote(note: PersonalNoteSyncRecord): ContentVaultLocalResource {
  return {
    kind: "personal_note",
    resourceId: note.id,
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("personal_note", {
      spaceId: note.spaceId,
      title: note.title,
      bodyMarkdown: note.bodyMarkdown,
      materialRefs: [...note.materialRefs],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      sourceRevision: note.revision,
    }),
  };
}

function personalNotePayload(resource: ContentVaultResource): {
  readonly spaceId: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly materialRefs: readonly string[];
} {
  const payload = parseContentVaultPayload("personal_note", resource.payload);
  return {
    spaceId: String(payload.spaceId),
    title: String(payload.title),
    bodyMarkdown: String(payload.bodyMarkdown),
    materialRefs: [...payload.materialRefs as readonly string[]],
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
