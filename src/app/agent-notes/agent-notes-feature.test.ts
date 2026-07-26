import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AGENT_NOTE_MAX_CHARS, AgentNotesError } from "./contracts.js";
import { createAgentNotesFeature } from "./agent-notes-feature.js";
import { createFileSystemAgentNoteRepository } from "./file-system-repository.js";

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

test("agent notes start empty and persist workspace notes separately", async (t) => {
  const notes = await fixture(t);
  const workspaceA = path.join(notes.root, "workspace-a");
  const workspaceB = path.join(notes.root, "workspace-b");

  assert.deepEqual(await notes.feature.queries.get({ kind: "workspace", workspaceRoot: workspaceA }), {
    scope: { kind: "workspace", workspaceRoot: workspaceA }, content: "", updatedAt: undefined,
  });

  await notes.feature.commands.write(
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

test("startup injection combines global and current-workspace notes without any search layer", async (t) => {
  const notes = await fixture(t);
  const workspace = path.join(notes.root, "project");

  assert.equal(await notes.feature.queries.startupInjection(workspace), undefined);
  await notes.feature.commands.write({ kind: "global" }, "- Reply in Chinese unless asked otherwise.");
  await notes.feature.commands.write({ kind: "workspace", workspaceRoot: workspace }, "- Tests use pnpm test.");

  assert.equal(
    await notes.feature.queries.startupInjection(workspace),
    "## 全局笔记\n\n- Reply in Chinese unless asked otherwise.\n\n## 当前工作区笔记\n\n- Tests use pnpm test.",
  );
});

test("writing a note replaces the complete prior text and rejects silent overflow", async (t) => {
  const notes = await fixture(t);
  const scope = { kind: "global" } as const;
  await notes.feature.commands.write(scope, "- Old conclusion.");
  await notes.feature.commands.write(scope, "- Revised conclusion.\n- New convention.");
  assert.equal((await notes.feature.queries.get(scope)).content, "- Revised conclusion.\n- New convention.");

  await assert.rejects(
    () => notes.feature.commands.write(scope, "x".repeat(AGENT_NOTE_MAX_CHARS + 1)),
    (error: unknown) => error instanceof AgentNotesError && error.code === "note_too_large",
  );
  assert.equal(
    (await notes.feature.queries.get(scope)).content,
    "- Revised conclusion.\n- New convention.",
    "an oversized write must not damage the prior note",
  );
});
