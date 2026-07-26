import assert from "node:assert/strict";
import test from "node:test";
import { capabilitySnapshotWithTools } from "./deep-child-agent-runner-test-support.js";
import { projectMultiAgentCapabilitySnapshot } from "./multi-agent-capability-snapshot.js";

test("projectMultiAgentCapabilitySnapshot keeps Deep facts and removes Ordinary-only catalogs", () => {
  const base = capabilitySnapshotWithTools(["read"]);
  const source = {
    ...base,
    toolCatalog: {
      ...base.toolCatalog,
      tools: [
        ...base.toolCatalog.tools,
        { ...base.toolCatalog.tools[0]!, name: "agent_call", catalogOnly: true },
      ],
      allowedTools: [...base.toolCatalog.allowedTools, "agent_call"],
    },
    skillTrigger: {
      mode: "model",
      label: "semantic",
      modelRouterEnabled: true,
      summary: "ordinary-only routing",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    toolConfirmation: {
      policy: "prompt",
      label: "prompt",
      shellCommandConfirmation: "prompt",
      shellCommandRequiresConfirmation: true,
      summary: "confirm side effects",
      riskDisclosure: "test",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  } as const;

  const projected = projectMultiAgentCapabilitySnapshot(source);

  assert.equal("skillCatalog" in projected, false);
  assert.equal("subAgentCatalog" in projected, false);
  assert.equal("skillTrigger" in projected, false);
  assert.deepEqual(projected.toolCatalog.allowedTools, ["read"]);
  assert.deepEqual(projected.toolCatalog.tools.map((tool) => tool.name), ["read"]);
  assert.deepEqual(projected.mcpCatalog, source.mcpCatalog);
  assert.deepEqual(projected.workspace, source.workspace);
  assert.deepEqual(projected.toolConfirmation, source.toolConfirmation);
  assert.equal(projected.activeModel, source.activeModel);
  assert.equal(projected.modelCapabilities, source.modelCapabilities);
});
