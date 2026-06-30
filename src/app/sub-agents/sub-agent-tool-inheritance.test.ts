import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { nowIso } from "../../kernel/id.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { ToolCenter } from "../tool-center/tool-center.js";
import { SubAgentRegistry } from "./sub-agent-registry.js";
import { createSubAgentToolExecutors } from "./sub-agent-tools.js";
import { runSubAgent } from "./sub-agent-runner.js";

test("runSubAgent inherits parent allowed tools and hides sub-agent recursion tools", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-read", "read_file", { path: "README.md" }),
    textResponse("model-request-final", "read completed"),
  ]);
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ content: "ok" })));
  center.register(testTool("spawn_sub_agent", async () => ({ should_not_run: true })));

  const result = await runSubAgent({
    subAgent: testSubAgent({ allowedTools: [] }),
    task: "read a file",
    toolBroker: center,
    channel,
    allowedTools: ["read_file", "spawn_sub_agent"],
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["read_file"]);
});

test("runSubAgent sends instructions as system and the delegated task as user input", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-test", "task completed"),
  ]);
  const center = new ToolCenter();

  const result = await runSubAgent({
    subAgent: testSubAgent(),
    task: "generate three ideas",
    context: "Use today's schedule.",
    toolBroker: center,
    channel,
    allowedTools: [],
  });

  assert.equal(result.status, "completed");

  const messages = channel.requests[0]?.sanitizedMessages ?? [];
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[1]?.role, "user");
  assert.match(messages[0]?.content ?? "", /你是「test-helper」专家/);
  assert.doesNotMatch(messages[0]?.content ?? "", /generate three ideas/);
  assert.match(messages[1]?.content ?? "", /## 任务描述/);
  assert.match(messages[1]?.content ?? "", /generate three ideas/);
  assert.match(messages[1]?.content ?? "", /## 额外上下文/);
  assert.match(messages[1]?.content ?? "", /Use today's schedule\./);
});

test("sub-agent tool approval bubbles as the parent tool pending confirmation and resumes after approve", async () => {
  let shellRuns = 0;
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-child", "call-shell", "shell_command", { commandLine: "pnpm test" }),
    textResponse("model-request-child-final", "shell finished"),
  ]);
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("shell_command", async () => {
    shellRuns += 1;
    return { summary: "shell executed" };
  }, "execute", true));
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agent", "shell_command"],
    confirmationPolicy: () => "prompt",
    publishToolEvent: (message) => eventLog.append(message),
    includeSpawnTool: true,
    eventLog,
  })) {
    center.register(executor);
  }

  const request = {
    callId: "call-parent-sub-agent",
    toolName: "call_sub_agent",
    input: {
      sub_agent_name: "test-helper",
      task: "run shell",
    },
  };
  const context = {
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
  };

  const paused = await center.execute(request, context, {
    callerAgentId: "agent-test",
    allowedTools: ["call_sub_agent", "shell_command"],
    confirmationPolicy: "prompt",
  });

  assert.equal(paused.status, "approval_required");
  assert.equal(paused.callId, "call-parent-sub-agent");
  assert.equal(paused.toolName, "call_sub_agent");
  assert.equal(paused.confirmationRequest?.confirmationId, "confirmation-call-shell");
  assert.equal(paused.confirmationRequest?.title, "Shell 命令");
  assert.deepEqual(paused.confirmationRequest?.affectedResources, ["pnpm test"]);
  assert.equal(shellRuns, 0);
  assert.equal(eventLog.types().includes("user_approval.requested"), true);

  const resumed = await center.execute(request, context, {
    callerAgentId: "agent-test",
    allowedTools: ["call_sub_agent", "shell_command"],
    approvedConfirmationIds: ["confirmation-call-shell"],
    confirmationPolicy: "prompt",
  });

  assert.equal(resumed.status, "completed");
  assert.equal(shellRuns, 1);
  assert.equal((resumed.output as { readonly status?: string }).status, "completed");
  assert.equal(channel.requests.length, 2);
});

test("spawn_sub_agent uses system_prompt as the temporary sub-agent system body", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-spawn", "spawned finished"),
  ]);
  const center = new ToolCenter();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["spawn_sub_agent"],
    includeSpawnTool: true,
  })) {
    center.register(executor);
  }

  const result = await center.execute(
    {
      callId: "call-spawn",
      toolName: "spawn_sub_agent",
      input: {
        role: "Temporary Reviewer",
        system_prompt: "CUSTOM SYSTEM BODY FOR TEMP AGENT",
        task: "review",
        allowed_tools: ["read_file"],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["spawn_sub_agent"] }
  );

  assert.equal(result.status, "completed");
  assert.match(channel.requests[0]?.sanitizedMessages[0]?.content ?? "", /CUSTOM SYSTEM BODY FOR TEMP AGENT/);
  assert.equal(channel.requests[0]?.sanitizedMessages[1]?.role, "user");
  assert.match(channel.requests[0]?.sanitizedMessages[1]?.content ?? "", /review/);
});

function testSubAgent(input: {
  readonly allowedTools?: readonly string[];
} = {}) {
  return {
    id: "test-helper",
    name: "test-helper",
    description: "Test helper",
    enabled: true,
    sourcePath: path.join(tmpdir(), "missing-sub-agent.md"),
    whenToUse: [],
    whenNotToUse: [],
    allowedTools: input.allowedTools ?? [],
    sourceKind: "custom" as const,
    sourceRootId: "test",
    sourcePrecedence: 0,
    sourceRootPath: "",
    packageName: "test-helper",
    packagePath: "",
    contentHash: "",
    bodyHash: "",
    metadataHash: "",
  };
}

async function tempRegistry(): Promise<SubAgentRegistry> {
  const root = mkdtempSync(path.join(tmpdir(), "agentarbor-sub-agent-"));
  const packageDir = path.join(root, "test-helper");
  mkdirSync(packageDir);
  writeFileSync(
    path.join(packageDir, "SUB_AGENT.md"),
    [
      "---",
      "name: test-helper",
      "description: Test helper",
      "enabled: true",
      "---",
      "",
      "You are a test helper.",
      "",
    ].join("\n"),
    "utf8"
  );
  const registry = new SubAgentRegistry({ roots: [root] });
  await registry.list();
  return registry;
}

function testTool(
  name: string,
  execute: ToolExecutor["execute"],
  operationType: "read-only" | "read-write" | "execute" | "external-submit" = "read-only",
  requiresConfirmation = false
): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      metadata: {
        category: "other",
        riskLevel: operationType === "read-only" ? "low" : "high",
        operationType,
        requiresConfirmation,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 800,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    execute,
  };
}

class SequenceIntelligenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly responses: readonly ModelResponse[]) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return this.responses[this.requests.length - 1] ?? this.responses.at(-1)!;
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }
}

function completedResponse(requestId: string, output: unknown): ModelResponse {
  return {
    responseId: `${requestId}-response`,
    requestId,
    providerId: "test-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-model",
    status: "completed",
    outputKind: "explanation",
    structuredOutput: output,
    finishReason: "stop",
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function textResponse(requestId: string, text: string): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    textOutput: text,
  };
}

function toolCallResponse(
  requestId: string,
  callId: string,
  toolName: string,
  input: unknown
): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    toolCalls: [{ callId, toolName, input }],
    finishReason: "tool_call",
  };
}
