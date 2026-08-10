import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_NOTE_MAX_CHARS,
  AgentNotesError,
  type AgentNoteRepository,
  type AgentNoteScope,
  type AgentNotesFeature,
} from "./contracts.js";
import { createAgentNotesFeature } from "./agent-notes-feature.js";
import { createFileSystemAgentNoteRepository } from "./file-system-repository.js";
import { agentNoteContentVersion } from "./note-version.js";
import { agentNoteScopeIdentity } from "./scope-identity.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-agent-notes-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  let tick = 0;
  const feature = createAgentNotesFeature({
    repository: createFileSystemAgentNoteRepository(root),
    now: () => `2026-07-26T00:00:0${++tick}.000Z`,
  });
  return { root, feature };
}

async function replaceCurrent(
  feature: AgentNotesFeature,
  scope: AgentNoteScope,
  content: string,
) {
  const current = await feature.queries.get(scope);
  const result = await feature.commands.write({ scope, content, expectedVersion: current.version });
  assert.equal(result.status, "saved");
  if (result.status !== "saved") throw new Error("expected note write to succeed");
  return result.notebook;
}

test("agent notes start empty and persist workspace notes separately", async (t) => {
  const notes = await fixture(t);
  const workspaceA = { kind: "workspace", id: "workspace-a" } as const;
  const workspaceB = { kind: "workspace", id: "workspace-b" } as const;

  assert.deepEqual(await notes.feature.queries.get(workspaceA), {
    scope: workspaceA,
    content: "",
    version: agentNoteContentVersion(""),
    updatedAt: undefined,
  });

  await replaceCurrent(
    notes.feature,
    workspaceA,
    "# Project notes\n\n- Build with pnpm build.",
  );

  const saved = await notes.feature.queries.get(workspaceA);
  assert.equal(saved.content, "# Project notes\n\n- Build with pnpm build.");
  assert.notEqual(saved.updatedAt, undefined);
  assert.equal((await notes.feature.queries.get(workspaceB)).content, "");

  // The on-disk Markdown stays human-readable; the hashed directory only protects filenames.
  const workspaceDirectories = await fs.readdir(path.join(notes.root, "workspaces"));
  assert.equal(workspaceDirectories.length, 1);
  const storedDirectory = path.join(notes.root, "workspaces", workspaceDirectories[0]!);
  assert.equal(await fs.readFile(path.join(storedDirectory, "NOTES.md"), "utf8"), "# Project notes\n\n- Build with pnpm build.");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(storedDirectory, "owner.json"), "utf8")), workspaceA);
});

test("startup snapshot combines notes and freezes the matching content versions", async (t) => {
  const notes = await fixture(t);
  const owner = { kind: "workspace", id: "workspace-project" } as const;

  assert.deepEqual(await notes.feature.queries.startupSnapshot(owner), {
    injection: undefined,
    versions: {
      global: agentNoteContentVersion(""),
      owner: { scope: owner, version: agentNoteContentVersion("") },
    },
  });
  await replaceCurrent(notes.feature, { kind: "global" }, "- Reply in Chinese unless asked otherwise.");
  await replaceCurrent(notes.feature, owner, "- Tests use pnpm test.");

  assert.deepEqual(await notes.feature.queries.startupSnapshot(owner), {
    injection: "## 全局笔记\n\n- Reply in Chinese unless asked otherwise.\n\n## 当前工作区笔记\n\n- Tests use pnpm test.",
    versions: {
      global: agentNoteContentVersion("- Reply in Chinese unless asked otherwise."),
      owner: { scope: owner, version: agentNoteContentVersion("- Tests use pnpm test.") },
    },
  });
});

test("writing a note replaces the complete prior text and rejects silent overflow", async (t) => {
  const notes = await fixture(t);
  const scope = { kind: "global" } as const;
  await replaceCurrent(notes.feature, scope, "- Old conclusion.");
  const current = await replaceCurrent(notes.feature, scope, "- Revised conclusion.\n- New convention.");
  assert.equal((await notes.feature.queries.get(scope)).content, "- Revised conclusion.\n- New convention.");

  await assert.rejects(
    () => notes.feature.commands.write({
      scope,
      content: "x".repeat(AGENT_NOTE_MAX_CHARS + 1),
      expectedVersion: current.version,
    }),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_too_large",
  );
  assert.equal(
    (await notes.feature.queries.get(scope)).content,
    "- Revised conclusion.\n- New convention.",
    "an oversized write must not damage the prior note",
  );
});

