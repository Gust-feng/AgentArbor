import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileSystemSkillStateStore,
  skillStateKeyForFacts,
} from "./skill-state-store.js";

test("FileSystemSkillStateStore writes source-qualified state while reading legacy records", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-state-store-"));
  try {
    const filePath = path.join(directory, "skills-state.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        skills: [
          { skillId: "legacy-review", enabled: false, lastUsedAt: "2026-06-20T00:00:00.000Z" },
        ],
      }),
      "utf8"
    );
    const store = new FileSystemSkillStateStore(filePath);

    const legacy = await store.readStates();
    assert.equal(legacy.get("legacy-review")?.enabled, false);

    const stateKey = skillStateKeyForFacts({ skillId: "review", sourceRootId: "project" });
    await store.setEnabled(stateKey, false, {
      skillId: "review",
      stateKey,
      sourceKind: "project",
      sourceRootId: "project",
      sourcePrecedence: 100,
    });
    await store.markUsed(stateKey, "2026-06-21T00:00:00.000Z", {
      skillId: "review",
      stateKey,
      sourceKind: "project",
      sourceRootId: "project",
      sourcePrecedence: 100,
    });
    const states = await store.readStates();

    assert.equal(states.get(stateKey)?.skillId, "review");
    assert.equal(states.get(stateKey)?.enabled, false);
    assert.equal(states.get(stateKey)?.lastUsedAt, "2026-06-21T00:00:00.000Z");
    assert.equal(states.get(stateKey)?.sourceKind, "project");
    assert.equal(states.get("legacy-review")?.enabled, false);
    const raw = await fs.readFile(filePath, "utf8");
    assert.equal(raw.includes(`"stateKey": "${stateKey}"`), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("FileSystemSkillStateStore recovers a state file with trailing stale JSON fragments", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-state-store-"));
  try {
    const filePath = path.join(directory, "skills-state.json");
    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        version: 1,
        skills: [
          { skillId: "review", enabled: true },
        ],
      }, null, 2)}\n]\n}\n`,
      "utf8"
    );
    const store = new FileSystemSkillStateStore(filePath);

    const states = await store.readStates();
    assert.equal(states.get("review")?.enabled, true);

    const repaired = await fs.readFile(filePath, "utf8");
    assert.doesNotThrow(() => JSON.parse(repaired));
    assert.equal(repaired.includes("\n]\n}\n"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
