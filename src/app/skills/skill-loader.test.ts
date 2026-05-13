import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverSkills,
  getSkillDisclosure,
  loadSkillBody,
  selectTriggeredSkills,
  selectTriggeredSkillsWithStrategy,
} from "./skill-loader.js";

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

test("discoverSkills parses extended frontmatter fields (summary, category, scripts, references)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-extended-"));
  try {
    const skillDir = path.join(root, "researcher");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Researcher",
        "description: Conducts deep research.",
        "summary: A comprehensive research skill that gathers evidence from multiple sources.",
        "category: research",
        "triggers:",
        "  - research",
        "  - investigate",
        "scripts:",
        "  - scripts/search.ts",
        "  - scripts/analyze.ts",
        "references:",
        "  - refs/patterns.md",
        "---",
        "",
        "# Researcher",
        "",
        "Detailed research instructions.",
      ].join("\n"),
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const skill = skills[0]!;

    assert.equal(skill.id, "researcher");
    assert.equal(skill.summary, "A comprehensive research skill that gathers evidence from multiple sources.");
    assert.equal(skill.category, "research");
    assert.deepEqual(skill.scripts, [
      path.resolve(skillDir, "scripts/search.ts"),
      path.resolve(skillDir, "scripts/analyze.ts"),
    ]);
    assert.deepEqual(skill.references, [
      path.resolve(skillDir, "refs/patterns.md"),
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("discoverSkills backward compatible with SKILL.md files missing new fields", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-compat-"));
  try {
    const skillDir = path.join(root, "minimal");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: Minimal\ndescription: A minimal skill.\n---\n\nBody text.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const skill = skills[0]!;

    assert.equal(skill.name, "Minimal");
    assert.equal(skill.summary, undefined);
    assert.equal(skill.category, undefined);
    assert.equal(skill.scripts, undefined);
    assert.equal(skill.references, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("getSkillDisclosure returns correct content at each level", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-disclosure-"));
  try {
    const skillDir = path.join(root, "writer");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Writer",
        "description: Short desc.",
        "summary: A longer summary of what the writer skill does in practice.",
        "---",
        "",
        "# Writer",
        "",
        "Full body content here.",
      ].join("\n"),
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const skill = skills[0]!;

    assert.equal(getSkillDisclosure(skill, "header"), "Writer: Short desc.");
    assert.equal(getSkillDisclosure(skill, "summary"), "A longer summary of what the writer skill does in practice.");
    // "full" level falls back to summary (async body load is separate)
    assert.equal(getSkillDisclosure(skill, "full"), "A longer summary of what the writer skill does in practice.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("getSkillDisclosure falls back to description when summary is absent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-disclosure-fallback-"));
  try {
    const skillDir = path.join(root, "basic");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: Basic\ndescription: Fallback desc.\n---\n\nBody.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const skill = skills[0]!;

    assert.equal(getSkillDisclosure(skill, "summary"), "Fallback desc.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("selectTriggeredSkillsWithStrategy keyword strategy matches existing selectTriggeredSkills behaviour", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-strategy-kw-"));
  try {
    const skillDir = path.join(root, "checker");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: Checker\ndescription: Check code.\ntriggers: [check, lint]\n---\n\nCheck body.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const triggered = selectTriggeredSkillsWithStrategy("please check this file", skills, "keyword");

    assert.equal(triggered.length, 1);
    assert.equal(triggered[0]?.name, "Checker");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("selectTriggeredSkillsWithStrategy llm strategy returns all enabled skills", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-strategy-llm-"));
  try {
    await fs.mkdir(path.join(root, "skill-a"), { recursive: true });
    await fs.mkdir(path.join(root, "skill-b"), { recursive: true });
    await fs.mkdir(path.join(root, "skill-off"), { recursive: true });
    await fs.writeFile(
      path.join(root, "skill-a", "SKILL.md"),
      "---\nname: Skill A\ndescription: Alpha.\ntriggers: [alpha]\n---\n\nA body.",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "skill-b", "SKILL.md"),
      "---\nname: Skill B\ndescription: Beta.\ntriggers: [beta]\n---\n\nB body.",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "skill-off", "SKILL.md"),
      "---\nname: Skill Off\ndescription: Disabled.\nenabled: false\n---\n\nOff body.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const triggered = selectTriggeredSkillsWithStrategy("unrelated goal with no keywords", skills, "llm");

    assert.equal(triggered.length, 2);
    const names = triggered.map((s) => s.name).sort();
    assert.deepEqual(names, ["Skill A", "Skill B"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("selectTriggeredSkillsWithStrategy llm strategy returns empty when all skills disabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-strategy-llm-empty-"));
  try {
    const skillDir = path.join(root, "off");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: Off\ndescription: Disabled.\nenabled: false\n---\n\nBody.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const triggered = selectTriggeredSkillsWithStrategy("anything", skills, "llm");

    assert.equal(triggered.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
