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
    allowedTools: ["read_file", "shell_command", "spawn_sub_agent"],
    body: "Review carefully and report concrete evidence.",
  }]);
  const registry = new SubAgentRegistry({ roots: [root] });
  const tools = await createSubAgentAgentTools({
    registry,
    parentAllowedTools: ["read_file", "write_file", "spawn_sub_agent"],
    executableTools: ["read_file", "write_file", "spawn_sub_agent"],
    exposedToolNames: [CALL_SUB_AGENT_TOOL_NAME, SPAWN_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });

  assert.deepEqual(tools.map((tool) => tool.toolName), [
    CALL_SUB_AGENT_TOOL_NAME,
    SPAWN_SUB_AGENT_TOOL_NAME,
  ]);
  const call = tools[0]!;
  assert.deepEqual(call.inputSchema.required, ["sub_agent_name", "task", "context"]);
  assert.equal(call.inputSchema.additionalProperties, false);
  const invocation = await call.resolve({
    sub_agent_name: "review-expert",
    task: "Review the patch",
    context: "Focus on cancellation",
  });

  assert.equal(invocation.agentName, "review-expert");
  assert.equal(invocation.callerAgentId, "sub-agent:review-expert");
  assert.deepEqual(invocation.allowedTools, ["read_file"]);
  assert.match(invocation.instructions, /Review carefully/u);
  assert.match(invocation.input, /Review the patch/u);
  assert.match(invocation.input, /Focus on cancellation/u);
});

test("spawn_sub_agent distinguishes inheritance, no tools, explicit narrowing, and permission expansion", async (t) => {
  const root = await subAgentRoot(t, []);
  const [spawn] = await createSubAgentAgentTools({
    registry: new SubAgentRegistry({ roots: [root] }),
    parentAllowedTools: ["read_file", "shell_command", "call_sub_agent"],
    executableTools: ["read_file", "shell_command", "call_sub_agent"],
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
    "read_file",
    "shell_command",
  ]);
  assert.deepEqual((await spawn!.resolve({ ...base, allowed_tools: [] })).allowedTools, []);
  assert.deepEqual((await spawn!.resolve({ ...base, allowed_tools: ["read_file"] })).allowedTools, ["read_file"]);
  await assert.rejects(
    spawn!.resolve({ ...base, allowed_tools: ["write_file"] }),
    /requested unavailable tools: write_file/u,
  );
});

test("call_sub_agent fails closed when the discovered definition body changes", async (t) => {
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

test("call_sub_agent is absent when the frozen catalog has no enabled specialist", async (t) => {
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
    parentAllowedTools: ["read_file"],
    executableTools: ["read_file"],
    exposedToolNames: [CALL_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });
  const none = await createSubAgentAgentTools({
    registry,
    parentAllowedTools: ["read_file"],
    executableTools: ["read_file"],
    exposedToolNames: [],
    dynamicSpawnAvailable: true,
  });
  const unavailableSpawn = await createSubAgentAgentTools({
    registry,
    parentAllowedTools: ["read_file"],
    executableTools: ["read_file"],
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
  t.after(() => fs.rm(root, { recursive: true, force: true }));
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
