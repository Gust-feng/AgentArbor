import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createTaskSoil } from "../../domain/soil/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import {
  agentNoteContentVersion,
  type AgentNotesFeature,
} from "../agent-notes/index.js";
import { createSpaceFeature, type SpaceRepository, type SpaceTreeSnapshot } from "../spaces/index.js";
import {
  createHostAgentToolContributions,
  createHostFeatureAgentToolContributionResolver,
} from "./agent-tool-contributions.js";

test("Host keeps the NoteWrite catalog contract static and injects run-born note versions only into execution", async () => {
  let observedExpectedVersion: string | undefined;
  const notes: Pick<AgentNotesFeature, "commands" | "queries"> = {
    commands: {
      async write(command) {
        observedExpectedVersion = command.expectedVersion;
        return {
          status: "saved",
          notebook: {
            scope: command.scope,
            content: command.content,
            version: agentNoteContentVersion(command.content),
            updatedAt: "now",
          },
        };
      },
    },
    queries: {
      async get(scope) {
        return { scope, content: "", version: agentNoteContentVersion(""), updatedAt: undefined };
      },
      async startupSnapshot() {
        return {
          injection: undefined,
          versions: { global: agentNoteContentVersion(""), workspace: agentNoteContentVersion("") },
        };
      },
    },
  };
  const registrations: Array<{ readonly name: string; readonly scopes: readonly string[]; readonly enabledByDefault: boolean }> = [];
  const resolveFeatureContributions = createHostFeatureAgentToolContributionResolver({ agentNotes: notes });
  const versions = { global: agentNoteContentVersion("global"), workspace: agentNoteContentVersion("workspace") };
  const catalogContributions = resolveFeatureContributions({ workspaceRoot: "/workspace" });
  const runContributions = resolveFeatureContributions({ workspaceRoot: "/workspace", agentNoteVersions: versions });
  let catalogNoteWrite: ToolExecutor | undefined;
  let runNoteWrite: ToolExecutor | undefined;
  for (const contribution of catalogContributions) {
    contribution((entry) => {
      if (entry.executor.definition.name === "NoteWrite") catalogNoteWrite = entry.executor;
    });
  }
  const contributions = createHostAgentToolContributions({
    runtime: { constraints: [] },
    resources: { aiEnvironment: {}, workspaceRoot: "/workspace" } as never,
    featureContributions: runContributions,
  });

  for (const contribution of contributions) {
    contribution((entry) => {
      if (entry.executor.definition.name === "NoteWrite") runNoteWrite = entry.executor;
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
  assert.deepEqual(runNoteWrite?.definition, catalogNoteWrite?.definition);
  assert.equal((await runNoteWrite?.execute(
    { scope: "workspace", content: "next" },
    { callerAgentId: "agent", traceId: "trace", goalId: "goal" },
  ) as { status: string }).status, "saved");
  assert.equal(observedExpectedVersion, versions.workspace);
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
    "SpaceUnlinkReference",
    "SpaceRemoveReference",
    "SpaceRename",
    "SpaceWrite",
    "SpaceEdit",
  ]);
  assert.deepEqual(registrations.filter((name) => name.startsWith("Knowledge")), [
    "KnowledgeSearch",
    "KnowledgeRead",
    "KnowledgeCreateNote",
    "KnowledgeUpdateNote",
    "KnowledgeDeleteNote",
    "KnowledgeCollect",
  ]);
});

test("Host freezes Task Soil and workspace root into the Space contribution", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v3", spaces: [], referenceItems: [] };
  const repository: SpaceRepository = {
    async read() { return structuredClone(snapshot); },
    async write(next) { snapshot = structuredClone(next); },
  };
  let id = 0;
  const spaces = createSpaceFeature({ repository, idFactory: () => `space-id-${++id}`, now: () => "2026-08-02T00:00:00.000Z" });
  const space = await spaces.commands.createSpace({ title: "工作" });
  const workspaceRoot = path.resolve("host-space-workspace");
  const taskSoil = createTaskSoil({
    rawGoal: "organize the attached file",
    contextRefs: [{ attachmentId: "ctx-note", ref: "file:note.md", kind: "file" }],
    permissionBoundaryRefs: ["read:file:note.md"],
  });
  let addReference: ToolExecutor | undefined;
  for (const contribution of createHostFeatureAgentToolContributionResolver({ spaces })({ workspaceRoot, taskSoil })) {
    contribution((entry) => {
      if (entry.executor.definition.name === "SpaceAddReference") addReference = entry.executor;
    });
  }

  assert.notEqual(addReference, undefined);
  const result = await addReference!.execute({
    spaceId: space.id,
    title: "说明",
    reference: { kind: "local_attachment", attachmentId: "ctx-note" },
  }, { callerAgentId: "agent", traceId: "trace", goalId: "goal" }) as {
    readonly status: string;
    readonly item: { readonly reference: unknown };
  };
  assert.equal(result.status, "added");
  assert.deepEqual(result.item.reference, { kind: "local_file", path: path.join(workspaceRoot, "note.md") });
  await spaces.release();
});