test("explicit note deletion is a CAS-protected physical delete for global and owner scopes", async (t) => {
  const notes = await fixture(t);
  const global = await replaceCurrent(notes.feature, { kind: "global" }, "- Remove me.");
  const owner = { kind: "workspace", id: "workspace-note-delete" } as const;
  const ownerNotebook = await replaceCurrent(notes.feature, owner, "- Owner remove me.");

  const conflict = await notes.feature.commands.delete({
    scope: { kind: "global" },
    expectedVersion: agentNoteContentVersion("stale"),
  });
  assert.equal(conflict.status, "conflict");
  assert.equal((await notes.feature.queries.get({ kind: "global" })).content, "- Remove me.");

  const deletedGlobal = await notes.feature.commands.delete({ scope: { kind: "global" }, expectedVersion: global.version });
  assert.equal(deletedGlobal.status, "deleted");
  const deletedOwner = await notes.feature.commands.delete({ scope: owner, expectedVersion: ownerNotebook.version });
  assert.equal(deletedOwner.status, "deleted");
  assert.equal((await notes.feature.queries.get({ kind: "global" })).content, "");
  assert.equal((await notes.feature.queries.get(owner)).content, "");
});

test("two writers from the same stale version serialize and the second conflicts", async (t) => {
  const notes = await fixture(t);
  const scope = { kind: "global" } as const;
  const baseline = await notes.feature.queries.get(scope);

  const [first, second] = await Promise.all([
    notes.feature.commands.write({ scope, content: "- First writer.", expectedVersion: baseline.version }),
    notes.feature.commands.write({ scope, content: "- Second writer.", expectedVersion: baseline.version }),
  ]);

  assert.equal(first.status, "saved");
  assert.equal(second.status, "conflict");
  if (second.status !== "conflict") throw new Error("expected stale note conflict");
  assert.equal(second.current.content, "- First writer.");
  assert.equal(second.current.version, agentNoteContentVersion("- First writer."));
  assert.equal((await notes.feature.queries.get(scope)).content, "- First writer.");
});

test("a direct user edit after the baseline was read is preserved as a conflict", async (t) => {
  const notes = await fixture(t);
  const scope = { kind: "global" } as const;
  const baseline = await notes.feature.queries.get(scope);
  const notePath = path.join(notes.root, "global", "NOTES.md");
  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.writeFile(notePath, "- User edit.", "utf8");

  const result = await notes.feature.commands.write({
    scope,
    content: "- Stale model edit.",
    expectedVersion: baseline.version,
  });

  assert.equal(result.status, "conflict");
  if (result.status !== "conflict") throw new Error("expected manual edit conflict");
  assert.equal(result.current.content, "- User edit.");
  assert.equal(result.current.version, agentNoteContentVersion("- User edit."));
  assert.equal(await fs.readFile(notePath, "utf8"), "- User edit.");
});

test("a transient rename retry rechecks content changed during the retry window", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-agent-notes-retry-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const notePath = path.join(root, "global", "NOTES.md");
  let renameAttempts = 0;
  const feature = createAgentNotesFeature({
    repository: createFileSystemAgentNoteRepository(root, {
      async rename(source, target) {
        renameAttempts += 1;
        if (renameAttempts === 1) {
          throw Object.assign(new Error("target is temporarily busy"), { code: "EPERM" });
        }
        await fs.rename(source, target);
      },
      async waitBeforeRenameRetry() {
        await fs.mkdir(path.dirname(notePath), { recursive: true });
        await fs.writeFile(notePath, "- User edit during retry.", "utf8");
      },
    }),
  });
  const baseline = await feature.queries.get({ kind: "global" });

  const result = await feature.commands.write({
    scope: { kind: "global" },
    content: "- Model edit.",
    expectedVersion: baseline.version,
  });

  assert.equal(result.status, "conflict");
  assert.equal(renameAttempts, 1, "the second rename attempt must stop after revalidation detects the edit");
  assert.equal(await fs.readFile(notePath, "utf8"), "- User edit during retry.");
});

test("Space and Workspace owners with the same id remain isolated", async (t) => {
  const notes = await fixture(t);
  const space = { kind: "space", id: "same-id" } as const;
  const workspace = { kind: "workspace", id: "same-id" } as const;

  await replaceCurrent(notes.feature, space, "- Space convention.");
  await replaceCurrent(notes.feature, workspace, "- Workspace convention.");

  assert.equal((await notes.feature.queries.get(space)).content, "- Space convention.");
  assert.equal((await notes.feature.queries.get(workspace)).content, "- Workspace convention.");
  assert.notEqual(agentNoteScopeIdentity(space), agentNoteScopeIdentity(workspace));
});

