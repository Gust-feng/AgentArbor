import assert from "node:assert/strict";
import test from "node:test";

import { createAgentNotesFeature } from "./agent-notes-feature.js";
import { createNoteWriteTool } from "./note-tools.js";
import type { AgentNoteRepository } from "./contracts.js";
import { agentNoteContentVersion } from "./note-version.js";
import { agentNoteScopeIdentity } from "./scope-identity.js";

function feature() {
  const notes = new Map<string, string>();
  const repository: AgentNoteRepository = {
    async read(scope) {
      const key = agentNoteScopeIdentity(scope);
      const content = notes.get(key) ?? "";
      return {
        scope,
        content,
        version: agentNoteContentVersion(content),
        updatedAt: notes.has(key) ? "2026-07-26T00:00:00.000Z" : undefined,
      };
    },
    async write(input) {
      const { scope, content, expectedVersion, updatedAt } = input;
      const key = agentNoteScopeIdentity(scope);
      const currentContent = notes.get(key) ?? "";
      if (agentNoteContentVersion(currentContent) !== expectedVersion) {
        return {
          status: "conflict",
          current: {
            scope,
            content: currentContent,
            version: agentNoteContentVersion(currentContent),
            updatedAt: notes.has(key) ? "2026-07-26T00:00:00.000Z" : undefined,
          },
        };
      }
      notes.set(key, content);
      return {
        status: "saved",
        notebook: { scope, content, version: agentNoteContentVersion(content), updatedAt },
      };
    },
    async delete(input) {
      const key = agentNoteScopeIdentity(input.scope);
      const currentContent = notes.get(key) ?? "";
      const current = {
        scope: input.scope,
        content: currentContent,
        version: agentNoteContentVersion(currentContent),
        updatedAt: notes.has(key) ? "2026-07-26T00:00:00.000Z" : undefined,
      };
      if (current.version !== input.expectedVersion) return { status: "conflict", current };
      notes.delete(key);
      return {
        status: "deleted",
        notebook: { scope: input.scope, content: "", version: agentNoteContentVersion(""), updatedAt: undefined },
      };
    },
    async deleteByOwner(owner) {
      notes.delete(agentNoteScopeIdentity(owner));
    },
  };
  return createAgentNotesFeature({ repository, now: () => "2026-07-26T00:00:00.000Z" });
}

const context = { callerAgentId: "agent", traceId: "trace", goalId: "goal" };

test("NoteWrite exposes an explicit full-note replacement contract", () => {
  const tool = createNoteWriteTool({
    notes: feature(),
    owner: { kind: "workspace", id: "workspace-project" },
    initialVersions: {
      global: agentNoteContentVersion(""),
      owner: { scope: { kind: "workspace", id: "workspace-project" }, version: agentNoteContentVersion("") },
    },
  });
  assert.equal(tool.definition.name, "NoteWrite");
  assert.equal(tool.definition.metadata?.operationType, "read-write");
  assert.equal(tool.definition.metadata?.requiresConfirmation, false);
  assert.deepEqual(tool.definition.inputSchema.required, ["scope", "content"]);
  assert.deepEqual(tool.definition.inputSchema.properties.baseVersion, {
    type: "string",
    description:
      "Required after note_conflict: copy currentVersion exactly to acknowledge that you merged the returned currentContent.",
  });
  assert.match(tool.definition.description, /COMPLETE revised note/u);
});

test("NoteWrite lets the model save workspace and global notes without engineering interpretation", async () => {
  const notes = feature();
  const tool = createNoteWriteTool({
    notes,
    owner: { kind: "workspace", id: "workspace-project" },
    initialVersions: {
      global: agentNoteContentVersion(""),
      owner: { scope: { kind: "workspace", id: "workspace-project" }, version: agentNoteContentVersion("") },
    },
  });

  assert.deepEqual(
    await tool.execute({ scope: "owner", content: "- Build: pnpm build." }, context),
    {
      status: "saved",
      scope: "owner",
      characters: 20,
      version: agentNoteContentVersion("- Build: pnpm build."),
      updatedAt: "2026-07-26T00:00:00.000Z",
    },
  );
  assert.equal((await tool.execute({ scope: "owner", content: "- Build: pnpm build:node." }, context) as { status: string }).status, "saved");
  await tool.execute({ scope: "global", content: "- Use Chinese." }, context);

  assert.equal((await notes.queries.get({ kind: "workspace", id: "workspace-project" })).content, "- Build: pnpm build:node.");
  assert.equal((await notes.queries.get({ kind: "global" })).content, "- Use Chinese.");
});

