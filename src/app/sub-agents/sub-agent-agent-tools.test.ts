import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SubAgentRegistry } from "./sub-agent-registry.js";
import {
  CALL_SUB_AGENT_TOOL_NAME,
  SPAWN_SUB_AGENT_TOOL_NAME,
  createSubAgentAgentToolCatalogContribution,
  createSubAgentAgentTools,
} from "./sub-agent-agent-tools.js";
import { ToolRegistry } from "../tool-center/tool-registry.js";

test("Sub-Agent contributions resolve a frozen definition and narrow inherited mechanical tools", async (t) => {
  const root = await subAgentRoot(t, [{
    name: "review-expert",
    description: "Review implementation facts.",
    allowedTools: ["Read", "Shell", "AgentSpawn"],
    body: "Review carefully and report concrete evidence.",
  }]);
  const registry = new SubAgentRegistry({ roots: [root] });
  const tools = await createSubAgentAgentTools({
    registry,
    parentAllowedTools: ["Read", "Write", "AgentSpawn"],
    executableTools: ["Read", "Write", "AgentSpawn"],
    exposedToolNames: [CALL_SUB_AGENT_TOOL_NAME, SPAWN_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });

  assert.deepEqual(tools.map((tool) => tool.toolName), [
    CALL_SUB_AGENT_TOOL_NAME,
    SPAWN_SUB_AGENT_TOOL_NAME,
  ]);
  const call = tools[0]!;
  const invocation = await call.resolve({
    sub_agent_name: "review-expert",
    task: "Review the patch",
    context: "Focus on cancellation",
  });

  assert.equal(invocation.agentName, "review-expert");
  assert.equal(invocation.callerAgentId, "sub-agent:review-expert");
  assert.deepEqual(invocation.allowedTools, ["Read"]);
  assert.match(invocation.instructions, /Review carefully/u);
  assert.match(invocation.input, /Review the patch/u);
  assert.match(invocation.input, /Focus on cancellation/u);
  const withoutContext = await call.resolve({
    sub_agent_name: "review-expert",
    task: "Review without extra context",
  });
  assert.doesNotMatch(withoutContext.input, /Context:/u);
});

test("agent_spawn distinguishes inheritance, no tools, explicit narrowing, and permission expansion", async (t) => {
  const root = await subAgentRoot(t, []);
  const [spawn] = await createSubAgentAgentTools({
    registry: new SubAgentRegistry({ roots: [root] }),
    parentAllowedTools: ["Read", "Shell", "Agent"],
    executableTools: ["Read", "Shell", "Agent"],
    exposedToolNames: [SPAWN_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });
  assert.equal(spawn?.toolName, SPAWN_SUB_AGENT_TOOL_NAME);

  const base = {
    role: "focused-reviewer",
    instructions: "Inspect only the requested boundary.",
    task: "Review the cancellation path",
    context: null,
  } as const;
  assert.deepEqual((await spawn!.resolve({ ...base, allowed_tools: null })).allowedTools, [
    "Read",
    "Shell",
  ]);
  assert.deepEqual((await spawn!.resolve({
    role: base.role,
    instructions: base.instructions,
    task: base.task,
  })).allowedTools, ["Read", "Shell"]);
  assert.deepEqual((await spawn!.resolve({ ...base, allowed_tools: [] })).allowedTools, []);
  assert.deepEqual((await spawn!.resolve({ ...base, allowed_tools: ["Read"] })).allowedTools, ["Read"]);
  // Duplicate requests are normalized without changing the granted tool identity.
  assert.deepEqual(
    (await spawn!.resolve({ ...base, allowed_tools: ["Read", "Read"] })).allowedTools,
    ["Read"],
  );
  await assert.rejects(
    spawn!.resolve({ ...base, allowed_tools: ["Write"] }),
    /requested unavailable tools: Write/u,
  );
});

test("agent_call fails closed when the discovered definition body changes", async (t) => {
  const root = await subAgentRoot(t, [{
    name: "hash-expert",
    description: "Checks frozen definitions.",
    body: "Original instructions.",
  }]);
  const registry = new SubAgentRegistry({ roots: [root] });
  const [call] = await createSubAgentAgentTools({
    registry,
    parentAllowedTools: [],
    executableTools: [],
    exposedToolNames: [CALL_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });
  await fs.appendFile(path.join(root, "hash-expert", "SUB_AGENT.md"), "\nChanged after discovery.\n", "utf8");

  await assert.rejects(
    call!.resolve({ sub_agent_name: "hash-expert", task: "Check", context: null }),
    /hash does not match the discovered catalog/u,
  );
});

test("agent_call restores the v0.3.2 built-in frozen identity without reviving legacy controls", async () => {
  const root = {
    rootPath: path.resolve("src/app/sub-agents/builtin"),
    sourceKind: "builtin" as const,
    sourceRootId: "builtin",
    precedence: 0,
  };
  const discovered = await new SubAgentRegistry({ roots: [root] }).getByName("code-expert");
  assert.ok(discovered);
  const legacyContentHash = "sha256:872dbbc2a479f9aee8dce492053042b0b8541495bdd84ae3d144a89015083be2";
  const legacyBodyHash = "sha256:dde0f97736bfb9330705995a5a600c2bce1dc5f7531a6173abb02ee4f7b639a7";
  assert.equal(discovered.contentHash, legacyContentHash);
  assert.equal(discovered.bodyHash, legacyBodyHash);
  assert.equal(discovered.validationWarnings, undefined);
  const legacyCatalog = [{
    id: discovered.id,
    name: discovered.name,
    description: discovered.description,
    category: discovered.category,
    sourceKind: discovered.sourceKind,
    sourceRootId: discovered.sourceRootId,
    sourcePrecedence: discovered.sourcePrecedence,
    enabled: true,
    version: discovered.version,
    whenToUse: discovered.whenToUse,
    whenNotToUse: discovered.whenNotToUse,
    allowedTools: discovered.allowedTools,
    contentHash: legacyContentHash,
    bodyHash: legacyBodyHash,
    maxSteps: 50,
  }];
  const [call] = await createSubAgentAgentTools({
    registry: new SubAgentRegistry({ roots: [root], catalog: legacyCatalog }),
    parentAllowedTools: [],
    executableTools: [],
    exposedToolNames: [CALL_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });

  const invocation = await call?.resolve({
    sub_agent_name: "code-expert",
    task: "Check the frozen identity",
  });

  assert.ok(invocation);
  assert.equal("model" in invocation, false);
  assert.equal("maxSteps" in invocation, false);
});

test("agent_call is absent when the frozen catalog has no enabled specialist", async (t) => {
  const root = await subAgentRoot(t, [{
    name: "disabled-expert",
    description: "Disabled.",
    enabled: false,
    body: "Do not run.",
  }]);
  const tools = await createSubAgentAgentTools({
    registry: new SubAgentRegistry({ roots: [root] }),
    parentAllowedTools: [],
    executableTools: [],
    exposedToolNames: [CALL_SUB_AGENT_TOOL_NAME, SPAWN_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });
  assert.deepEqual(tools.map((tool) => tool.toolName), [SPAWN_SUB_AGENT_TOOL_NAME]);
});

test("Sub-Agent AgentTools only materialize names allowed by the frozen run boundary", async (t) => {
  const root = await subAgentRoot(t, [{
    name: "reviewer",
    description: "Reviews one bounded change.",
    body: "Review the requested change.",
  }]);
  const registry = new SubAgentRegistry({ roots: [root] });

  const callOnly = await createSubAgentAgentTools({
    registry,
    parentAllowedTools: ["Read"],
    executableTools: ["Read"],
    exposedToolNames: [CALL_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });
  const none = await createSubAgentAgentTools({
    registry,
    parentAllowedTools: ["Read"],
    executableTools: ["Read"],
    exposedToolNames: [],
    dynamicSpawnAvailable: true,
  });
  const unavailableSpawn = await createSubAgentAgentTools({
    registry,
    parentAllowedTools: ["Read"],
    executableTools: ["Read"],
    exposedToolNames: [SPAWN_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: false,
  });

  assert.deepEqual(callOnly.map((tool) => tool.toolName), [CALL_SUB_AGENT_TOOL_NAME]);
  assert.deepEqual(none, []);
  assert.deepEqual(unavailableSpawn, []);
});

test("Sub-Agent catalog contribution never installs a fake ToolCenter executor", async (t) => {
  const root = await subAgentRoot(t, [{
    name: "reviewer",
    description: "Reviews one bounded change.",
    body: "Review the requested change.",
  }]);
  const subAgents = await new SubAgentRegistry({ roots: [root] }).list();
  const contribution = createSubAgentAgentToolCatalogContribution({
    subAgents,
    dynamicSpawnAvailable: true,
  });
  const registry = new ToolRegistry();

  assert.deepEqual(contribution.definitions.map((definition) => definition.name), [
    CALL_SUB_AGENT_TOOL_NAME,
    SPAWN_SUB_AGENT_TOOL_NAME,
  ]);
  const callDescription = contribution.definitions.find((definition) => definition.name === CALL_SUB_AGENT_TOOL_NAME)?.description;
  const spawnDescription = contribution.definitions.find((definition) => definition.name === SPAWN_SUB_AGENT_TOOL_NAME)?.description;
  assert.equal(callDescription, "Delegate one bounded task to an available specialist.");
  assert.equal(spawnDescription, "Delegate one bounded task to a temporary specialist.");
  assert.doesNotMatch(spawnDescription, /saved|delegate to another agent/u);
  assert.equal(registry.createToolCenter("desktop-basic").has(CALL_SUB_AGENT_TOOL_NAME), false);
  assert.equal(registry.createToolCenter("desktop-basic").has(SPAWN_SUB_AGENT_TOOL_NAME), false);
});

type DefinitionFixture = {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly enabled?: boolean;
  readonly allowedTools?: readonly string[];
};

async function subAgentRoot(
  t: { after(callback: () => Promise<void>): void },
  definitions: readonly DefinitionFixture[],
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-sdk-sub-agent-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  for (const definition of definitions) {
    const directory = path.join(root, definition.name);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "SUB_AGENT.md"), [
      "---",
      `name: ${JSON.stringify(definition.name)}`,
      `description: ${JSON.stringify(definition.description)}`,
      `enabled: ${definition.enabled ?? true}`,
      ...(definition.allowedTools === undefined
        ? []
        : [`allowed-tools: ${JSON.stringify(definition.allowedTools)}`]),
      "---",
      "",
      definition.body,
      "",
    ].join("\n"), "utf8");
  }
  return root;
}