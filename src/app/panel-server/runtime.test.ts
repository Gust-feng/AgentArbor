import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPanelRuntime } from "./runtime.js";

test("Panel composition exposes catalog-only Sub-Agent definitions to Ordinary capability discovery", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-deep-capability-root-"));
  let runtime: ReturnType<typeof createPanelRuntime> | undefined;
  try {
    const subAgentRoot = path.join(directory, "sub-agents");
    await writeSubAgentPackage(subAgentRoot);
    runtime = createPanelRuntime({
      configDirectory: directory,
      subAgentRoots: [{
        rootPath: subAgentRoot,
        sourceKind: "project",
        sourceRootId: "project",
        precedence: 100,
      }],
    });

    const ordinarySnapshot = await runtime.capabilityCenter.snapshot();
    assert.equal(ordinarySnapshot.toolCatalog.tools.find((tool) => tool.name === "agent_call")?.catalogOnly, true);
    assert.equal(ordinarySnapshot.toolCatalog.tools.find((tool) => tool.name === "agent_spawn")?.catalogOnly, true);

  } finally {
    await runtime?.ordinaryAgentFeature.release();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function writeSubAgentPackage(root: string): Promise<void> {
  const packageDirectory = path.join(root, "reviewer");
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(packageDirectory, "SUB_AGENT.md"),
    [
      "---",
      "name: reviewer",
      "description: Review a bounded task.",
      "enabled: true",
      "allowedTools: [read]",
      "---",
      "",
      "Review the supplied task.",
    ].join("\n"),
    "utf8",
  );
}
