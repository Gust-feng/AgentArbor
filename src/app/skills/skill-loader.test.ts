import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverSkills, loadSkillBody, selectTriggeredSkills } from "./skill-loader.js";

test("discoverSkills loads SKILL.md metadata without reading resources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-"));
  try {
    const skillDir = path.join(root, "report-writer");
    await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Report Writer",
        "description: Drafts evidence-led reports.",
        "triggers:",
        "  - report",
        "  - summary",
        "---",
        "",
        "# Report Writer",
        "",
        "Use this body only after the skill is selected.",
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(path.join(skillDir, "references", "secret.txt"), "RESOURCE_SENTINEL", "utf8");

    const skills = await discoverSkills({ roots: [root] });

    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.id, "report-writer");
    assert.equal(skills[0]?.name, "Report Writer");
    assert.deepEqual(skills[0]?.triggers, ["report", "summary"]);
    assert.equal(JSON.stringify(skills).includes("RESOURCE_SENTINEL"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("selectTriggeredSkills ignores disabled skills and loadSkillBody reads body on demand", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-trigger-"));
  try {
    await fs.mkdir(path.join(root, "enabled"), { recursive: true });
    await fs.mkdir(path.join(root, "disabled"), { recursive: true });
    await fs.writeFile(
      path.join(root, "enabled", "SKILL.md"),
      "---\nname: Code Review\ndescription: Review code changes.\ntriggers: [review, bug]\n---\n\n# Body\n\nReview instructions.",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "disabled", "SKILL.md"),
      "---\nname: Disabled Review\ndescription: Should not trigger.\nenabled: false\ntriggers: [review]\n---\n\nDisabled body.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const triggered = selectTriggeredSkills("please review this bug fix", skills);
    const body = await loadSkillBody(triggered[0]!);

    assert.deepEqual(triggered.map((skill) => skill.name), ["Code Review"]);
    assert.equal(body.includes("Review instructions."), true);
    assert.equal(body.includes("---"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
