import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_NOTE_MAX_CHARS,
  AgentNotesError,
  type AgentNoteScope,
  type AgentNotesFeature,
} from "./contracts.js";
import { createAgentNotesFeature } from "./agent-notes-feature.js";
import { createFileSystemAgentNoteRepository } from "./file-system-repository.js";
import { agentNoteContentVersion } from "./note-version.js";
import { agentNoteWorkspaceIdentity } from "./scope-identity.js";

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
  const workspaceA = path.join(notes.root, "workspace-a");
  const workspaceB = path.join(notes.root, "workspace-b");

  assert.deepEqual(await notes.feature.queries.get({ kind: "workspace", workspaceRoot: workspaceA }), {
    scope: { kind: "workspace", workspaceRoot: workspaceA },
    content: "",
    version: agentNoteContentVersion(""),
    updatedAt: undefined,
  });

  await replaceCurrent(
    notes.feature,
    { kind: "workspace", workspaceRoot: workspaceA },
    "# Project notes\n\n- Build with pnpm build.",
  );

  const saved = await notes.feature.queries.get({ kind: "workspace", workspaceRoot: workspaceA });
  assert.equal(saved.content, "# Project notes\n\n- Build with pnpm build.");
  assert.notEqual(saved.updatedAt, undefined);
  assert.equal((await notes.feature.queries.get({ kind: "workspace", workspaceRoot: workspaceB })).content, "");

  // The on-disk Markdown stays human-readable; the hashed directory only protects filenames.
  const workspaceDirectories = await fs.readdir(path.join(notes.root, "workspaces"));
  assert.equal(workspaceDirectories.length, 1);
  const storedDirectory = path.join(notes.root, "workspaces", workspaceDirectories[0]!);
  assert.equal(await fs.readFile(path.join(storedDirectory, "NOTES.md"), "utf8"), "# Project notes\n\n- Build with pnpm build.");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(storedDirectory, "workspace.json"), "utf8")), { workspaceRoot: workspaceA });
});

test("startup snapshot combines notes and freezes the matching content versions", async (t) => {
  const notes = await fixture(t);
  const workspace = path.join(notes.root, "project");

  assert.deepEqual(await notes.feature.queries.startupSnapshot(workspace), {
    injection: undefined,
    versions: {
      global: agentNoteContentVersion(""),
      workspace: agentNoteContentVersion(""),
    },
  });
  await replaceCurrent(notes.feature, { kind: "global" }, "- Reply in Chinese unless asked otherwise.");
  await replaceCurrent(notes.feature, { kind: "workspace", workspaceRoot: workspace }, "- Tests use pnpm test.");

  assert.deepEqual(await notes.feature.queries.startupSnapshot(workspace), {
    injection: "## 全局笔记\n\n- Reply in Chinese unless asked otherwise.\n\n## 当前工作区笔记\n\n- Tests use pnpm test.",
    versions: {
      global: agentNoteContentVersion("- Reply in Chinese unless asked otherwise."),
      workspace: agentNoteContentVersion("- Tests use pnpm test."),
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

test("workspace scope identity folds case only on Windows", () => {
  const upper = agentNoteWorkspaceIdentity(path.join("workspace", "Project"));
  const lower = agentNoteWorkspaceIdentity(path.join("workspace", "project"));
  if (process.platform === "win32") assert.equal(upper, lower);
  else assert.notEqual(upper, lower);
});

test("agent notes enumerate established notebooks and publish committed writes", async (t) => {
  const notes = await fixture(t);
  const workspace = path.join(notes.root, "project");
  const changed: string[] = [];
  const unsubscribe = notes.feature.events.subscribe((event) => changed.push(event.notebook.content));

  await replaceCurrent(notes.feature, { kind: "global" }, "Global context");
  await replaceCurrent(
    notes.feature,
    { kind: "workspace", workspaceRoot: workspace },
    "Workspace context",
  );
  unsubscribe();

  const notebooks = await notes.feature.queries.list();
  assert.deepEqual(notebooks.map((notebook) => notebook.scope.kind), ["global", "workspace"]);
  assert.deepEqual(notebooks.map((notebook) => notebook.content), ["Global context", "Workspace context"]);
  assert.deepEqual(changed, ["Global context", "Workspace context"]);
});
