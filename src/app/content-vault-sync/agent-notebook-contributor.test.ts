import assert from "node:assert/strict";
import test from "node:test";

import { agentNoteContentVersion, type AgentNotebook, type AgentNoteScope } from "../agent-notes/index.js";
import { contentVaultHash, type ContentVaultResource } from "../content-vault/index.js";
import {
  createAgentNotebookContentVaultContributor,
  GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID,
} from "./agent-notebook-contributor.js";

test("Agent Notebook contributor synchronizes only the path-independent global notebook", async () => {
  let global: AgentNotebook = {
    scope: { kind: "global" },
    content: "Global context",
    version: agentNoteContentVersion("Global context"),
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
  const workspace: AgentNotebook = {
    scope: { kind: "workspace", id: "workspace-project" },
    content: "Workspace context",
    version: agentNoteContentVersion("Workspace context"),
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
  const listeners = new Set<() => void>();
  const contributor = createAgentNotebookContentVaultContributor({
    list: async () => [global, workspace],
    read: async (scope) => scope.kind === "global" ? global : workspace,
    async write(scope, content) {
      assert.equal(scope.kind, "global");
      global = {
        scope: { kind: "global" },
        content,
        version: agentNoteContentVersion(content),
        updatedAt: "2026-08-04T00:01:00.000Z",
      };
      for (const listener of listeners) listener();
      return global;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });

  const listed = await contributor.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.resourceId, GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID);
  assert.equal(listed[0]?.payload.content, "Global context");
  assert.equal(JSON.stringify(listed).includes("C:/private/project"), false);

  await contributor.apply(resource({
    notebookId: "global",
    label: "全局 Agent 笔记",
    scope: "global",
    content: "Synced context",
    updatedAt: "2026-08-04T00:00:30.000Z",
  }));
  assert.equal(global.content, "Synced context");
  assert.equal(workspace.content, "Workspace context");

  await contributor.apply(tombstone());
  assert.equal(global.content, "");
});

test("Agent Notebook contributor rejects workspace-shaped resources at the V1 payload boundary", async () => {
  const empty: AgentNotebook = {
    scope: { kind: "global" },
    content: "",
    version: agentNoteContentVersion(""),
    updatedAt: undefined,
  };
  const contributor = createAgentNotebookContentVaultContributor({
    list: async () => [empty],
    read: async (_scope: AgentNoteScope) => empty,
    write: async () => empty,
    subscribe: () => () => undefined,
  });

  await assert.rejects(contributor.apply(resource({
    notebookId: "global",
    label: "Workspace",
    scope: "workspace",
    content: "must stay local",
  })), /global/u);
});

function resource(payload: Readonly<Record<string, unknown>>): ContentVaultResource {
  return {
    kind: "agent_notebook",
    resourceId: GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID,
    revision: 1,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: contentVaultHash(payload),
    contentBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    updatedAt: "2026-08-04T00:00:30.000Z",
    updatedByDeviceId: "mobile-one",
  };
}

function tombstone(): ContentVaultResource {
  return {
    kind: "agent_notebook",
    resourceId: GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID,
    revision: 2,
    deleted: true,
    payloadSchemaVersion: 1,
    contentHash: `sha256:${"0".repeat(64)}`,
    contentBytes: 0,
    updatedAt: "2026-08-04T00:01:00.000Z",
    updatedByDeviceId: "mobile-one",
  };
}