test("the same owner uses CAS across writes and a stale second writer conflicts", async (t) => {
  const notes = await fixture(t);
  const owner = { kind: "space", id: "space-cas" } as const;
  const baseline = await notes.feature.queries.get(owner);

  const [first, second] = await Promise.all([
    notes.feature.commands.write({ scope: owner, content: "- First owner writer.", expectedVersion: baseline.version }),
    notes.feature.commands.write({ scope: owner, content: "- Second owner writer.", expectedVersion: baseline.version }),
  ]);

  assert.equal(first.status, "saved");
  assert.equal(second.status, "conflict");
  if (second.status !== "conflict") throw new Error("expected stale owner note conflict");
  assert.deepEqual(second.current.scope, owner);
  assert.equal((await notes.feature.queries.get(owner)).content, "- First owner writer.");
});

test("owner deletion removes only the concrete hash directory and preserves global notes", async (t) => {
  const notes = await fixture(t);
  const owner = { kind: "space", id: "space-to-delete" } as const;
  await replaceCurrent(notes.feature, { kind: "global" }, "- Keep this preference.");
  await replaceCurrent(notes.feature, owner, "- Remove this owner note.");

  const ownerDirectories = await fs.readdir(path.join(notes.root, "spaces"));
  assert.equal(ownerDirectories.length, 1);
  const ownerDirectory = path.join(notes.root, "spaces", ownerDirectories[0]!);
  assert.equal(await fs.readFile(path.join(ownerDirectory, "NOTES.md"), "utf8"), "- Remove this owner note.");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(ownerDirectory, "owner.json"), "utf8")), owner);

  await notes.feature.commands.deleteByOwner(owner);
  await notes.feature.commands.deleteByOwner(owner);

  assert.equal((await notes.feature.queries.get(owner)).content, "");
  await assert.rejects(fs.access(ownerDirectory), { code: "ENOENT" });
  assert.equal((await notes.feature.queries.get({ kind: "global" })).content, "- Keep this preference.");
  await assert.rejects(
    () => notes.feature.commands.deleteByOwner({ kind: "global" } as never),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_invalid_owner",
  );
  assert.equal((await notes.feature.queries.get({ kind: "global" })).content, "- Keep this preference.");
});

test("owner deletion drains admitted writes, rejects late writes, and leaves global notes writable", async () => {
  const contents = new Map<string, string>();
  let releaseAdmittedWrite!: () => void;
  let markWriteStarted!: () => void;
  const admittedWriteStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
  const admittedWriteGate = new Promise<void>((resolve) => { releaseAdmittedWrite = resolve; });
  const repository: AgentNoteRepository = {
    async read(scope) {
      const content = contents.get(agentNoteScopeIdentity(scope)) ?? "";
      return {
        scope,
        content,
        version: agentNoteContentVersion(content),
        updatedAt: contents.has(agentNoteScopeIdentity(scope)) ? "2026-07-26T00:00:00.000Z" : undefined,
      };
    },
    async write(input) {
      const key = agentNoteScopeIdentity(input.scope);
      const currentContent = contents.get(key) ?? "";
      const currentVersion = agentNoteContentVersion(currentContent);
      if (currentVersion !== input.expectedVersion) {
        return {
          status: "conflict",
          current: {
            scope: input.scope,
            content: currentContent,
            version: currentVersion,
            updatedAt: contents.has(key) ? "2026-07-26T00:00:00.000Z" : undefined,
          },
        };
      }
      if (input.scope.kind === "workspace" && input.content === "- admitted owner write.") {
        markWriteStarted();
        await admittedWriteGate;
      }
      contents.set(key, input.content);
      return {
        status: "saved",
        notebook: {
          scope: input.scope,
          content: input.content,
          version: agentNoteContentVersion(input.content),
          updatedAt: input.updatedAt,
        },
      };
    },
    async delete(input) {
      const current = await this.read(input.scope);
      if (current.version !== input.expectedVersion) return { status: "conflict", current };
      contents.delete(agentNoteScopeIdentity(input.scope));
      return {
        status: "deleted",
        notebook: {
          scope: input.scope,
          content: "",
          version: agentNoteContentVersion(""),
          updatedAt: undefined,
        },
      };
    },
    async deleteByOwner(owner) {
      contents.delete(agentNoteScopeIdentity(owner));
    },
  };
  const notes = createAgentNotesFeature({ repository, now: () => "2026-07-26T00:00:00.000Z" });
  const owner = { kind: "workspace", id: "workspace-delete-race" } as const;
  const baseline = await notes.queries.get(owner);
  const admitted = notes.commands.write({
    scope: owner,
    content: "- admitted owner write.",
    expectedVersion: baseline.version,
  });
  await admittedWriteStarted;

  const deleting = notes.commands.deleteByOwner(owner);
  await assert.rejects(
    () => notes.commands.write({ scope: owner, content: "- late owner write.", expectedVersion: baseline.version }),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_owner_deleted",
  );

  const globalBaseline = await notes.queries.get({ kind: "global" });
  const globalWrite = await notes.commands.write({
    scope: { kind: "global" },
    content: "- global remains writable.",
    expectedVersion: globalBaseline.version,
  });
  assert.equal(globalWrite.status, "saved");

  releaseAdmittedWrite();
  await admitted;
  await deleting;
  assert.equal((await notes.queries.get(owner)).content, "");
  assert.equal((await notes.queries.get({ kind: "global" })).content, "- global remains writable.");
  await assert.rejects(
    () => notes.commands.write({ scope: owner, content: "- recreate after delete.", expectedVersion: baseline.version }),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_owner_deleted",
  );
});

