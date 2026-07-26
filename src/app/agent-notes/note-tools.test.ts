import assert from "node:assert/strict";
import test from "node:test";

import { createAgentNotesFeature } from "./agent-notes-feature.js";
import { createNoteWriteTool } from "./note-tools.js";
import type { AgentNoteRepository } from "./contracts.js";

function feature() {
  const notes = new Map<string, string>();
  const repository: AgentNoteRepository = {
    async read(scope) {
      const key = scope.kind === "global" ? "global" : `workspace:${scope.workspaceRoot}`;
      return { scope, content: notes.get(key) ?? "", updatedAt: notes.has(key) ? "2026-07-26T00:00:00.000Z" : undefined };
    },
    async write(scope, content, updatedAt) {
      const key = scope.kind === "global" ? "global" : `workspace:${scope.workspaceRoot}`;
      notes.set(key, content);
      return { scope, content, updatedAt };
    },
  };
  return createAgentNotesFeature({ repository, now: () => "2026-07-26T00:00:00.000Z" });
}

const context = { callerAgentId: "agent", traceId: "trace", goalId: "goal" };

test("NoteWrite exposes an explicit full-note replacement contract", () => {
  const tool = createNoteWriteTool({ notes: feature(), workspaceRoot: "/project" });
  assert.equal(tool.definition.name, "NoteWrite");
  assert.equal(tool.definition.metadata?.operationType, "read-write");
  assert.equal(tool.definition.metadata?.requiresConfirmation, false);
  assert.deepEqual(tool.definition.inputSchema.required, ["scope", "content"]);
  assert.match(tool.definition.description, /COMPLETE revised note/u);
});

test("NoteWrite lets the model save workspace and global notes without engineering interpretation", async () => {
  const notes = feature();
  const tool = createNoteWriteTool({ notes, workspaceRoot: "/project" });

  assert.deepEqual(
    await tool.execute({ scope: "workspace", content: "- Build: pnpm build." }, context),
    { status: "saved", scope: "workspace", characters: 20, updatedAt: "2026-07-26T00:00:00.000Z" },
  );
  await tool.execute({ scope: "global", content: "- Use Chinese." }, context);

  assert.equal((await notes.queries.get({ kind: "workspace", workspaceRoot: "/project" })).content, "- Build: pnpm build.");
  assert.equal((await notes.queries.get({ kind: "global" })).content, "- Use Chinese.");
});

test("NoteWrite reports malformed inputs as tool output instead of throwing", async () => {
  const tool = createNoteWriteTool({ notes: feature(), workspaceRoot: "/project" });
  assert.deepEqual(await tool.execute({ scope: "unknown", content: "x" }, context), {
    status: "invalid_input", message: 'scope must be "workspace" or "global".',
  });
  assert.deepEqual(await tool.execute({ scope: "workspace" }, context), {
    status: "invalid_input", message: "content must be a string containing the complete note.",
  });
});