test("NoteWrite requires an explicit merge baseline after conflict and then advances the run-local version", async () => {
  const notes = feature();
  const owner = { kind: "workspace", id: "workspace-project" } as const;
  const startup = await notes.queries.startupSnapshot(owner);
  const tool = createNoteWriteTool({ notes, owner, initialVersions: startup.versions });
  const external = await notes.commands.write({
    scope: { kind: "global" },
    content: "- New user preference.",
    expectedVersion: startup.versions.global,
  });
  assert.equal(external.status, "saved");

  const currentVersion = agentNoteContentVersion("- New user preference.");
  assert.deepEqual(await tool.execute({ scope: "global", content: "- Stale run preference." }, context), {
    status: "note_conflict",
    scope: "global",
    currentContent: "- New user preference.",
    currentVersion,
    currentUpdatedAt: "2026-07-26T00:00:00.000Z",
    message: "The note changed after this run started. Merge currentContent with your intended revision, then retry with currentVersion as baseVersion.",
  });
  assert.deepEqual(await tool.execute({ scope: "global", content: "- Stale run preference." }, context), {
    status: "note_conflict_acknowledgement_required",
    scope: "global",
    currentContent: "- New user preference.",
    currentVersion,
    currentUpdatedAt: "2026-07-26T00:00:00.000Z",
    message: "Copy currentVersion into baseVersion only after merging currentContent with your intended revision.",
  });
  assert.equal((await tool.execute({
    scope: "global",
    content: "- New user preference.\n- Merged run insight.",
    baseVersion: currentVersion,
  }, context) as { status: string }).status, "saved");
});

test("NoteWrite refuses an old run without frozen note versions", async () => {
  const tool = createNoteWriteTool({ notes: feature(), owner: { kind: "space", id: "space-project" } });
  assert.deepEqual(await tool.execute({ scope: "owner", content: "- Unsafe overwrite." }, context), {
    status: "note_baseline_unavailable",
    scope: "owner",
    message: "This run has no frozen note versions, so NoteWrite cannot replace a note safely. Do not retry in this run.",
  });
});

test("catalog-only NoteWrite never guesses an owner scope", async () => {
  const tool = createNoteWriteTool({ notes: feature() });
  assert.deepEqual(await tool.execute({ scope: "owner", content: "- Unsafe owner guess." }, context), {
    status: "memory_scope_unavailable",
    scope: "owner",
    message: "This tool has no frozen conversation owner and cannot write owner-scoped notes.",
  });
});

test("NoteWrite reports malformed inputs as tool output instead of throwing", async () => {
  const tool = createNoteWriteTool({ notes: feature(), owner: { kind: "space", id: "space-project" } });
  assert.deepEqual(await tool.execute({ scope: "unknown", content: "x" }, context), {
    status: "invalid_input", message: 'scope must be "owner" or "global".',
  });
  assert.deepEqual(await tool.execute({ scope: "owner" }, context), {
    status: "invalid_input", message: "content must be a string containing the complete note.",
  });
});

test("NoteWrite reports an owner deletion without recreating the notebook", async () => {
  const notes = feature();
  const owner = { kind: "workspace", id: "workspace-deleted" } as const;
  const startup = await notes.queries.startupSnapshot(owner);
  const tool = createNoteWriteTool({ notes, owner, initialVersions: startup.versions });

  await notes.commands.deleteByOwner(owner);
  const result = await tool.execute({ scope: "owner", content: "- late write" }, context);
  assert.deepEqual(result, {
    status: "memory_owner_deleted",
    scope: "owner",
    message: "The workspace owner workspace-deleted is being deleted or has already been deleted; owner notes cannot be recreated.",
  });

  const globalResult = await tool.execute({ scope: "global", content: "- global still works" }, context);
  assert.equal((globalResult as { readonly status: string }).status, "saved");
  assert.equal((await notes.queries.get(owner)).content, "");
});