test("a failed owner-note deletion keeps its tombstone until an explicit retry succeeds", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-agent-notes-delete-retry-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const inner = createFileSystemAgentNoteRepository(root);
  let failDelete = true;
  const repository: AgentNoteRepository = {
    read: (scope) => inner.read(scope),
    write: (input) => inner.write(input),
    delete: (input) => inner.delete(input),
    async deleteByOwner(owner) {
      if (failDelete) {
        throw new AgentNotesError("note_io_failure", "simulated owner-note deletion failure");
      }
      await inner.deleteByOwner(owner);
    },
  };
  const notes = createAgentNotesFeature({ repository, now: () => "2026-07-26T00:00:00.000Z" });
  const owner = { kind: "space", id: "space-delete-retry" } as const;
  const baseline = await notes.queries.get(owner);
  await notes.commands.write({ scope: owner, content: "- retain until retry", expectedVersion: baseline.version });

  await assert.rejects(
    () => notes.commands.deleteByOwner(owner),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_io_failure",
  );
  assert.equal((await notes.queries.get(owner)).content, "- retain until retry");
  await assert.rejects(
    () => notes.commands.write({ scope: owner, content: "- late recreation", expectedVersion: baseline.version }),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_owner_deleted",
  );

  failDelete = false;
  await notes.commands.deleteByOwner(owner);
  assert.equal((await notes.queries.get(owner)).content, "");
  await assert.rejects(
    () => notes.commands.write({ scope: owner, content: "- post-delete recreation", expectedVersion: baseline.version }),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_owner_deleted",
  );
});

test("a legacy path-keyed record is not guessed during owner reads", async (t) => {
  const notes = await fixture(t);
  const legacyDirectory = path.join(notes.root, "workspaces", "legacy-path-hash");
  await fs.mkdir(legacyDirectory, { recursive: true });
  await fs.writeFile(path.join(legacyDirectory, "NOTES.md"), "- Legacy path note.", "utf8");
  await fs.writeFile(path.join(legacyDirectory, "workspace.json"), JSON.stringify({ workspaceRoot: "C:\\old-project" }), "utf8");

  const owner = { kind: "workspace", id: "remounted-workspace" } as const;
  assert.equal((await notes.feature.queries.get(owner)).content, "");

  // A later mount can resolve to any path; the stable owner still selects the same notebook.
  await replaceCurrent(notes.feature, owner, "- Stable owner note.");
  assert.equal((await notes.feature.queries.get(owner)).content, "- Stable owner note.");
  assert.equal((await notes.feature.queries.get({ kind: "workspace", id: "another-workspace" })).content, "");
});

test("the public note facade rejects a forged owner before touching the filesystem", async (t) => {
  const notes = await fixture(t);
  const forged = { kind: "../../outside" } as never;

  await assert.rejects(
    () => notes.feature.queries.get(forged),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_invalid_owner",
  );
  await assert.rejects(
    () => notes.feature.commands.write({
      scope: forged,
      content: "must not escape the notes root",
      expectedVersion: agentNoteContentVersion(""),
    }),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_invalid_owner",
  );
  assert.deepEqual(await fs.readdir(notes.root), [], "invalid owner input must not create an escaped directory");
});
