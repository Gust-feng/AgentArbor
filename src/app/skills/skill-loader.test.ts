import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverSkills,
  getSkillDisclosure,
  loadSkillBody,
  loadSkillBodyFacts,
  selectSkillsForGoal,
  selectTriggeredSkills,
  selectTriggeredSkillsWithStrategy,
} from "./skill-loader.js";
import type { SkillDefinition } from "../../domain/basic-agent/index.js";

function testSkill(input: {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly sourcePath?: string;
  readonly triggers?: readonly string[];
}): SkillDefinition {
  return {
    id: input.id,
    name: input.name ?? input.id,
    description: input.description ?? `Skill ${input.id}.`,
    enabled: input.enabled ?? true,
    sourcePath: input.sourcePath ?? `/${input.id}/SKILL.md`,
    triggers: input.triggers ?? [],
  };
}

test("discoverSkills loads standard SKILL.md metadata without reading resources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-"));
  try {
    const skillDir = path.join(root, "report-writer");
    await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: report-writer",
        "description: Drafts evidence-led reports when the user asks for a report or summary.",
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
    assert.equal(skills[0]?.name, "report-writer");
    assert.equal(skills[0]?.packageName, "report-writer");
    assert.equal(skills[0]?.loadError, undefined);
    assert.deepEqual(skills[0]?.triggers, ["report", "summary"]);
    assert.deepEqual(skills[0]?.resourceIndex, [{
      relativePath: "references/secret.txt",
      type: "reference",
      exists: true,
      source: "directory",
    }]);
    assert.equal(JSON.stringify(skills).includes("RESOURCE_SENTINEL"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("selectTriggeredSkills ignores disabled skills and loadSkillBody reads body on demand", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-trigger-"));
  try {
    await fs.mkdir(path.join(root, "code-review"), { recursive: true });
    await fs.mkdir(path.join(root, "disabled-review"), { recursive: true });
    await fs.writeFile(
      path.join(root, "code-review", "SKILL.md"),
      "---\nname: code-review\ndescription: Review code changes when the user asks for review or bug checks.\ntriggers: [review, bug]\n---\n\n# Body\n\nReview instructions.",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "disabled-review", "SKILL.md"),
      "---\nname: disabled-review\ndescription: Should not trigger even when review is mentioned.\nenabled: false\ntriggers: [review]\n---\n\nDisabled body.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const triggered = selectTriggeredSkills("please review this bug fix", skills);
    const body = await loadSkillBody(triggered[0]!);

    assert.deepEqual(triggered.map((skill) => skill.name), ["code-review"]);
    assert.equal(body.includes("Review instructions."), true);
    assert.equal(body.includes("---"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("selectSkillsForGoal selects explicit $name or $id references before keyword matches and dedupes conflicts", () => {
  const explicit = testSkill({
    id: "skill_id",
    name: "skill-name",
    description: "Selected only when explicitly referenced.",
  });
  const keywordDuplicate = testSkill({
    id: "keyword-review",
    name: "skill-name",
    description: "Shares the same name and should lose to the explicit skill.",
    triggers: ["review"],
  });
  const resultById = selectSkillsForGoal("use $skill_id", [explicit, keywordDuplicate]);
  const resultByName = selectSkillsForGoal("use $skill-name", [explicit]);
  const conflict = selectSkillsForGoal("use $skill_id and review", [keywordDuplicate, explicit]);

  assert.deepEqual(resultById.selectedSkills.map((skill) => skill.id), ["skill_id"]);
  assert.deepEqual(resultByName.selectedSkills.map((skill) => skill.id), ["skill_id"]);
  assert.equal(conflict.selectedSkills[0]?.id, "skill_id");
  assert.equal(conflict.candidateReasons[0]?.code, "explicit_invocation");
  assert.equal(conflict.omittedReasons.some((reason) =>
    reason.code === "duplicate_name" && reason.skillId === "keyword-review"
  ), true);
});

test("selectSkillsForGoal applies metadata maxChars with description truncation and candidate omission", () => {
  const result = selectSkillsForGoal("route with model", [
    testSkill({
      id: "budget-a",
      name: "budget-a",
      sourcePath: "/a",
      description: "A".repeat(120),
    }),
    testSkill({
      id: "budget-b",
      name: "budget-b",
      sourcePath: "/b",
      description: "B".repeat(120),
    }),
  ], { strategy: "llm", maxChars: 220 });

  assert.equal(result.selectedSkills.length, 0);
  assert.equal(result.needsModelRouting, true);
  assert.equal(result.candidateContexts.length, 1);
  assert.equal(result.candidateContexts[0]?.skillId, "budget-a");
  assert.equal(result.candidateContexts[0]?.descriptionTruncated, true);
  assert.equal(result.usedChars <= 220, true);
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "metadata_budget_omitted" && reason.skillId === "budget-b"
  ), true);
  assert.equal(result.warnings.some((warning) => warning.includes("description truncated")), true);
  assert.equal(result.warnings.some((warning) => warning.includes("metadata omitted")), true);
});

test("selectSkillsForGoal does not select disabled or invalid skills", () => {
  const invalid = {
    ...testSkill({
      id: "invalid-skill",
      name: "invalid-skill",
      triggers: ["review"],
    }),
    loadError: "Broken SKILL.md.",
  };
  const result = selectSkillsForGoal("use $disabled-skill $invalid-skill review", [
    testSkill({
      id: "valid-review",
      name: "valid-review",
      triggers: ["review"],
    }),
    testSkill({
      id: "disabled-skill",
      name: "disabled-skill",
      enabled: false,
      triggers: ["review"],
    }),
    invalid,
  ]);

  assert.deepEqual(result.selectedSkills.map((skill) => skill.id), ["valid-review"]);
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "disabled" && reason.skillId === "disabled-skill"
  ), true);
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "load_error" && reason.skillId === "invalid-skill"
  ), true);
});

test("discoverSkills parses compatible extended fields", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-extended-"));
  try {
    const skillDir = path.join(root, "researcher");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: researcher",
        "description: Conducts research when the task needs evidence from multiple sources.",
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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills parses Claude-compatible invocation control fields", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-invocation-fields-"));
  try {
    const skillDir = path.join(root, "deploy");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: deploy",
        "description: Deploys the current workspace when explicitly requested.",
        "when_to_use: Use only when the user explicitly asks to deploy.",
        "disable-model-invocation: true",
        "user-invocable: true",
        "---",
        "",
        "Deploy instructions.",
      ].join("\n"),
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });

    assert.equal(skill?.whenToUse, "Use only when the user explicitly asks to deploy.");
    assert.equal(skill?.disableModelInvocation, true);
    assert.equal(skill?.userInvocable, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills parses version and provenance metadata for distribution tracking", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-version-provenance-"));
  try {
    const skillDir = path.join(root, "versioned");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: versioned",
        "description: Tracks package version and origin metadata.",
        "version: 1.2.3",
        "provenance:",
        "  registry: local",
        "  plugin: repo-tools",
        "  revision: 7",
        "  verified: true",
        "  channels: [project, plugin]",
        "---",
        "",
        "Versioned body.",
      ].join("\n"),
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });

    assert.equal(skill?.version, "1.2.3");
    assert.deepEqual(skill?.provenance, {
      registry: "local",
      plugin: "repo-tools",
      revision: 7,
      verified: true,
      channels: ["project", "plugin"],
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("selectSkillsForGoal honors invocation control fields without deterministic semantic routing", () => {
  const autoDisabled = testSkill({
    id: "deploy",
    name: "deploy",
    description: "Deploys code.",
    triggers: ["deploy"],
  });
  const hiddenCommand = testSkill({
    id: "background-knowledge",
    name: "background-knowledge",
    description: "Background knowledge.",
    triggers: ["background"],
  });
  const routed = selectSkillsForGoal("please deploy", [
    { ...autoDisabled, disableModelInvocation: true },
  ], { strategy: "llm" });
  const explicit = selectSkillsForGoal("use $deploy", [
    { ...autoDisabled, disableModelInvocation: true },
  ], { strategy: "llm" });
  const notUserInvocable = selectSkillsForGoal("use $background-knowledge", [
    { ...hiddenCommand, userInvocable: false },
  ], { strategy: "llm" });

  assert.deepEqual(routed.candidateContexts, []);
  assert.equal(routed.omittedReasons.some((reason) => reason.code === "model_invocation_disabled"), true);
  assert.deepEqual(explicit.selectedSkills.map((skill) => skill.id), ["deploy"]);
  assert.deepEqual(notUserInvocable.selectedSkills, []);
  assert.equal(notUserInvocable.omittedReasons.some((reason) => reason.code === "not_user_invocable"), true);
});

test("discoverSkills remains compatible with standard minimal SKILL.md files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-compat-"));
  try {
    const skillDir = path.join(root, "minimal");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: minimal\ndescription: A minimal skill used when no optional fields are required.\n---\n\nBody text.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const skill = skills[0]!;

    assert.equal(skill.name, "minimal");
    assert.equal(skill.summary, undefined);
    assert.equal(skill.category, undefined);
    assert.equal(skill.scripts, undefined);
    assert.equal(skill.references, undefined);
    assert.equal(skill.loadError, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills parses nested metadata, compatibility, license, and allowed-tools", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-standard-fields-"));
  try {
    const skillDir = path.join(root, "patch-helper");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: patch-helper",
        "description: Helps prepare patch-oriented implementation work when code edits are requested.",
        "license: MIT",
        "compatibility:",
        "  platforms:",
        "    - codex",
        "    - agentarbor",
        "metadata:",
        "  owner: runtime",
        "  priority: 2",
        "  nested:",
        "    stable: true",
        "    tags:",
        "      - patch",
        "      - review",
        "allowed-tools:",
        "  - read",
        "  - shell",
        "---",
        "",
        "Patch body.",
      ].join("\n"),
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });

    assert.equal(skill?.license, "MIT");
    assert.deepEqual(skill?.compatibility, { platforms: ["codex", "agentarbor"] });
    assert.deepEqual(skill?.metadata, {
      owner: "runtime",
      priority: 2,
      nested: {
        stable: true,
        tags: ["patch", "review"],
      },
    });
    assert.deepEqual(skill?.allowedTools, ["read", "shell"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills parses standard YAML frontmatter features", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-yaml-standard-"));
  try {
    const skillDir = path.join(root, "yaml-standard");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: yaml-standard",
        "description: |",
        "  Handles multi-line descriptions",
        "  from community skill packages.",
        "summary: >",
        "  Folded summary for",
        "  read models.",
        "shared-triggers: &reviewTriggers",
        "  - review",
        "  - audit",
        "triggers: *reviewTriggers",
        "metadata:",
        "  <<: &baseMetadata",
        "    owner: runtime",
        "    stable: true",
        "  priority: 3",
        "  labels: { surface: skills, source: yaml }",
        "compatibility: { platform: agentarbor, agent: desktop_agent }",
        "allowed-tools: [read, shell]",
        "---",
        "",
        "YAML body.",
      ].join("\n"),
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });

    assert.equal(skill?.description, "Handles multi-line descriptions\nfrom community skill packages.");
    assert.equal(skill?.summary, "Folded summary for read models.");
    assert.deepEqual(skill?.triggers, ["review", "audit"]);
    assert.deepEqual(skill?.metadata, {
      owner: "runtime",
      stable: true,
      priority: 3,
      labels: {
        surface: "skills",
        source: "yaml",
      },
    });
    assert.deepEqual(skill?.compatibility, { platform: "agentarbor", agent: "desktop_agent" });
    assert.deepEqual(skill?.allowedTools, ["read", "shell"]);
    assert.equal(skill?.loadError, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills returns invalid packages as disabled diagnostics without failing discovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-invalid-"));
  try {
    await fs.mkdir(path.join(root, "valid-skill"), { recursive: true });
    await fs.mkdir(path.join(root, "missing-description"), { recursive: true });
    await fs.writeFile(
      path.join(root, "valid-skill", "SKILL.md"),
      "---\nname: valid-skill\ndescription: Handles review requests when a valid skill is needed.\ntriggers: [review]\n---\n\nValid body.",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "missing-description", "SKILL.md"),
      "---\nname: missing-description\ntriggers: [review]\n---\n\nInvalid body.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const invalid = skills.find((skill) => skill.id === "missing-description")!;
    const triggered = selectTriggeredSkills("please review", skills);

    assert.equal(skills.length, 2);
    assert.equal(invalid.enabled, false);
    assert.match(invalid.loadError ?? "", /description/);
    assert.deepEqual(triggered.map((skill) => skill.id), ["valid-skill"]);
    await assert.rejects(() => loadSkillBody(invalid), /Cannot load invalid skill/);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills turns malformed YAML frontmatter into a disabled diagnostic package", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-malformed-yaml-"));
  try {
    const skillDir = path.join(root, "broken-yaml");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: broken-yaml",
        "description: [unterminated",
        "---",
        "",
        "Body should not make malformed metadata usable.",
      ].join("\n"),
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });

    assert.equal(skill?.id, "broken-yaml");
    assert.equal(skill?.enabled, false);
    assert.match(skill?.loadError ?? "", /name|description/);
    assert.deepEqual(skill?.resourceIndex, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills rejects frontmatter resource paths that escape the skill package", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-resource-escape-"));
  try {
    const skillDir = path.join(root, "resource-escape");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(root, "outside.md"), "OUTSIDE_SENTINEL", "utf8");
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: resource-escape",
        "description: Demonstrates unsafe resource declarations.",
        "references:",
        "  - ../outside.md",
        "---",
        "",
        "Body.",
      ].join("\n"),
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });

    assert.equal(skill?.id, "resource-escape");
    assert.equal(skill?.enabled, false);
    assert.match(skill?.loadError ?? "", /must stay inside the skill package/);
    assert.equal(skill?.references, undefined);
    assert.equal(JSON.stringify(skill?.resourceIndex ?? []).includes("outside.md"), false);
    assert.equal(JSON.stringify(skill).includes("OUTSIDE_SENTINEL"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills marks directory name mismatches invalid and keeps diagnostics keyed by directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-mismatch-"));
  try {
    const skillDir = path.join(root, "actual-name");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: other-name\ndescription: Demonstrates a package/name mismatch.\n---\n\nBody.",
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });

    assert.equal(skill?.id, "actual-name");
    assert.equal(skill?.name, "other-name");
    assert.equal(skill?.enabled, false);
    assert.match(skill?.loadError ?? "", /match package directory/);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills indexes scripts, references, and assets without loading file contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-resources-"));
  try {
    const skillDir = path.join(root, "resourceful");
    await fs.mkdir(path.join(skillDir, "scripts", "nested"), { recursive: true });
    await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
    await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });
    await fs.mkdir(path.join(skillDir, "evals"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "scripts", "build.js"), "SCRIPT_SENTINEL", "utf8");
    await fs.writeFile(path.join(skillDir, "scripts", "nested", "tool.js"), "NESTED_SCRIPT_SENTINEL", "utf8");
    await fs.writeFile(path.join(skillDir, "references", "guide.md"), "REFERENCE_SENTINEL", "utf8");
    await fs.writeFile(path.join(skillDir, "assets", "logo.png"), "ASSET_SENTINEL", "utf8");
    await fs.writeFile(path.join(skillDir, "evals", "review-case.json"), "EVAL_SENTINEL", "utf8");
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: resourceful",
        "description: Uses package resources when selected for resource-heavy work.",
        "scripts:",
        "  - scripts/build.js",
        "  - scripts/missing.js",
        "references:",
        "  - references/guide.md",
        "assets:",
        "  - assets/logo.png",
        "---",
        "",
        "Resourceful body.",
      ].join("\n"),
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });
    const resources = new Map(skill!.resourceIndex.map((item) => [`${item.type}:${item.relativePath}`, item]));

    assert.deepEqual(resources.get("script:scripts/build.js"), {
      relativePath: "scripts/build.js",
      type: "script",
      exists: true,
      source: "frontmatter",
    });
    assert.deepEqual(resources.get("script:scripts/missing.js"), {
      relativePath: "scripts/missing.js",
      type: "script",
      exists: false,
      source: "frontmatter",
    });
    assert.deepEqual(resources.get("script:scripts/nested/tool.js"), {
      relativePath: "scripts/nested/tool.js",
      type: "script",
      exists: true,
      source: "directory",
    });
    assert.deepEqual(resources.get("reference:references/guide.md")?.exists, true);
    assert.deepEqual(resources.get("asset:assets/logo.png")?.exists, true);
    assert.deepEqual(resources.get("eval:evals/review-case.json"), {
      relativePath: "evals/review-case.json",
      type: "eval",
      exists: true,
      source: "directory",
    });
    assert.equal(JSON.stringify(skill).includes("SCRIPT_SENTINEL"), false);
    assert.equal(JSON.stringify(skill).includes("REFERENCE_SENTINEL"), false);
    assert.equal(JSON.stringify(skill).includes("ASSET_SENTINEL"), false);
    assert.equal(JSON.stringify(skill).includes("EVAL_SENTINEL"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills and loadSkillBodyFacts expose stable content hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-hash-"));
  try {
    const skillDir = path.join(root, "hashable");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: hashable\ndescription: Exposes hashes for later runtime freeze checks.\n---\n\nHash body.",
      "utf8"
    );

    const [skill] = await discoverSkills({ roots: [root] });
    const facts = await loadSkillBodyFacts(skill!);

    assert.match(skill!.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(skill!.bodyHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(skill!.metadataHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(facts.body, "Hash body.");
    assert.equal(facts.contentHash, skill!.contentHash);
    assert.equal(facts.bodyHash, skill!.bodyHash);
    assert.equal(facts.metadataHash, skill!.metadataHash);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
        "name: writer",
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

    assert.equal(getSkillDisclosure(skill, "header"), "writer: Short desc.");
    assert.equal(getSkillDisclosure(skill, "summary"), "A longer summary of what the writer skill does in practice.");
    // "full" level falls back to summary (async body load is separate)
    assert.equal(getSkillDisclosure(skill, "full"), "A longer summary of what the writer skill does in practice.");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("getSkillDisclosure falls back to description when summary is absent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-disclosure-fallback-"));
  try {
    const skillDir = path.join(root, "basic");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: basic\ndescription: Fallback desc.\n---\n\nBody.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const skill = skills[0]!;

    assert.equal(getSkillDisclosure(skill, "summary"), "Fallback desc.");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("selectTriggeredSkillsWithStrategy keyword strategy matches existing selectTriggeredSkills behaviour", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-strategy-kw-"));
  try {
    const skillDir = path.join(root, "checker");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: checker\ndescription: Check code when linting or checking is requested.\ntriggers: [check, lint]\n---\n\nCheck body.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const triggered = selectTriggeredSkillsWithStrategy("please check this file", skills, "keyword");
    const structured = selectSkillsForGoal("please check this file", skills, { strategy: "keyword" });

    assert.equal(triggered.length, 1);
    assert.equal(triggered[0]?.name, "checker");
    assert.deepEqual(structured.selectedSkills.map((skill) => skill.name), triggered.map((skill) => skill.name));
    assert.equal(structured.candidateReasons[0]?.code, "keyword_match");
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("selectTriggeredSkillsWithStrategy llm strategy prepares candidates without selecting non-explicit skills", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-strategy-llm-"));
  try {
    await fs.mkdir(path.join(root, "skill-a"), { recursive: true });
    await fs.mkdir(path.join(root, "skill-b"), { recursive: true });
    await fs.mkdir(path.join(root, "skill-off"), { recursive: true });
    await fs.writeFile(
      path.join(root, "skill-a", "SKILL.md"),
      "---\nname: skill-a\ndescription: Handles alpha requests.\ntriggers: [alpha]\n---\n\nA body.",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "skill-b", "SKILL.md"),
      "---\nname: skill-b\ndescription: Handles beta requests.\ntriggers: [beta]\n---\n\nB body.",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "skill-off", "SKILL.md"),
      "---\nname: skill-off\ndescription: Disabled skill.\nenabled: false\n---\n\nOff body.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const triggered = selectTriggeredSkillsWithStrategy("unrelated goal with no keywords", skills, "llm");
    const structured = selectSkillsForGoal("unrelated goal with no keywords", skills, { strategy: "llm" });
    const explicitTriggered = selectTriggeredSkillsWithStrategy("use $skill-a", skills, "llm");

    assert.equal(triggered.length, 0);
    assert.deepEqual(structured.candidateContexts.map((candidate) => candidate.skillName), ["skill-a", "skill-b"]);
    assert.equal(structured.needsModelRouting, true);
    assert.match(structured.modelRoutingUnavailableReason ?? "", /no model router is injected/);
    assert.equal(structured.omittedReasons.some((reason) => reason.code === "llm_routing_required"), true);
    assert.deepEqual(explicitTriggered.map((skill) => skill.name), ["skill-a"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("selectTriggeredSkillsWithStrategy llm strategy returns empty when all skills disabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-strategy-llm-empty-"));
  try {
    const skillDir = path.join(root, "off");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: off\ndescription: Disabled skill.\nenabled: false\n---\n\nBody.",
      "utf8"
    );

    const skills = await discoverSkills({ roots: [root] });
    const triggered = selectTriggeredSkillsWithStrategy("anything", skills, "llm");

    assert.equal(triggered.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills preserves source roots and selection prefers higher-precedence duplicate ids", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-source-roots-"));
  const userRoot = path.join(root, "user-skills");
  const projectRoot = path.join(root, "project-skills");
  try {
    await fs.mkdir(path.join(userRoot, "shared-review"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "shared-review"), { recursive: true });
    await fs.writeFile(
      path.join(userRoot, "shared-review", "SKILL.md"),
      "---\nname: shared-review\ndescription: User-level review skill.\ntriggers: [review]\n---\n\nUser body.",
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "shared-review", "SKILL.md"),
      "---\nname: shared-review\ndescription: Project-level review skill.\ntriggers: [review]\n---\n\nProject body.",
      "utf8"
    );

    const skills = await discoverSkills({
      roots: [
        { rootPath: userRoot, sourceKind: "user", sourceRootId: "user", precedence: 10 },
        { rootPath: projectRoot, sourceKind: "project", sourceRootId: "project", precedence: 100 },
      ],
    });
    const selection = selectSkillsForGoal("please review", skills);

    assert.deepEqual(skills.map((skill) => `${skill.id}:${skill.sourceKind}:${skill.sourcePrecedence}`).sort(), [
      "shared-review:project:100",
      "shared-review:user:10",
    ]);
    assert.equal(selection.selectedSkills[0]?.description, "Project-level review skill.");
    assert.equal(selection.selectedSkills[0]?.sourceKind, "project");
    assert.equal(selection.omittedReasons.some((reason) =>
      reason.code === "duplicate_id" && reason.skillId === "shared-review"
    ), true);
    assert.equal(selection.candidateContexts[0]?.sourceKind, "project");
    assert.equal(selection.candidateContexts[0]?.sourceRootId, "project");
    assert.equal(selection.candidateContexts[0]?.sourcePrecedence, 100);
    assert.equal(selection.candidateContexts[0]?.text.includes(projectRoot), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("discoverSkills applies only source-qualified state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skills-source-state-"));
  const userRoot = path.join(root, "user-skills");
  const projectRoot = path.join(root, "project-skills");
  try {
    await fs.mkdir(path.join(userRoot, "shared-review"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "shared-review"), { recursive: true });
    await fs.writeFile(
      path.join(userRoot, "shared-review", "SKILL.md"),
      "---\nname: shared-review\ndescription: User-level review skill.\n---\n\nUser body.",
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "shared-review", "SKILL.md"),
      "---\nname: shared-review\ndescription: Project-level review skill.\n---\n\nProject body.",
      "utf8"
    );

    const withoutQualifiedState = await discoverSkills({
      roots: [
        { rootPath: userRoot, sourceKind: "user", sourceRootId: "user", precedence: 10 },
        { rootPath: projectRoot, sourceKind: "project", sourceRootId: "project", precedence: 100 },
      ],
      stateStore: {
        async readStates() {
          return new Map();
        },
        async setEnabled(skillId, enabled) {
          return { skillId, enabled };
        },
        async markUsed(skillId) {
          return { skillId, lastUsedAt: "2026-06-21T00:00:00.000Z" };
        },
      },
    });
    const projectStateKey = withoutQualifiedState.find((skill) => skill.sourceKind === "project")?.stateKey;
    assert.equal(withoutQualifiedState.every((skill) => skill.enabled), true);

    const withQualifiedState = await discoverSkills({
      roots: [
        { rootPath: userRoot, sourceKind: "user", sourceRootId: "user", precedence: 10 },
        { rootPath: projectRoot, sourceKind: "project", sourceRootId: "project", precedence: 100 },
      ],
      stateStore: {
        async readStates() {
          return new Map([[projectStateKey!, {
            skillId: "shared-review",
            stateKey: projectStateKey,
            sourceKind: "project",
            sourceRootId: "project",
            sourcePrecedence: 100,
            enabled: false,
          }]]);
        },
        async setEnabled(skillId, enabled) {
          return { skillId, enabled };
        },
        async markUsed(skillId) {
          return { skillId, lastUsedAt: "2026-06-21T00:00:00.000Z" };
        },
      },
    });

    assert.equal(withQualifiedState.find((skill) => skill.sourceKind === "project")?.enabled, false);
    assert.equal(withQualifiedState.find((skill) => skill.sourceKind === "user")?.enabled, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
