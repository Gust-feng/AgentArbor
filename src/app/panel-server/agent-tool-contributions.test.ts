import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createTaskSoil } from "../../domain/soil/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import {
  agentNoteContentVersion,
  type AgentNotesFeature,
} from "../agent-notes/index.js";
import type { ConversationOwner } from "../../domain/execution-scope/index.js";
import { createSpaceFeature, type SpaceFeature, type SpaceRepository, type SpaceTreeSnapshot } from "../spaces/index.js";
import type { PersonalKnowledgeFeature } from "../personal-knowledge/index.js";
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
      async delete(command) {
        return {
          status: "deleted",
          notebook: {
            scope: command.scope,
            content: "",
            version: agentNoteContentVersion(""),
            updatedAt: undefined,
          },
        };
      },
      async deleteByOwner() {
        // This test exercises catalog and run-born NoteWrite wiring; owner
        // deletion is covered by the deletion coordinators.
      },
    },
    queries: {
      async get(scope) {
        return { scope, content: "", version: agentNoteContentVersion(""), updatedAt: undefined };
      },
      async startupSnapshot(owner: ConversationOwner) {
        return {
          injection: undefined,
          versions: {
            global: agentNoteContentVersion(""),
            owner: { scope: owner, version: agentNoteContentVersion("") },
          },
        };
      },
    },
  };
  const registrations: Array<{ readonly name: string; readonly scopes: readonly string[]; readonly enabledByDefault: boolean }> = [];
  const resolveFeatureContributions = createHostFeatureAgentToolContributionResolver({ agentNotes: notes });
  const owner = { kind: "workspace", id: "workspace-1" } as const;
  const versions = {
    global: agentNoteContentVersion("global"),
    owner: { scope: owner, version: agentNoteContentVersion("owner") },
  };
  const catalogContributions = resolveFeatureContributions({ workspaceRoot: "/workspace" });
  const runContributions = resolveFeatureContributions({ workspaceRoot: "/workspace", memoryOwner: owner, agentNoteVersions: versions });
  let catalogNoteWrite: ToolExecutor | undefined;
  let runNoteWrite: ToolExecutor | undefined;
  for (const contribution of catalogContributions) {
    contribution((entry) => {
      if (entry.executor.definition.name === "NoteWrite") catalogNoteWrite = entry.executor;
    });
  }
  const contributions = createHostAgentToolContributions({
    runtime: { constraints: [] },
    resources: { aiEnvironment: {}, workspaceRoot: "/workspace" },
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
    { scope: "owner", content: "next" },
    { callerAgentId: "agent", traceId: "trace", goalId: "goal" },
  ) as { status: string }).status, "saved");
  assert.equal(observedExpectedVersion, versions.owner.version);
});

test("Host selects feature-owned Space and Personal Knowledge contributions", () => {
  const registrations: string[] = [];
  const resolveFeatureContributions = createHostFeatureAgentToolContributionResolver({
    // Registration-only assertion: no command runs, so the unimplemented
    // command/query surfaces stay empty behind an explicit Pick cast.
    spaces: {
      commands: {},
      queries: {},
      events: { subscribe: () => () => {} },
    } as unknown as Pick<SpaceFeature, "commands" | "queries" | "events">,
    personalKnowledge: {
      commands: {},
      queries: {},
    } as unknown as Pick<PersonalKnowledgeFeature, "commands" | "queries">,
  });
  const contributions = resolveFeatureContributions({ workspaceRoot: "/workspace" });

  for (const contribution of contributions) {
    contribution((entry) => registrations.push(entry.executor.definition.name));
  }

  assert.deepEqual(registrations.filter((name) => name.startsWith("Space") || name === "ConversationDelete"), [
    "SpaceList",
    "SpaceCreate",
    "SpaceDelete",
    "ConversationDelete",
    "SpaceMove",
    "SpaceAddReference",
    "SpaceReadReference",
    "SpaceUpdateReferenceAnnotation",
    "SpaceUnlinkReference",
    "SpaceRemoveReference",
    "SpaceRename",
  ]);
  assert.deepEqual(registrations.filter((name) => name.startsWith("Knowledge")), [
    "KnowledgeSearch",
    "KnowledgeRead",
    "KnowledgeCreateNote",
    "KnowledgeUpdateNote",
    "KnowledgeDeleteNote",
    "KnowledgeCollect",
    "KnowledgeList",
    "KnowledgeReadPage",
    "KnowledgeUpdateAssetText",
    "KnowledgeUncollect",
    "KnowledgeCreateTheme",
    "KnowledgeAssignTheme",
    "KnowledgeUnassignTheme",
  ]);
});

test("Host forwards Space deletion admission and lifecycle callbacks into the contribution", async () => {
  const calls: string[] = [];
  const spaces = {
    commands: {},
    queries: {},
    events: { subscribe: () => () => {} },
  } as unknown as Pick<SpaceFeature, "commands" | "queries" | "events">;
  const tools = new Map<string, ToolExecutor>();
  const contributions = createHostFeatureAgentToolContributionResolver({
    spaces,
    assertSpaceAvailable: (spaceId) => calls.push(`assert:${spaceId}`),
    deleteSpace: async (spaceId) => { calls.push(`delete-space:${spaceId}`); },
    deleteConversation: async (conversationId) => { calls.push(`delete-conversation:${conversationId}`); },
  })({ workspaceRoot: "/workspace" });
  for (const contribution of contributions) {
    contribution((entry) => tools.set(entry.executor.definition.name, entry.executor));
  }

  const context = { callerAgentId: "agent", traceId: "trace", goalId: "goal" };
  assert.deepEqual(await tools.get("SpaceDelete")!.execute({ spaceId: "space-1" }, context), {
    status: "deleted",
    spaceId: "space-1",
  });
  assert.deepEqual(await tools.get("ConversationDelete")!.execute({ conversationId: "conversation-1" }, context), {
    status: "deleted",
    conversationId: "conversation-1",
  });
  assert.deepEqual(calls, ["assert:space-1", "delete-space:space-1", "delete-conversation:conversation-1"]);
});

test("Host freezes Task Soil and workspace root into the Space contribution", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v5", spaces: [], referenceItems: [] };
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
