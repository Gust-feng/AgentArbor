import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import { createTaskSoil } from "../../domain/soil/index.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { buildDesktopAgentModelInput } from "./desktop-agent-model-input.js";

test("Desktop Agent model input keeps the stable prompt first and preserves prior protocol history", () => {
  const prior: readonly ModelMessage[] = [
    { role: "user", content: "first request", ref: "context:goal:first" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ callId: "call-read", toolName: "read_file", input: { path: "README.md" } }],
      protocolExtensions: {
        openai_responses_output_items: [{
          type: "function_call",
          call_id: "call-read",
          name: "read_file",
          arguments: "{\"path\":\"README.md\"}",
        }],
      },
    },
    { role: "tool", content: "README CONTENT", toolCallId: "call-read", toolName: "read_file" },
    { role: "assistant", content: "first answer" },
  ];
  const taskSoil = createTaskSoil({
    rawGoal: "second request",
    goalId: "second",
    traceId: "trace-second",
    createdAt: "2026-07-14T00:00:00.000Z",
  });

  const result = buildDesktopAgentModelInput({
    agentDefinition: DESKTOP_ROOT_AGENT,
    goal: "second request",
    taskSoil,
    priorModelContext: prior,
  });

  assert.equal(result.messages[0]?.role, "system");
  assert.equal(result.messages[0]?.content, DESKTOP_ROOT_AGENT.prompt.systemPrompt);
  assert.deepEqual(result.messages.slice(1, -1), prior);
  assert.notEqual(result.messages[1], prior[0]);
  assert.equal(result.messages.at(-1)?.role, "user");
  assert.equal(result.messages.at(-1)?.content, "second request");
});

test("Desktop Agent model input places current skills and attachment metadata in the current user turn", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "review the attachment",
    goalId: "goal-current",
    traceId: "trace-current",
    contextRefs: [{
      attachmentId: "attachment-readme",
      ref: "local-file:C:/workspace/README.md",
      kind: "file",
      title: "README.md",
      summary: "Selected text file.",
      metadata: { mimeType: "text/markdown", byteLength: 120, available: true, truncated: false },
    }],
    createdAt: "2026-07-14T00:00:00.000Z",
  });

  const result = buildDesktopAgentModelInput({
    agentDefinition: DESKTOP_ROOT_AGENT,
    goal: "review the attachment",
    taskSoil,
    skillContexts: [{
      skill: {
        id: "review",
        name: "Repository Review",
        description: "Review a repository.",
        enabled: true,
        sourcePath: ".agents/skills/review/SKILL.md",
        triggers: ["review"],
        resourceIndex: [{
          type: "reference",
          relativePath: "references/checklist.md",
          exists: true,
          byteLength: 42,
        }],
      },
      body: "Follow the repository review checklist.",
      triggerReason: "The user asked for a review.",
    }],
  });

  assert.equal(result.messages.filter((message) => message.role === "system").length, 1);
  const current = result.messages.at(-1);
  assert.equal(current?.role, "user");
  assert.match(current?.content ?? "", /\[Selected skill instructions\]/);
  assert.match(current?.content ?? "", /Skill: Repository Review/);
  assert.match(current?.content ?? "", /references\/checklist\.md/);
  assert.match(current?.content ?? "", /\[User-provided context\]/);
  assert.match(current?.content ?? "", /attachment_id=attachment-readme/);
  assert.equal(current?.content.includes("C:/workspace/README.md"), false);
  assert.match(current?.content ?? "", /\[Current user request\]\nreview the attachment$/);
});

test("Desktop Agent model input does not silently trim canonical history or the current request", () => {
  const historySentinel = `history:${"h".repeat(20_000)}`;
  const requestSentinel = `request:${"r".repeat(20_000)}`;
  const result = buildDesktopAgentModelInput({
    agentDefinition: DESKTOP_ROOT_AGENT,
    goal: requestSentinel,
    taskSoil: createTaskSoil({
      rawGoal: requestSentinel,
      goalId: "goal-large",
      traceId: "trace-large",
      createdAt: "2026-07-14T00:00:00.000Z",
    }),
    priorModelContext: [{ role: "assistant", content: historySentinel }],
  });

  assert.equal(result.messages[1]?.content, historySentinel);
  assert.equal(result.messages.at(-1)?.content.endsWith(requestSentinel), true);
});
