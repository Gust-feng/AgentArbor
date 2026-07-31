import assert from "node:assert/strict";
import test from "node:test";

import type { AgentNotesFeature } from "../agent-notes/index.js";
import {
  createHostAgentToolContributions,
  createHostFeatureAgentToolContributionResolver,
} from "./agent-tool-contributions.js";

test("Host contributes NoteWrite to every desktop-basic Agent run when notes are available", () => {
  const notes: Pick<AgentNotesFeature, "commands" | "queries"> = {
    commands: { async write(scope, content) { return { scope, content, updatedAt: "now" }; } },
    queries: {
      async get(scope) { return { scope, content: "", updatedAt: undefined }; },
      async startupInjection() { return undefined; },
    },
  };
  const registrations: Array<{ readonly name: string; readonly scopes: readonly string[]; readonly enabledByDefault: boolean }> = [];
  const resolveFeatureContributions = createHostFeatureAgentToolContributionResolver({ agentNotes: notes });
  const contributions = createHostAgentToolContributions({
    runtime: { constraints: [] },
    resources: { aiEnvironment: {}, workspaceRoot: "/workspace" } as never,
    featureContributions: resolveFeatureContributions({ workspaceRoot: "/workspace" }),
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

test("Host selects feature-owned Space and Personal Knowledge contributions", () => {
  const registrations: string[] = [];
  const resolveFeatureContributions = createHostFeatureAgentToolContributionResolver({
    spaces: { commands: {}, queries: {} } as never,
    personalKnowledge: { commands: {}, queries: {} } as never,
  });
  const contributions = resolveFeatureContributions({ workspaceRoot: "/workspace" });

  for (const contribution of contributions) {
    contribution((entry) => registrations.push(entry.executor.definition.name));
  }

  assert.deepEqual(registrations.filter((name) => name.startsWith("Space")), [
    "SpaceList",
    "SpaceCreate",
    "SpaceMove",
    "SpaceAddReference",
    "SpaceRemoveReference",
    "SpaceRename",
  ]);
  assert.deepEqual(registrations.filter((name) => name.startsWith("Knowledge")), [
    "KnowledgeSearch",
    "KnowledgeRead",
    "KnowledgeCreateNote",
    "KnowledgeUpdateNote",
    "KnowledgeCollect",
  ]);
});
