import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CapabilitySkillCatalogItem } from "../../../domain/config/index.js";
import type {
  IntelligenceChannel,
  ModelOutputValidationResult,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../../domain/intelligence/index.js";
import { resolveTriggeredSkillContexts, type PanelSkillRuntime } from "../skill-service.js";
import { loadSkillBodyFacts } from "../../skills/index.js";

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

    const frozenSkill = {
      id: "frozen-review",
      name: "Frozen Review",
      description: "Reviews code from the run-created snapshot.",
      enabled: true,
      sourcePath: skillPath,
      triggers: ["review"],
    };
    const frozenFacts = await loadSkillBodyFacts(frozenSkill);
    const frozenSkillCatalog: readonly CapabilitySkillCatalogItem[] = [{
      ...frozenSkill,
      contentHash: frozenFacts.contentHash,
      bodyHash: frozenFacts.bodyHash,
    }];
    const usedSkillIds: string[] = [];
    const runtime: PanelSkillRuntime = {
      skillRoots: [path.join(root, "current-skills")],
      now: () => "2026-06-05T00:00:00.000Z",
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
    assert.equal(contexts[0]?.loadStatus, "loaded");
    assert.equal(contexts[0]?.loadedAt, "2026-06-05T00:00:00.000Z");
    assert.equal(contexts[0]?.bodyCharCount, contexts[0]?.body.length);
    assert.equal(contexts[0]?.contentHash, frozenFacts.contentHash);
    assert.equal(contexts[0]?.bodyHash, frozenFacts.bodyHash);
    assert.equal(contexts[0]?.warning, undefined);
    assert.equal(contexts[0]?.markUsedStatus, "succeeded");
    assert.deepEqual(usedSkillIds, ["source:legacy:frozen-review"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts records explicit selector trigger reasons", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-explicit-"));
  try {
    const skillPath = path.join(root, "SKILL.md");
    await fs.writeFile(
      skillPath,
      [
        "---",
        "name: Explicit Skill",
        "description: Handles explicit skill requests.",
        "---",
        "",
        "# Explicit Skill",
        "",
        "Use explicit skill instructions.",
      ].join("\n"),
      "utf8"
    );
    const skill = {
      id: "explicit-skill",
      name: "Explicit Skill",
      description: "Handles explicit skill requests.",
      enabled: true,
      sourcePath: skillPath,
      triggers: [],
    };
    const facts = await loadSkillBodyFacts(skill);
    const channel = new TestSkillRouterChannel({
      selectedSkillIds: [],
      reasons: [],
      confidence: 0.1,
    });
    const usedSkillIds: string[] = [];
    const runtime: PanelSkillRuntime = {
      skillRoots: [],
      now: () => "2026-06-05T00:00:00.000Z",
      skillStateStore: {
        async readStates() {
          return new Map();
        },
        async setEnabled(skillId, enabled) {
          return { skillId, enabled };
        },
        async markUsed(skillId) {
          usedSkillIds.push(skillId);
          return { skillId, lastUsedAt: "2026-06-05T00:00:00.000Z" };
        },
      },
    };

    const contexts = await resolveTriggeredSkillContexts(
      runtime,
      "please use $explicit-skill here",
      [{
        ...skill,
        contentHash: facts.contentHash,
        bodyHash: facts.bodyHash,
      }],
      { intelligenceChannel: channel }
    );

    assert.equal(contexts.length, 1);
    assert.equal(contexts[0]?.skill.id, "explicit-skill");
    assert.equal(contexts[0]?.loadStatus, "loaded");
    assert.equal(contexts[0]?.triggerReason, "显式调用：$explicit-skill");
    assert.match(contexts[0]?.summary ?? "", /显式调用：\$explicit-skill/);
    assert.equal(contexts[0]?.warning, undefined);
    assert.deepEqual(usedSkillIds, ["source:legacy:explicit-skill"]);
    assert.equal(channel.requests.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts defaults to keyword routing even when a model channel is provided", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-router-default-"));
  try {
    const writer = await frozenCatalogSkill(root, "writer", {
      name: "Writer",
      description: "Writes release notes.",
      triggers: [],
      body: "Use writer instructions.",
    });
    const channel = new TestSkillRouterChannel({
      selectedSkillIds: ["writer"],
      reasons: [{ skillId: "writer", reason: "The model router would select this.", confidence: 0.9 }],
      confidence: 0.9,
    });

    const contexts = await resolveTriggeredSkillContexts(
      { skillRoots: [] },
      "111222",
      [writer],
      { intelligenceChannel: channel }
    );

    assert.deepEqual(contexts, []);
    assert.equal(channel.requests.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts uses the opt-in model router with safe frozen metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-router-model-"));
  try {
    const writer = await frozenCatalogSkill(root, "writer", {
      name: "Writer",
      description: "Writes release notes.",
      triggers: [],
      body: "Use writer instructions.",
    });
    const reviewer = await frozenCatalogSkill(root, "reviewer", {
      name: "Reviewer",
      description: "Reviews source code.",
      triggers: ["review"],
      body: "FULL SKILL BODY SHOULD NOT ROUTE",
    });
    const channel = new TestSkillRouterChannel({
      selectedSkillIds: ["writer"],
      reasons: [{ skillId: "writer", reason: "The goal asks for release-note writing.", confidence: 0.86 }],
      confidence: 0.84,
    });
    const runtime: PanelSkillRuntime = {
      skillRoots: [],
      now: () => "2026-06-21T00:00:00.000Z",
    };

    const contexts = await resolveTriggeredSkillContexts(
      runtime,
      "prepare polished release notes",
      [writer, reviewer],
      {
        intelligenceChannel: channel,
        historySummary: "user: previous request mentioned release notes",
        routingMode: "model",
        requestId: "skill-router-request-model",
        traceId: "trace-skill-router-model",
        callerRef: "skill-router:goal-model",
      }
    );

    assert.deepEqual(contexts.map((context) => context.skill.id), ["writer"]);
    assert.equal(contexts[0]?.triggerReason, "模型选择：The goal asks for release-note writing.");
    assert.equal(contexts[0]?.selection?.selectionMethod, "model");
    assert.equal(contexts[0]?.selection?.modelCallRef, "skill-router-request-model-response");
    assert.deepEqual(contexts[0]?.selection?.selectedSkillIds, ["writer"]);
    assert.deepEqual([...(contexts[0]?.selection?.candidateSkillIds ?? [])].sort(), ["reviewer", "writer"]);
    assert.equal(contexts[0]?.selection?.confidence, 0.84);
    assert.equal(channel.requests.length, 1);
    assert.equal(channel.requests[0]?.purpose, "skill_routing");
    assert.deepEqual(channel.requests[0]?.tools, []);
    assert.equal(channel.requests[0]?.toolChoice, "none");
    const requestText = JSON.stringify(channel.requests[0]);
    assert.equal(requestText.includes("FULL SKILL BODY SHOULD NOT ROUTE"), false);
    assert.equal(requestText.includes("sourcePath"), false);
    assert.equal(requestText.includes(writer.sourcePath), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts rejects model selections outside the frozen enabled catalog", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-router-validate-"));
  try {
    const valid = await frozenCatalogSkill(root, "valid", {
      name: "Valid",
      description: "Valid review skill.",
      triggers: ["review"],
      body: "Use valid review instructions.",
    });
    const disabled = {
      ...await frozenCatalogSkill(root, "disabled", {
        name: "Disabled",
        description: "Disabled review skill.",
        triggers: ["review"],
        body: "Use disabled instructions.",
      }),
      enabled: false,
    };
    const invalid = {
      ...await frozenCatalogSkill(root, "invalid", {
        name: "Invalid",
        description: "Invalid review skill.",
        triggers: ["review"],
        body: "Use invalid instructions.",
      }),
      validationStatus: "invalid" as const,
      validationErrors: ["frontmatter error"],
    };
    const channel = new TestSkillRouterChannel({
      selectedSkillIds: ["missing", "disabled", "invalid", "valid"],
      reasons: [{ skillId: "valid", reason: "Valid candidate.", confidence: 0.7 }],
      confidence: 0.9,
    });

    const contexts = await resolveTriggeredSkillContexts(
      { skillRoots: [] },
      "please review this patch",
      [valid, disabled, invalid],
      { intelligenceChannel: channel, routingMode: "model" }
    );

    assert.deepEqual(contexts.map((context) => context.skill.id), ["valid"]);
    const rejected = contexts[0]?.selection?.rejectedReasons ?? [];
    assert.equal(rejected.some((reason) => reason.code === "missing_from_catalog" && reason.skillId === "missing"), true);
    assert.equal(rejected.some((reason) => reason.code === "disabled" && reason.skillId === "disabled"), true);
    assert.equal(rejected.some((reason) => reason.code === "invalid" && reason.skillId === "invalid"), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts keeps router facts when model-selected skill body hash fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-router-hash-"));
  try {
    const skillPath = path.join(root, "hash-skill.md");
    await fs.writeFile(
      skillPath,
      [
        "---",
        "name: Hash Skill",
        "description: Checks hash mismatch.",
        "---",
        "",
        "# Hash Skill",
        "",
        "Use original instructions.",
      ].join("\n"),
      "utf8"
    );
    const frozenSkill = {
      id: "hash-skill",
      name: "Hash Skill",
      description: "Checks hash mismatch.",
      enabled: true,
      sourcePath: skillPath,
      triggers: [],
    };
    const facts = await loadSkillBodyFacts(frozenSkill);
    await fs.writeFile(
      skillPath,
      [
        "---",
        "name: Hash Skill",
        "description: Checks hash mismatch.",
        "---",
        "",
        "# Hash Skill",
        "",
        "Use modified instructions.",
      ].join("\n"),
      "utf8"
    );
    const channel = new TestSkillRouterChannel({
      selectedSkillIds: ["hash-skill"],
      reasons: [{ skillId: "hash-skill", reason: "Relevant skill.", confidence: 0.8 }],
      confidence: 0.8,
    });

    const contexts = await resolveTriggeredSkillContexts(
      { skillRoots: [] },
      "check hash behavior",
      [{ ...frozenSkill, contentHash: facts.contentHash, bodyHash: facts.bodyHash }],
      { intelligenceChannel: channel, routingMode: "model" }
    );

    assert.equal(contexts.length, 1);
    assert.equal(contexts[0]?.loadStatus, "failed");
    assert.equal(contexts[0]?.body, "");
    assert.equal(contexts[0]?.selection?.selectionMethod, "model");
    assert.deepEqual(contexts[0]?.selection?.selectedSkillIds, ["hash-skill"]);
    assert.match(contexts[0]?.error ?? "", /hash/);
    assert.equal(JSON.stringify(contexts).includes("Use modified instructions."), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts fails closed when the current skill body hash differs from the frozen catalog", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-freeze-mismatch-"));
  try {
    const skillPath = path.join(root, "SKILL.md");
    await fs.writeFile(
      skillPath,
      [
        "---",
        "name: Frozen Review",
        "description: Reviews code from the run-created snapshot.",
        "triggers: [review]",
        "---",
        "",
        "# Frozen Review",
        "",
        "Use the original frozen instructions.",
      ].join("\n"),
      "utf8"
    );
    const frozenSkill = {
      id: "frozen-review",
      name: "Frozen Review",
      description: "Reviews code from the run-created snapshot.",
      enabled: true,
      sourcePath: skillPath,
      triggers: ["review"],
    };
    const frozenFacts = await loadSkillBodyFacts(frozenSkill);
    const frozenSkillCatalog: readonly CapabilitySkillCatalogItem[] = [{
      ...frozenSkill,
      contentHash: frozenFacts.contentHash,
      bodyHash: frozenFacts.bodyHash,
    }];
    await fs.writeFile(
      skillPath,
      [
        "---",
        "name: Frozen Review",
        "description: Reviews code from the run-created snapshot.",
        "triggers: [review]",
        "---",
        "",
        "# Frozen Review",
        "",
        "Use modified instructions that were not present at run creation.",
      ].join("\n"),
      "utf8"
    );
    const usedSkillIds: string[] = [];
    const runtime: PanelSkillRuntime = {
      skillRoots: [],
      now: () => "2026-06-05T00:00:00.000Z",
      skillStateStore: {
        async readStates() {
          return new Map();
        },
        async setEnabled(skillId, enabled) {
          return { skillId, enabled };
        },
        async markUsed(skillId) {
          usedSkillIds.push(skillId);
          return { skillId, lastUsedAt: "2026-06-05T00:00:00.000Z" };
        },
      },
    };

    const contexts = await resolveTriggeredSkillContexts(runtime, "please review this change", frozenSkillCatalog);

    assert.equal(contexts.length, 1);
    assert.equal(contexts[0]?.skill.id, "frozen-review");
    assert.equal(contexts[0]?.loadStatus, "failed");
    assert.equal(contexts[0]?.body, "");
    assert.equal(contexts[0]?.omitted, true);
    assert.match(contexts[0]?.error ?? "", /hash/);
    assert.match(contexts[0]?.error ?? "", /expected=sha256:/);
    assert.match(contexts[0]?.warning ?? "", /不会注入/);
    assert.equal(JSON.stringify(contexts).includes("Use modified instructions"), false);
    assert.deepEqual(usedSkillIds, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts keeps compatibility when the frozen catalog has no body hash", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-missing-hash-"));
  try {
    const skillPath = path.join(root, "SKILL.md");
    await fs.writeFile(
      skillPath,
      [
        "---",
        "name: Legacy Review",
        "description: Reviews code from a legacy snapshot without hashes.",
        "triggers: [review]",
        "---",
        "",
        "# Legacy Review",
        "",
        "Use legacy compatible instructions.",
      ].join("\n"),
      "utf8"
    );
    const runtime: PanelSkillRuntime = {
      skillRoots: [],
    };

    const contexts = await resolveTriggeredSkillContexts(runtime, "please review this change", [{
      id: "legacy-review",
      name: "Legacy Review",
      description: "Reviews code from a legacy snapshot without hashes.",
      enabled: true,
      sourcePath: skillPath,
      triggers: ["review"],
    }]);

    assert.equal(contexts.length, 1);
    assert.equal(contexts[0]?.loadStatus, "loaded");
    assert.equal(contexts[0]?.body.includes("Use legacy compatible instructions."), true);
    assert.match(contexts[0]?.warning ?? "", /缺少冻结 hash/);
    assert.equal(contexts[0]?.markUsedStatus, "skipped");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts returns a failed safe fact when body loading fails", async () => {
  const missingSkillPath = path.join(os.tmpdir(), "agentarbor-missing-skill", "SKILL.md");
  const catalog: readonly CapabilitySkillCatalogItem[] = [
    {
      id: "missing-review",
      name: "Missing Review",
      description: "Reviews code.",
      enabled: true,
      sourcePath: missingSkillPath,
      triggers: ["review"],
    },
  ];
  const usedSkillIds: string[] = [];
  const runtime: PanelSkillRuntime = {
    skillRoots: [],
    now: () => "2026-06-05T00:00:00.000Z",
    skillStateStore: {
      async readStates() {
        throw new Error("current skill state must not be read for a frozen run");
      },
      async setEnabled(skillId, enabled) {
        return { skillId, enabled };
      },
      async markUsed(skillId) {
        usedSkillIds.push(skillId);
        return { skillId, lastUsedAt: "2026-06-05T00:00:00.000Z" };
      },
    },
  };

  const contexts = await resolveTriggeredSkillContexts(runtime, "please review this change", catalog);

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.skill.id, "missing-review");
  assert.equal(contexts[0]?.body, "");
  assert.equal(contexts[0]?.loadStatus, "failed");
  assert.equal(contexts[0]?.error, "技能正文文件不存在。");
  assert.equal(contexts[0]?.omitted, true);
  assert.equal(contexts[0]?.markUsedStatus, undefined);
  assert.deepEqual(usedSkillIds, []);
});

test("resolveTriggeredSkillContexts keeps loaded skills when markUsed fails and records a warning", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-mark-used-"));
  try {
    const skillPath = path.join(root, "SKILL.md");
    await fs.writeFile(
      skillPath,
      [
        "---",
        "name: Mark Used Review",
        "description: Reviews code.",
        "triggers: [review]",
        "---",
        "",
        "# Mark Used Review",
        "",
        "Use review instructions.",
      ].join("\n"),
      "utf8"
    );
    const runtime: PanelSkillRuntime = {
      skillRoots: [],
      skillStateStore: {
        async readStates() {
          return new Map();
        },
        async setEnabled(skillId, enabled) {
          return { skillId, enabled };
        },
        async markUsed() {
          throw new Error("state store unavailable");
        },
      },
    };

    const contexts = await resolveTriggeredSkillContexts(runtime, "please review", [{
      id: "mark-used-review",
      name: "Mark Used Review",
      description: "Reviews code.",
      enabled: true,
      sourcePath: skillPath,
      triggers: ["review"],
    }]);

    assert.equal(contexts[0]?.loadStatus, "loaded");
    assert.equal(contexts[0]?.body.includes("Use review instructions."), true);
    assert.equal(contexts[0]?.markUsedStatus, "failed");
    assert.match(contexts[0]?.warning ?? "", /使用记录更新失败/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveTriggeredSkillContexts skips disabled frozen skills and caps keyword triggers at four", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-limit-"));
  try {
    const catalog: CapabilitySkillCatalogItem[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const skillPath = path.join(root, `skill-${index}.md`);
      await fs.writeFile(
        skillPath,
        [
          "---",
          `name: Review ${index}`,
          `description: Review helper ${index}.`,
          "triggers: [review]",
          "---",
          "",
          `# Review ${index}`,
          "",
          `Body ${index}.`,
        ].join("\n"),
        "utf8"
      );
      catalog.push({
        id: `review-${index}`,
        name: `Review ${index}`,
        description: `Review helper ${index}.`,
        enabled: index !== 3,
        sourcePath: skillPath,
        triggers: ["review"],
      });
    }
    const usedSkillIds: string[] = [];
    const runtime: PanelSkillRuntime = {
      skillRoots: [],
      skillStateStore: {
        async readStates() {
          return new Map();
        },
        async setEnabled(skillId, enabled) {
          return { skillId, enabled };
        },
        async markUsed(skillId) {
          usedSkillIds.push(skillId);
          return { skillId, lastUsedAt: "2026-06-05T00:00:00.000Z" };
        },
      },
    };

    const contexts = await resolveTriggeredSkillContexts(runtime, "please review everything", catalog);

    assert.deepEqual(contexts.map((context) => context.skill.id), ["review-1", "review-2", "review-4", "review-5"]);
    assert.deepEqual(usedSkillIds, [
      "source:legacy:review-1",
      "source:legacy:review-2",
      "source:legacy:review-4",
      "source:legacy:review-5",
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function frozenCatalogSkill(
  root: string,
  id: string,
  input: {
    readonly name: string;
    readonly description: string;
    readonly triggers: readonly string[];
    readonly body: string;
  }
): Promise<CapabilitySkillCatalogItem> {
  const skillPath = path.join(root, `${id}.md`);
  await fs.writeFile(
    skillPath,
    [
      "---",
      `name: ${input.name}`,
      `description: ${input.description}`,
      input.triggers.length === 0 ? undefined : `triggers: [${input.triggers.join(", ")}]`,
      "---",
      "",
      `# ${input.name}`,
      "",
      input.body,
    ].filter((line): line is string => line !== undefined).join("\n"),
    "utf8"
  );
  const skill = {
    id,
    name: input.name,
    description: input.description,
    enabled: true,
    sourcePath: skillPath,
    triggers: input.triggers,
  };
  const facts = await loadSkillBodyFacts(skill);
  return {
    ...skill,
    contentHash: facts.contentHash,
    bodyHash: facts.bodyHash,
  };
}

class TestSkillRouterChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly output: unknown) {}

  async request(request: ModelRequest, _options?: ModelRequestOptions): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      responseId: `${request.requestId}-response`,
      requestId: request.requestId,
      providerId: "test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: this.output,
      validation: {
        status: "passed",
        checkedAt: "2026-06-21T00:00:00.000Z",
        issues: [],
      },
      completedAt: "2026-06-21T00:00:00.000Z",
    };
  }

  validateResponse(_request: ModelRequest, response: ModelResponse): ModelOutputValidationResult {
    return response.validation;
  }
}
