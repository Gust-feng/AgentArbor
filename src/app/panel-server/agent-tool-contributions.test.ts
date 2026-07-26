import assert from "node:assert/strict";
import test from "node:test";

import type { AgentNotesFeature } from "../agent-notes/index.js";
import { createHostAgentToolContributions } from "./agent-tool-contributions.js";

test("Host contributes NoteWrite to every desktop-basic Agent run when notes are available", () => {
  const notes: Pick<AgentNotesFeature, "commands" | "queries"> = {
    commands: { async write(scope, content) { return { scope, content, updatedAt: "now" }; } },
    queries: {
      async get(scope) { return { scope, content: "", updatedAt: undefined }; },
      async startupInjection() { return undefined; },
    },
  };
  const registrations: Array<{ readonly name: string; readonly scopes: readonly string[]; readonly enabledByDefault: boolean }> = [];
  const contributions = createHostAgentToolContributions({
    runtime: { constraints: [] },
    resources: { aiEnvironment: {}, workspaceRoot: "/workspace" } as never,
    agentNotes: notes,
  });

  for (const contribution of contributions) {
    contribution((entry) => {
      registrations.push({
        name: entry.executor.definition.name,
        scopes: entry.scopes,
        enabledByDefault: entry.enabledByDefault,
      });
    });
  }

  assert.deepEqual(registrations.find((item) => item.name === "NoteWrite"), {
    name: "NoteWrite",
    scopes: ["desktop-basic"],
    enabledByDefault: true,
  });
});
