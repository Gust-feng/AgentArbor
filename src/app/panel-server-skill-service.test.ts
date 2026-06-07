import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CapabilitySkillCatalogItem } from "../domain/config/index.js";
import { resolveTriggeredSkillContexts, type PanelSkillRuntime } from "./panel-server/skill-service.js";

test("resolveTriggeredSkillContexts uses the run-created skill catalog instead of current skill state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-snapshot-"));
  try {
    const skillPath = path.join(root, "SKILL.md");
    await fs.writeFile(
      skillPath,
      [
        "---",
        "name: Frozen Review",
        "description: Reviews code from the run-created snapshot.",
        "triggers:",
        "  - review",
        "---",
        "",
        "# Frozen Review",
        "",
        "Use the frozen skill instructions.",
      ].join("\n"),
      "utf8"
    );

    const frozenSkillCatalog: readonly CapabilitySkillCatalogItem[] = [
      {
        id: "frozen-review",
        name: "Frozen Review",
        description: "Reviews code from the run-created snapshot.",
        enabled: true,
        sourcePath: skillPath,
        triggers: ["review"],
      },
    ];
    const usedSkillIds: string[] = [];
    const runtime: PanelSkillRuntime = {
      skillRoots: [path.join(root, "current-skills")],
      capabilityCenter: {
        async listSkills() {
          throw new Error("current skill catalog must not be read for a frozen run");
        },
        invalidate() {},
      },
      skillStateStore: {
        async readStates() {
          throw new Error("current skill state must not be read for a frozen run");
        },
        async setEnabled() {
          throw new Error("setEnabled is not part of skill context resolution");
        },
        async markUsed(skillId) {
          usedSkillIds.push(skillId);
          return { skillId, lastUsedAt: "2026-06-05T00:00:00.000Z" };
        },
      },
    };

    const contexts = await resolveTriggeredSkillContexts(runtime, "please review this change", frozenSkillCatalog);

    assert.deepEqual(contexts.map((context) => context.skill.id), ["frozen-review"]);
    assert.equal(contexts[0]?.body.includes("Use the frozen skill instructions."), true);
    assert.deepEqual(usedSkillIds, ["frozen-review"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
