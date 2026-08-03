import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_TREE_SCHEMA_VERSION,
  SpaceFeatureError,
  type SpaceReferenceItem,
  type SpaceRepository,
  type SpaceTreeSnapshot,
} from "./contracts.js";
import type {
  SpaceReferenceDeletionJournalRecord,
  SpaceReferenceDeletionJournalStore,
  SpaceReferenceDeletionTarget,
} from "./file-system-reference-deletion-journal.js";
import {
  createSpaceReferenceDeletionLifecycle,
  type SpaceReferenceDeletionFilePort,
  type SpaceReferenceDeletionTargetState,
} from "./space-reference-deletion.js";

test("Space deletion rolls back every staged source when metadata persistence fails", async () => {
  const initial = snapshot(reference("managed", "managed_folder", "/managed/folder"));
  const repository = memoryRepository(initial, { failWrites: true });
  const journal = memoryJournal();
  const files = memoryFiles({ managed: { sourceExists: true, stagedExists: false } });
  const lifecycle = createSpaceReferenceDeletionLifecycle({
    repository,
    journal,
    files,
    leases: immediateLeases,
    createDeletionId: () => "delete-1",
  });

  await assert.rejects(lifecycle.remove({
    rootReferenceId: "managed",
    removedReferences: initial.referenceItems,
    nextSnapshot: snapshot(),
    createdAt: "2026-08-02T00:00:00.000Z",
  }), /metadata write failed/u);

  assert.deepEqual(files.state("managed"), { sourceExists: true, stagedExists: false });
  assert.deepEqual(await journal.list(), []);
  assert.deepEqual(await repository.read(), initial);
});

test("startup recovery restores a partially staged subtree when all metadata remains", async () => {
  const first = reference("managed", "managed_folder", "/managed/folder");
  const second = reference("local", "local_file", "/outside/note.md", "managed");
  const initial = snapshot(first, second);
  const journal = memoryJournal(journalRecord([first, second], [
    target(first, "/managed/.folder.staged"),
    target(second, "/outside/.note.md.staged"),
  ], "files_staged"));
  const files = memoryFiles({
    managed: { sourceExists: true, stagedExists: false },
    local: { sourceExists: false, stagedExists: true },
  });
  const lifecycle = createSpaceReferenceDeletionLifecycle({
    repository: memoryRepository(initial),
    journal,
    files,
    leases: immediateLeases,
  });

  await lifecycle.recover();

  assert.deepEqual(files.state("managed"), { sourceExists: true, stagedExists: false });
  assert.deepEqual(files.state("local"), { sourceExists: true, stagedExists: false });
  assert.deepEqual(await journal.list(), []);
});

test("startup recovery finalizes committed metadata and preserves a recreated source", async () => {
  const item = reference("local", "local_file", "/outside/note.md");
  const journal = memoryJournal(journalRecord(
    [item],
    [target(item, "/outside/.note.md.staged")],
    "files_staged",
  ));
  const files = memoryFiles({ local: { sourceExists: true, stagedExists: true } });
  const lifecycle = createSpaceReferenceDeletionLifecycle({
    repository: memoryRepository(snapshot()),
    journal,
    files,
    leases: immediateLeases,
  });

  await lifecycle.recover();

  assert.deepEqual(files.state("local"), { sourceExists: true, stagedExists: false });
  assert.deepEqual(await journal.list(), []);
});

test("startup recovery fails closed on partial metadata identity", async () => {
  const first = reference("managed", "managed_folder", "/managed/folder");
  const second = reference("local", "local_file", "/outside/note.md", "managed");
  const journal = memoryJournal(journalRecord([first, second], [], "prepared"));
  const lifecycle = createSpaceReferenceDeletionLifecycle({
    repository: memoryRepository(snapshot(first)),
    journal,
    files: memoryFiles({}),
    leases: immediateLeases,
  });

  await assert.rejects(
    lifecycle.recover(),
    (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_deletion_recovery_failed",
  );
  assert.equal((await journal.list()).length, 1);
});

test("startup recovery fails closed when uncommitted source and staged content are both missing", async () => {
  const item = reference("local", "local_file", "/outside/note.md");
  const journal = memoryJournal(journalRecord(
    [item],
    [target(item, "/outside/.note.md.staged")],
    "prepared",
  ));
  const lifecycle = createSpaceReferenceDeletionLifecycle({
    repository: memoryRepository(snapshot(item)),
    journal,
    files: memoryFiles({ local: { sourceExists: false, stagedExists: false } }),
    leases: immediateLeases,
  });

  await assert.rejects(
    lifecycle.recover(),
    (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_deletion_recovery_failed",
  );
  assert.equal((await journal.list()).length, 1);
});

function snapshot(...referenceItems: SpaceReferenceItem[]): SpaceTreeSnapshot {
  return {
    schemaVersion: SPACE_TREE_SCHEMA_VERSION,
    spaces: [{ id: "space", title: "Space", createdAt: "now", updatedAt: "now" }],
    referenceItems,
  };
}

function reference(
  id: string,
  kind: "local_file" | "managed_folder",
  sourcePath: string,
  parentId?: string,
): SpaceReferenceItem {
  return {
    id,
    spaceId: "space",
    title: id,
    ...(parentId === undefined ? {} : { parentId }),
    reference: { kind, path: sourcePath },
    createdAt: "now",
    updatedAt: "now",
  };
}

function target(item: SpaceReferenceItem, stagedPath: string): SpaceReferenceDeletionTarget {
  if (item.reference.kind !== "local_file" && item.reference.kind !== "managed_folder") {
    throw new Error("test reference is not owned");
  }
  return {
    referenceId: item.id,
    kind: item.reference.kind,
    sourcePath: item.reference.path,
    stagedPath,
  };
}

function journalRecord(
  removedReferences: readonly SpaceReferenceItem[],
  targets: readonly SpaceReferenceDeletionTarget[],
  phase: SpaceReferenceDeletionJournalRecord["phase"],
): SpaceReferenceDeletionJournalRecord {
  return {
    schemaVersion: "space-reference-deletion/v1",
    deletionId: "delete-recovery",
    phase,
    rootReferenceId: removedReferences[0]?.id ?? "missing",
    removedReferences,
    targets,
    createdAt: "2026-08-02T00:00:00.000Z",
  };
}

function memoryRepository(
  initial: SpaceTreeSnapshot,
  options: { readonly failWrites?: boolean } = {},
): SpaceRepository {
  let current = structuredClone(initial);
  return {
    async read() { return structuredClone(current); },
    async write(next) {
      if (options.failWrites) throw new Error("metadata write failed");
      current = structuredClone(next);
    },
  };
}

function memoryJournal(...initial: SpaceReferenceDeletionJournalRecord[]): SpaceReferenceDeletionJournalStore {
  const records = new Map(initial.map((record) => [record.deletionId, structuredClone(record)]));
  return {
    mutationKey: "/runtime/space-reference-deletions",
    async list() { return [...records.values()].map((record) => structuredClone(record)); },
    async save(record) { records.set(record.deletionId, structuredClone(record)); },
    async delete(deletionId) { records.delete(deletionId); },
  };
}

function memoryFiles(
  initial: Readonly<Record<string, SpaceReferenceDeletionTargetState>>,
): SpaceReferenceDeletionFilePort & { state(referenceId: string): SpaceReferenceDeletionTargetState | undefined } {
  const states = new Map(Object.entries(initial).map(([id, state]) => [id, { ...state }]));
  return {
    state(referenceId) {
      const value = states.get(referenceId);
      return value === undefined ? undefined : { ...value };
    },
    async prepare({ item, deletionId, targetIndex }) {
      const state = states.get(item.id);
      if (state === undefined || !state.sourceExists) return undefined;
      if (item.reference.kind !== "local_file" && item.reference.kind !== "managed_folder") return undefined;
      return target(item, `${item.reference.path}.staged-${deletionId}-${targetIndex}`);
    },
    async inspect(value) {
      return { ...(states.get(value.referenceId) ?? { sourceExists: false, stagedExists: false }) };
    },
    async stage(value) {
      const state = states.get(value.referenceId);
      if (state === undefined || !state.sourceExists || state.stagedExists) throw new Error("stage state is invalid");
      states.set(value.referenceId, { sourceExists: false, stagedExists: true });
    },
    async restore(value) {
      const state = states.get(value.referenceId);
      if (state === undefined || state.sourceExists || !state.stagedExists) throw new Error("restore state is invalid");
      states.set(value.referenceId, { sourceExists: true, stagedExists: false });
    },
    async removeStaged(value) {
      const state = states.get(value.referenceId);
      if (state === undefined || !state.stagedExists) return;
      states.set(value.referenceId, { ...state, stagedExists: false });
    },
  };
}

const immediateLeases = {
  async run<T>(_path: string, operation: () => Promise<T>): Promise<T> { return operation(); },
  async runExclusive<T>(_path: string, operation: () => Promise<T>): Promise<T> { return operation(); },
};
