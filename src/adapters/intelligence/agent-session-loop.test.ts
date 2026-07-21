import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { estimateContextTokens, estimateTokens, InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from "@earendil-works/pi-ai";
import type { AgentLoopAgentTool, AgentLoopInput } from "../../app/model-runtime/agent-loop.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolExecutor,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { withToolModelAttachments } from "../../domain/tools/index.js";
import { createAgentSessionLoop } from "./agent-session-loop.js";
import { ToolCenter } from "../../app/tool-center/tool-center.js";
import { createReadToolOutputTool } from "../../app/tool-center/adapters/tool-output-read-tool.js";
import { InMemoryToolOutputStore } from "../../app/tool-center/tool-output-store.js";

test("agent session loop completes a direct answer in the injected Session with usage", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("final answer")]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.finalText, "final answer");
  const branch = await fixture.session.getBranch();
  assert.deepEqual(branch.flatMap((entry) => entry.type === "message" ? [entry.message.role] : []), ["user", "assistant"]);
  assert.equal(result.usage.requestCount, 1);
  assert.equal(result.session?.sessionId, "run-1");
  assert.equal(result.session?.startLeafRef, null);
  assert.equal(result.session?.inputEntryRef?.sessionId, "run-1");
  assert.equal(result.session?.latestLeafRef?.sessionId, "run-1");
  await loop.release();
});

test("agent session loop forwards the frozen thinking level to Pi provider requests", async (t) => {
  const observed: string[] = [];
  const fixture = await createFixture(t, {
    models: [{ id: "reasoning-model", reasoning: true }],
  });
  fixture.faux.setResponses([(context, options) => {
    void context;
    const reasoning = typeof options === "object" && options !== null && "reasoning" in options
      ? options.reasoning
      : undefined;
    observed.push(String(reasoning ?? "off"));
    return fauxAssistantMessage("reasoned answer");
  }]);
  const loop = createAgentSessionLoop({ ...fixture, thinkingLevel: "high" });

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "completed");
  assert.deepEqual(observed, ["high"]);
  await loop.release();
});

test("agent session loop reads prior turns from the injected session", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("answer one")]);
  const firstLoop = createAgentSessionLoop(fixture);
  const first = await firstLoop.execute(loopInput(emptyGateway(), {
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "question one" },
    ],
  }));
  assert.equal(first.status, "completed");
  await firstLoop.release();

  fixture.faux.setResponses([(context) => {
    assert.deepEqual(context.messages.map((message) => message.role), ["user", "assistant", "user"]);
    assert.deepEqual(context.messages[0]?.role === "user" ? context.messages[0].content : undefined, [
      { type: "text", text: "question one" },
    ]);
    return fauxAssistantMessage("answer two");
  }]);
  const secondLoop = createAgentSessionLoop(fixture);
  const second = await secondLoop.execute(loopInput(emptyGateway(), {
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "question two" },
    ],
  }));

  assert.equal(second.status, "completed", second.status === "failed" ? second.error : undefined);
  await secondLoop.release();
});

test("agent session loop sends image bytes to the provider without persisting them in Session", async (t) => {
  const fixture = await createFixture(t);
  const imageData = Buffer.from("ephemeral-image-bytes").toString("base64");
  fixture.faux.setResponses([(context) => {
    const current = context.messages.at(-1);
    assert.equal(current?.role, "user");
    assert.equal(JSON.stringify(current).includes(imageData), true);
    return fauxAssistantMessage("image inspected");
  }]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway(), {
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      {
        role: "user",
        content: "inspect this image",
        attachments: [{
          kind: "image",
          attachmentId: "image-1",
          inputRef: "file:image.png",
          source: { kind: "data", mimeType: "image/png", data: imageData },
        }],
      },
    ],
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  const branchJson = JSON.stringify(await fixture.session.getBranch());
  assert.equal(branchJson.includes(imageData), false);
  assert.match(branchJson, /image attachment omitted from durable Session/u);
  await loop.release();
});

test("agent session loop does not call the provider when cancellation is already requested", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("must not be reached")]);
  const cancellation = new AbortController();
  cancellation.abort(new Error("cancelled by user"));
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway(), { abortSignal: cancellation.signal }));

  assert.equal(result.status, "cancelled");
  assert.match(result.status === "cancelled" ? result.error ?? "" : "", /cancelled by user/);
  assert.equal(fixture.faux.state.callCount, 0);
  await loop.release();
});

test("agent session loop preserves proven provider stop classifications", async (t) => {
  const fixture = await createFixture(t);
  const loop = createAgentSessionLoop(fixture);

  fixture.faux.setResponses([fauxAssistantMessage("partial answer", { stopReason: "length" })]);
  const truncated = await loop.execute(loopInput(emptyGateway()));
  assert.equal(truncated.status, "failed");
  assert.equal(truncated.status === "failed" ? truncated.errorCode : undefined, "output_truncated");
  await loop.release();

  const providerFailureLoop = createAgentSessionLoop(fixture);
  fixture.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider rejected the request" })]);
  const providerFailure = await providerFailureLoop.execute(loopInput(emptyGateway()));
  assert.equal(providerFailure.status, "failed");
  assert.equal(providerFailure.status === "failed" ? providerFailure.errorCode : undefined, "provider_response");
  await providerFailureLoop.release();
});

test("agent session loop maps provider refusal diagnostics to a stable failed result", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([{
    ...fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "The model refused to provide a response",
    }),
    diagnostics: [{
      type: "provider_refusal",
      timestamp: Date.now(),
      details: { refusal: "I cannot complete that request." },
    }],
  }]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "model_refusal");
  assert.equal(
    result.status === "failed" ? result.error : undefined,
    "The model refused the request: I cannot complete that request.",
  );
  await loop.release();
});

test("agent session loop preserves the Responses incomplete reason", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([{
    ...fauxAssistantMessage("partial", { stopReason: "length" }),
    providerMetadata: { status: "incomplete", incompleteReason: "content_filter" },
  }]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "content_filtered");
  assert.equal(result.status === "failed" ? result.error : undefined, "Model response was incomplete: content_filter.");
  await loop.release();
});

test("agent session loop normalizes Pi provider errors into AgentArbor failure codes", async (t) => {
  const fixture = await createFixture(t);
  const cases = [
    {
      message: "Request timed out while waiting for the provider.",
      expectedCode: "provider_timeout",
    },
    {
      message: "fetch failed: other side closed",
      expectedCode: "provider_network",
    },
    {
      message: "OpenAI API error (401): invalid_api_key",
      expectedCode: "provider_auth",
    },
    {
      message: "429: rate_limit_exceeded",
      expectedCode: "provider_rate_limit",
    },
    {
      message: "No API key for provider: agentarbor-test",
      expectedCode: "provider_config",
    },
    {
      message: "provider rejected the request",
      expectedCode: "provider_response",
    },
    {
      message: "Provider finish_reason: content_filter",
      expectedCode: "content_filtered",
    },
    {
      message: "This model's maximum context length is 8192 tokens.",
      expectedCode: "context_overflow",
    },
  ] as const;

  for (const fixtureCase of cases) {
    fixture.faux.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: fixtureCase.message }),
    ]);
    const loop = createAgentSessionLoop(fixture);

    const result = await loop.execute(loopInput(emptyGateway()));

    assert.equal(result.status, "failed", fixtureCase.message);
    assert.equal(
      result.status === "failed" ? result.errorCode : undefined,
      fixtureCase.expectedCode,
      fixtureCase.message,
    );
    assert.equal(result.status === "failed" ? result.error : undefined, fixtureCase.message);
    await loop.release();
  }
});

test("agent session loop persists compaction before the next provider request", async (t) => {
  const fixture = await createFixture(t, {
    models: [{ id: "small-model", contextWindow: 2_400, maxTokens: 500 }],
  });
  for (let index = 0; index < 30; index += 1) {
    await fixture.session.appendMessage({
      role: "user",
      content: `old context ${index} `.repeat(50),
      timestamp: index * 2 + 1,
    });
    await fixture.session.appendMessage(fauxAssistantMessage(`old answer ${index}`));
  }
  fixture.faux.setResponses([
    fauxAssistantMessage("summary of old context"),
    fauxAssistantMessage("answer after compaction"),
  ]);
  const observedEntries: string[] = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    compactionSettings: { enabled: true, reserveTokens: 100, keepRecentTokens: 300 },
  });

  const result = await loop.execute(loopInput(emptyGateway(), {
    onSessionWriteCheckpoint: async (checkpoint) => {
      if (checkpoint.kind === "compaction_entry_committed") {
        observedEntries.push(checkpoint.compactionEntryRef.entryId);
      }
    },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(observedEntries.length, 1);
  assert.equal((await fixture.session.getEntry(observedEntries[0]!))?.type, "compaction");
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

test("agent session loop bounds a twenty-turn session with repeated tool rounds and compaction", async (t) => {
  const fixture = await createFixture(t, {
    models: [{ id: "small-model", contextWindow: 3_000, maxTokens: 500 }],
  });
  let toolCallSequence = 0;
  const response = (context: Context) => {
    if ((context.tools?.length ?? 0) === 0) {
      return fauxAssistantMessage("summary of prior turns");
    }
    if (context.messages.at(-1)?.role === "user") {
      toolCallSequence += 1;
      return fauxAssistantMessage(
        fauxToolCall("read_file", { path: "README.md" }, { id: `read-${toolCallSequence}` }),
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage(`turn ${toolCallSequence} complete`);
  };
  fixture.faux.setResponses(Array.from({ length: 100 }, () => response));
  let toolExecutions = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    execute: async (request) => {
      toolExecutions += 1;
      return {
        ...request,
        output: { content: `evidence ${toolExecutions} `.repeat(30) },
        status: "completed",
        durationMs: 1,
      };
    },
  });
  const compactionEntryIds = new Set<string>();

  for (let turn = 1; turn <= 20; turn += 1) {
    const loop = createAgentSessionLoop({
      ...fixture,
      compactionSettings: { enabled: true, reserveTokens: 500, keepRecentTokens: 300 },
    });
    const result = await loop.execute(loopInput(gateway, {
      messages: [
        { role: "system", content: "You are the Ordinary Agent." },
        { role: "user", content: `turn ${turn} ${"context ".repeat(60)}` },
      ],
      onSessionWriteCheckpoint: async (checkpoint) => {
        if (checkpoint.kind === "compaction_entry_committed") {
          compactionEntryIds.add(checkpoint.compactionEntryRef.entryId);
        }
      },
    }));
    if (result.status !== "completed") {
      const observed = (await fixture.session.buildContext()).messages;
      assert.fail(`turn ${turn}: ${JSON.stringify(result)}; tokens=${estimateContextTokens(observed).tokens}; messages=${JSON.stringify(observed.map((message) => [message.role, estimateTokens(message)]))}`);
    }
    await loop.release();
  }

  const finalContext = (await fixture.session.buildContext()).messages;
  assert.equal(toolExecutions, 20);
  assert.equal(toolCallSequence, 20);
  assert.equal(compactionEntryIds.size >= 2, true);
  assert.equal(fixture.faux.state.callCount > 40, true);
  assert.equal(estimateContextTokens(finalContext).tokens < 1_900, true);
});

test("agent session loop sends one ToolCenter fact back to the model in callback order", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "README.md" }, { id: "read-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("read complete"),
  ]);
  const order: string[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    execute: async (request) => ({
      ...request,
      output: "contents",
      status: "completed",
      durationMs: 2,
    }),
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    onSessionWriteCheckpoint: async (checkpoint) => { order.push(`session:${checkpoint.kind}`); },
    onToolRequested: () => { order.push("requested"); },
    onToolResult: async () => { order.push("result"); },
  }));

  assert.equal(result.status, "completed");
  assert.deepEqual(order, [
    "session:start_leaf_captured",
    "session:input_entry_committed",
    "session:assistant_tool_call_entry_committed",
    "requested",
    "result",
    "session:tool_result_entries_committed",
    "session:assistant_response_entry_committed",
  ]);
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0]?.callId, "read-call");
  const toolResults = (await fixture.session.getBranch()).filter((entry) =>
    entry.type === "message" && entry.message.role === "toolResult");
  assert.equal(toolResults.length, 1);
  await loop.release();
});

test("agent session loop reads an oversized ToolCenter result through Pi continuation without rerunning the tool", async (t) => {
  const fixture = await createFixture(t);
  const outputStore = new InMemoryToolOutputStore();
  const toolCenter = new ToolCenter({ outputStore, maxInlineOutputChars: 128 });
  let producerExecutions = 0;
  toolCenter.register(oversizedReportTool(async () => {
    producerExecutions += 1;
    return { content: "report-line ".repeat(400) };
  }));
  toolCenter.register(createReadToolOutputTool(outputStore));

  let continuationInput: Record<string, unknown> | undefined;
  const accepted: ToolCallResult[] = [];
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("produce_report", {}, { id: "report-call" }), {
      stopReason: "toolUse",
    }),
    () => {
      assert.ok(continuationInput, "ToolCenter did not provide a read_tool_output continuation.");
      return fauxAssistantMessage(fauxToolCall("read_tool_output", continuationInput, { id: "report-read" }), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage("report recovered"),
  ]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(toolCenter, {
    onToolResult: async (toolResult) => {
      accepted.push(toolResult);
      if (toolResult.toolName !== "produce_report") return;
      const output = toolResult.output as { readonly continuation?: { readonly nextInput?: unknown } };
      continuationInput = output.continuation?.nextInput as Record<string, unknown> | undefined;
    },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(result.status === "completed" ? result.finalText : undefined, "report recovered");
  assert.equal(producerExecutions, 1);
  assert.deepEqual(accepted.map((item) => item.toolName), ["produce_report", "read_tool_output"]);
  assert.equal(typeof (accepted[0]?.output as { readonly contentRef?: unknown })?.contentRef, "string");
  assert.match(JSON.stringify(accepted[1]?.output), /report-line/u);
  await loop.release();
});

test("agent session loop keeps tool-origin images available to the next model request only", async (t) => {
  const fixture = await createFixture(t);
  const imageData = Buffer.from("tool-image-bytes").toString("base64");
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("inspect_image", { path: "image.png" }, { id: "image-call" }), {
      stopReason: "toolUse",
    }),
    (context) => {
      const toolMessage = context.messages.at(-1);
      assert.equal(toolMessage?.role, "toolResult");
      assert.equal(
        JSON.stringify(toolMessage).includes(imageData),
        true,
        JSON.stringify(toolMessage),
      );
      return fauxAssistantMessage("image inspected");
    },
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("inspect_image", "read-only"),
    execute: async (request) => ({
      ...request,
      output: withToolModelAttachments({ kind: "image-result" }, [{
        kind: "image",
        attachmentId: "tool-image-1",
        source: { kind: "data", mimeType: "image/png", data: imageData },
      }]),
      status: "completed",
      durationMs: 1,
    }),
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  const branchJson = JSON.stringify(await fixture.session.getBranch());
  assert.equal(branchJson.includes(imageData), false);
  assert.match(branchJson, /image attachment omitted from durable Session/u);
  await loop.release();
});

test("agent session loop fails unsupported tool attachments instead of dropping them", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read_document", { path: "report.pdf" }, { id: "file-call" }), {
      stopReason: "toolUse",
    }),
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("read_document", "read-only"),
    execute: async (request) => ({
      ...request,
      output: withToolModelAttachments({ kind: "document-result" }, [{
        kind: "file",
        filename: "report.pdf",
        source: {
          kind: "data",
          mimeType: "application/pdf",
          data: Buffer.from("pdf-bytes").toString("base64"),
        },
      }]),
      status: "completed",
      durationMs: 1,
    }),
  });
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop(fixture);

  await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));

  assert.equal(fixture.faux.state.callCount, 1);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]?.status, "failed");
  assert.equal(accepted[0]?.errorFacts?.code, "tool_result_attachment_not_supported");
  assert.equal(accepted[0]?.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(accepted[0]?.errorFacts?.doNotBlindlyRetry, true);
  await loop.release();
});

test("agent session loop pauses when a read-only executor discovers approval during execution", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "private.txt" }, { id: "dynamic-read" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("private read complete"),
  ]);
  const confirmationRequest = {
    confirmationId: "confirm-dynamic-read",
    toolCallFactId: "dynamic-read",
    title: "Read private file",
    actionSummary: "Read private.txt",
    affectedResources: ["private.txt"],
    riskLevel: "medium" as const,
    requestedAt: "2026-07-20T00:00:00.000Z",
    sourceRefs: [],
  };
  const accepted: ToolCallResult[] = [];
  let executeCount = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    execute: async (request, _context, permission) => {
      executeCount += 1;
      if (permission.approvedConfirmationIds?.includes("confirm-dynamic-read") !== true) {
        return {
          ...request,
          output: "partial content before the gate",
          status: "approval_required",
          durationMs: 3,
          confirmationRequest,
        };
      }
      return { ...request, output: "private contents", status: "completed", durationMs: 4 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.deepEqual(paused.confirmationRequests, [confirmationRequest]);
  assert.equal(executeCount, 1);
  assert.equal(accepted[0]?.status, "approval_required");

  const completed = await paused.continuation.decide({
    decision: {
      confirmationId: "confirm-dynamic-read",
      decision: "approve_once",
      decidedAt: "2026-07-20T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(executeCount, 2);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "completed"]);
  await loop.release();
});

test("agent session loop keeps concurrent dynamic approvals pending until each is decided", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("read_file", { path: "private-a.txt" }, { id: "dynamic-a" }),
      fauxToolCall("read_file", { path: "private-b.txt" }, { id: "dynamic-b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("both private reads completed"),
  ]);
  const accepted: ToolCallResult[] = [];
  let executeCount = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    execute: async (request, _context, permission) => {
      executeCount += 1;
      const confirmationId = `confirm-${request.callId}`;
      if (permission.approvedConfirmationIds?.includes(confirmationId) !== true) {
        return {
          ...request,
          output: `partial:${request.callId}`,
          status: "approval_required",
          durationMs: 2,
          confirmationRequest: {
            confirmationId,
            toolCallFactId: request.callId,
            title: "Read private file",
            actionSummary: `Read ${request.callId}`,
            affectedResources: [request.callId],
            riskLevel: "medium" as const,
            requestedAt: "2026-07-20T00:00:00.000Z",
            sourceRefs: [],
          },
        };
      }
      return { ...request, output: `completed:${request.callId}`, status: "completed", durationMs: 3 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.equal(paused.confirmationRequests.length, 2);
  const firstConfirmationId = paused.confirmationRequests[0]!.confirmationId;
  const afterFirstDecision = await paused.continuation.decide({
    decision: {
      confirmationId: firstConfirmationId,
      decision: "approve_once",
      decidedAt: "2026-07-20T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(afterFirstDecision.status, "approval_required");
  if (afterFirstDecision.status !== "approval_required") return;
  assert.equal(afterFirstDecision.confirmationRequests.length, 1);
  assert.notEqual(afterFirstDecision.confirmationRequests[0]?.confirmationId, firstConfirmationId);
  assert.equal(executeCount, 3);

  const completed = await afterFirstDecision.continuation.decide({
    decision: {
      confirmationId: afterFirstDecision.confirmationRequests[0]!.confirmationId,
      decision: "approve_once",
      decidedAt: "2026-07-20T00:00:02.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(executeCount, 4);
  assert.equal(accepted.filter((result) => result.status === "approval_required").length, 2);
  assert.equal(accepted.filter((result) => result.status === "completed").length, 2);
  assert.equal(accepted.some((result) => result.status === "cancelled"), false);
  await loop.release();
});

test("agent session loop denial rejects only the pending call and lets the model continue", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write_file", { path: "a.txt" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("I will use another approach."),
  ]);
  let executeCount = 0;
  const accepted: ToolCallResult[] = [];
  const confirmationRequest = writeConfirmationRequest();
  const gateway = gatewayFor({
    definition: toolDefinition("write_file", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest,
      },
    }),
    execute: async (request) => {
      executeCount += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.deepEqual(paused.confirmationRequests, [confirmationRequest]);
  assert.equal(executeCount, 0);

  const completed = await paused.continuation.decide({
    decision: {
      confirmationId: "confirm-write",
      decision: "deny",
      decidedAt: "2026-07-20T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed");
  if (completed.status !== "completed") return;
  assert.equal(completed.finalText, "I will use another approach.");
  assert.equal(executeCount, 0);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "failed"]);
  assert.equal(completed.toolResults[0]?.errorFacts?.code, "tool_call_denied");
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

test("agent session loop executes an approved tool exactly once", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write_file", { path: "a.txt" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("write complete"),
  ]);
  const accepted: ToolCallResult[] = [];
  const approvedConfirmationIds: string[][] = [];
  let executeCount = 0;
  const confirmationRequest = writeConfirmationRequest();
  const gateway = gatewayFor({
    definition: toolDefinition("write_file", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: { ...request, output: undefined, status: "approval_required", durationMs: 0, confirmationRequest },
    }),
    execute: async (request, _context, permission) => {
      executeCount += 1;
      approvedConfirmationIds.push([...(permission.approvedConfirmationIds ?? [])]);
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));
  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;

  const completed = await paused.continuation.decide({
    decision: {
      confirmationId: "confirm-write",
      decision: "approve_once",
      decidedAt: "2026-07-20T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed");
  assert.equal(executeCount, 1);
  assert.deepEqual(approvedConfirmationIds, [["confirm-write"]]);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "completed"]);
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

test("agent session loop releases one static approval while retaining the remaining confirmation", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("read_file", { path: "a.txt" }, { id: "read-a" }),
      fauxToolCall("read_file", { path: "b.txt" }, { id: "read-b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("both private files were read"),
  ]);
  const executions: string[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: {
          confirmationId: `confirm-${request.callId}`,
          toolCallFactId: request.callId,
          title: "Read private file",
          actionSummary: `Read ${request.callId}`,
          affectedResources: [request.callId],
          riskLevel: "medium",
          requestedAt: "2026-07-20T00:00:00.000Z",
          sourceRefs: [],
        },
      },
    }),
    execute: async (request) => {
      executions.push(request.callId);
      return { ...request, output: `contents:${request.callId}`, status: "completed", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.deepEqual(paused.confirmationRequests.map((request) => request.confirmationId).sort(), ["confirm-read-a", "confirm-read-b"]);

  const afterFirstDecision = await paused.continuation.decide({
    decision: { confirmationId: "confirm-read-a", decision: "approve_once", decidedAt: "2026-07-20T00:00:01.000Z" },
    abortSignal: new AbortController().signal,
  });

  assert.equal(afterFirstDecision.status, "approval_required");
  if (afterFirstDecision.status !== "approval_required") return;
  assert.deepEqual(afterFirstDecision.confirmationRequests.map((request) => request.confirmationId), ["confirm-read-b"]);
  await withDeadline(waitForValue(() => executions.includes("read-a")), 1_000, "Approved tool did not begin before the remaining confirmation.");
  assert.deepEqual(executions, ["read-a"]);

  const completed = await afterFirstDecision.continuation.decide({
    decision: { confirmationId: "confirm-read-b", decision: "approve_once", decidedAt: "2026-07-20T00:00:02.000Z" },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.deepEqual(executions.sort(), ["read-a", "read-b"]);
  await loop.release();
});

test("agent session loop preserves the original cancellation signal after approval", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write_file", { path: "a.txt" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
  ]);
  const runCancellation = new AbortController();
  let observeToolStart!: () => void;
  const toolStarted = new Promise<void>((resolve) => { observeToolStart = resolve; });
  let observedToolSignal: AbortSignal | undefined;
  const confirmationRequest = writeConfirmationRequest();
  const gateway = gatewayFor({
    definition: toolDefinition("write_file", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: { ...request, output: undefined, status: "approval_required", durationMs: 0, confirmationRequest },
    }),
    execute: async (request, context) => {
      const toolAbortSignal = context.abortSignal;
      assert.ok(toolAbortSignal, "Tool execution context must include an abort signal.");
      observedToolSignal = toolAbortSignal;
      observeToolStart();
      await new Promise<void>((resolve) => toolAbortSignal.addEventListener("abort", () => resolve(), { once: true }));
      return { ...request, output: undefined, status: "cancelled", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, { abortSignal: runCancellation.signal }));
  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  const resumed = paused.continuation.decide({
    decision: { confirmationId: confirmationRequest.confirmationId, decision: "approve_once", decidedAt: "2026-07-20T00:00:01.000Z" },
    abortSignal: new AbortController().signal,
  });
  await withDeadline(toolStarted, 1_000, "Approved tool did not start.");

  runCancellation.abort(new Error("cancel original run"));
  const result = await withDeadline(resumed, 1_000, "Original run cancellation did not settle the loop.");

  assert.equal(observedToolSignal?.aborted, true);
  assert.equal(result.status, "cancelled");
  await loop.release();
});

test("agent session loop release cancels a tool waiting for approval without executing it", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write_file", { path: "a.txt" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
  ]);
  const accepted: ToolCallResult[] = [];
  let executeCount = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("write_file", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: writeConfirmationRequest(),
      },
    }),
    execute: async (request) => {
      executeCount += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));
  assert.equal(paused.status, "approval_required");

  await withDeadline(loop.release(), 1_000, "Agent loop release did not settle while approval was pending.");

  assert.equal(executeCount, 0);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "cancelled"]);
  await loop.release();
});

test("agent session loop stops after the owning feature rejects a tool fact", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "README.md" }, { id: "read-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("must not be reached"),
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    execute: async (request) => ({
      ...request,
      output: "contents",
      status: "completed",
      durationMs: 1,
    }),
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    onToolResult: async () => { throw new Error("tool fact persistence failed"); },
  }));

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.errorCode, "tool_result_acceptance_failed");
  assert.match(result.error, /tool fact persistence failed/);
  assert.equal(fixture.faux.state.callCount, 1);
  await loop.release();
});

test("agent session loop rejects delegated tools when complete result delivery is unavailable", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("must not be reached")]);
  const loop = createAgentSessionLoop(fixture);

  await assert.rejects(
    () => loop.execute(loopInput(emptyGateway(), { agentTools: [delegatedAgentTool([])] })),
    /require a gateway with complete result delivery/u,
  );

  assert.equal(fixture.faux.state.callCount, 0);
  await loop.release();
});

test("agent session loop keeps delegated transcripts isolated while preserving nested tool facts", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("call_sub_agent", { task: "inspect" }, { id: "shared-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read_file", { path: "README.md" }, { id: "shared-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("delegated result"),
    fauxAssistantMessage("parent synthesis"),
  ]);
  const accepted: ToolCallResult[] = [];
  const delivered: ToolCallResult[] = [];
  let observedCallerAgentId: string | undefined;
  let observedAllowedTools: readonly string[] | undefined;
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    execute: async (request, context, permission) => {
      observedCallerAgentId = context.callerAgentId;
      observedAllowedTools = permission.allowedTools;
      return { ...request, output: "contents", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => {
      delivered.push(result);
      return {
        ...result,
        output: {
          preview: "delegated result",
          continuation: { ref: "tool-output://delegated-result" },
        },
      };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["read_file"])],
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(result.status === "completed" ? result.finalText : undefined, "parent synthesis");
  assert.deepEqual(accepted.map((item) => item.toolName), ["read_file", "call_sub_agent"]);
  const nested = accepted[0];
  assert.equal(nested?.callId, "shared-call");
  assert.equal(nested?.factId, "agent-tool:11:shared-call/tool:shared-call");
  assert.equal(nested?.parentToolCallFactId, "shared-call");
  assert.deepEqual(accepted[1]?.output, {
    preview: "delegated result",
    continuation: { ref: "tool-output://delegated-result" },
  });
  assert.equal(accepted[1]?.delegatedExecution?.modelRounds, 2);
  assert.equal(accepted[1]?.delegatedExecution?.toolCallCount, 1);
  assert.equal(accepted[1]?.delegatedExecution?.usage.requestCount, 2);
  assert.equal(result.usage.requestCount, 4);
  assert.equal(observedCallerAgentId, "sub-agent:reviewer");
  assert.deepEqual(observedAllowedTools, ["read_file"]);
  assert.deepEqual(delivered.map((item) => item.toolName), ["call_sub_agent"]);
  assert.equal(delivered[0]?.output, "delegated result");
  const rootMessages = (await fixture.session.getBranch()).flatMap((entry) =>
    entry.type === "message" ? [entry.message] : []);
  assert.deepEqual(rootMessages.map((message) => message.role), ["user", "assistant", "toolResult", "assistant"]);
  assert.equal(rootMessages.filter((message) => message.role === "toolResult").length, 1);
  assert.equal(rootMessages.find((message) => message.role === "toolResult")?.toolCallId, "shared-call");
  assert.match(JSON.stringify(rootMessages.find((message) => message.role === "toolResult")?.content), /tool-output:\/\/delegated-result/u);
  await loop.release();
});

test("delegated tool approval resumes once with the continuation abort signal", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("call_sub_agent", { task: "write" }, { id: "delegate-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("write_file", { path: "a.txt" }, { id: "nested-write" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("delegated write complete"),
    fauxAssistantMessage("parent complete"),
  ]);
  const confirmationId = "confirm-nested-write";
  let executeCount = 0;
  let observedAbortSignal: AbortSignal | undefined;
  const gateway = gatewayFor({
    definition: toolDefinition("write_file", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: {
          confirmationId,
          toolCallFactId: request.factId ?? request.callId,
          title: "Write file",
          actionSummary: "Write a.txt",
          affectedResources: ["a.txt"],
          riskLevel: "medium",
          requestedAt: "2026-07-20T00:00:00.000Z",
          sourceRefs: [],
        },
      },
    }),
    execute: async (request, context) => {
      executeCount += 1;
      observedAbortSignal = context.abortSignal;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["write_file"])],
  }));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.equal(paused.confirmationRequests[0]?.toolCallFactId, "agent-tool:13:delegate-call/tool:nested-write");
  const resumed = new AbortController();
  const completed = await paused.continuation.decide({
    decision: { confirmationId, decision: "approve_once", decidedAt: "2026-07-20T00:00:01.000Z" },
    abortSignal: resumed.signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(executeCount, 1);
  assert.equal(observedAbortSignal?.aborted, false);
  resumed.abort(new Error("cancel delegated continuation"));
  assert.equal(observedAbortSignal?.aborted, true);
  await loop.release();
});

test("denying a delegated tool call does not stop the child or parent model loops", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("call_sub_agent", { task: "write" }, { id: "delegate-deny" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("write_file", { path: "a.txt" }, { id: "nested-deny" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("delegated agent adapted after denial"),
    fauxAssistantMessage("parent accepted the alternative"),
  ]);
  const confirmationId = "confirm-nested-deny";
  let executeCount = 0;
  const accepted: ToolCallResult[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("write_file", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: {
          confirmationId,
          toolCallFactId: request.factId ?? request.callId,
          title: "Write file",
          actionSummary: "Write a.txt",
          affectedResources: ["a.txt"],
          riskLevel: "medium",
          requestedAt: "2026-07-20T00:00:00.000Z",
          sourceRefs: [],
        },
      },
    }),
    execute: async (request) => {
      executeCount += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["write_file"])],
    onToolResult: async (result) => { accepted.push(result); },
  }));
  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;

  const completed = await paused.continuation.decide({
    decision: { confirmationId, decision: "deny", decidedAt: "2026-07-20T00:00:01.000Z" },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(completed.status === "completed" ? completed.finalText : undefined, "parent accepted the alternative");
  assert.equal(executeCount, 0);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "failed", "completed"]);
  assert.equal(accepted[1]?.errorFacts?.code, "tool_call_denied");
  assert.equal(fixture.faux.state.callCount, 4);
  await loop.release();
});

test("rejecting a nested tool fact stops both delegated and parent provider loops", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("call_sub_agent", { task: "inspect" }, { id: "delegate-persistence" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read_file", { path: "README.md" }, { id: "nested-persistence" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child must not continue"),
    fauxAssistantMessage("parent must not continue"),
  ]);
  const accepted: ToolCallResult[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    execute: async (request) => ({
      ...request,
      output: "contents",
      status: "completed",
      durationMs: 1,
    }),
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["read_file"])],
    onToolResult: async (toolResult) => {
      accepted.push(toolResult);
      if (toolResult.parentToolCallFactId !== undefined) {
        throw new Error("nested fact persistence failed");
      }
    },
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "tool_result_acceptance_failed");
  assert.equal(fixture.faux.state.callCount, 2);
  assert.equal(accepted.some((item) => item.parentToolCallFactId !== undefined), true);
  assert.equal(accepted.some((item) => item.toolName === "call_sub_agent"), true);
  await loop.release();
});

test("releasing the parent loop cancels a delegated approval wait without executing it", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("call_sub_agent", { task: "write" }, { id: "delegate-release" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("write_file", { path: "a.txt" }, { id: "nested-release" }), {
      stopReason: "toolUse",
    }),
  ]);
  let executeCount = 0;
  const accepted: ToolCallResult[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("write_file", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: {
          confirmationId: "confirm-nested-release",
          toolCallFactId: request.factId ?? request.callId,
          title: "Write file",
          actionSummary: "Write a.txt",
          affectedResources: ["a.txt"],
          riskLevel: "medium",
          requestedAt: "2026-07-20T00:00:00.000Z",
          sourceRefs: [],
        },
      },
    }),
    execute: async (request) => {
      executeCount += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["write_file"])],
    onToolResult: async (result) => { accepted.push(result); },
  }));
  assert.equal(paused.status, "approval_required");

  await withDeadline(loop.release(), 1_000, "Delegated approval wait did not settle during release.");

  assert.equal(executeCount, 0);
  assert.equal(fixture.faux.state.callCount, 2);
  assert.equal(accepted.some((result) =>
    result.parentToolCallFactId === "delegate-release" && result.status === "cancelled"), true);
  assert.equal(accepted.some((result) =>
    result.toolName === "call_sub_agent" && result.parentToolCallFactId === undefined && result.status === "cancelled"), true);
  await loop.release();
});

test("delegated agents cannot expand the parent tool boundary or recurse", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("call_sub_agent", { task: "expand" }, { id: "delegate-outside" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("parent handled delegation failure"),
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("read_file", "read-only"),
    execute: async () => { throw new Error("Nested execution must not start."); },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["write_file", "call_sub_agent"])],
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  const delegatedResult = result.toolResults.find((item) => item.toolName === "call_sub_agent");
  assert.equal(delegatedResult?.status, "failed");
  assert.match(delegatedResult?.error ?? "", /outside the parent boundary/u);
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

async function createFixture(
  t: test.TestContext,
  options?: Parameters<typeof fauxProvider>[0],
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-session-loop-"));
  const env = new NodeExecutionEnv({ cwd: root });
  t.after(async () => {
    await env.cleanup();
    await rm(root, { recursive: true, force: true });
  });
  const faux = fauxProvider(options);
  const models = createModels();
  models.setProvider(faux.provider);
  const session = await new InMemorySessionRepo().create({ id: "run-1" });
  return {
    executionEnvironment: env,
    modelRegistry: models,
    selectedModel: faux.getModel(),
    agentSession: session,
    session,
    faux,
  };
}

function loopInput(
  gateway: ToolExecutionGateway,
  overrides: Partial<AgentLoopInput> = {},
): AgentLoopInput {
  return {
    instructions: "You are the Ordinary Agent.",
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "help" },
    ],
    tools: {
      gateway,
      context: { callerAgentId: "ordinary", traceId: "run-1", goalId: "run-1" },
      permission: { callerAgentId: "ordinary", allowedTools: gateway.list().map((tool) => tool.name) },
    },
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function emptyGateway(): ToolExecutionGateway {
  return gatewayFor({
    definition: undefined,
    execute: async () => { throw new Error("No tools are available."); },
  });
}

function gatewayFor(input: {
  readonly definition: ToolDefinition | undefined;
  readonly preflight?: ToolExecutionGateway["preflight"];
  readonly execute: (
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ) => Promise<ToolCallResult>;
  readonly deliverResult?: NonNullable<ToolExecutionGateway["deliverResult"]>;
}): ToolExecutionGateway {
  const definitions = input.definition === undefined ? [] : [input.definition];
  return {
    list: () => globalThis.structuredClone(definitions),
    has: (name) => definitions.some((definition) => definition.name === name),
    preflight: input.preflight ?? ((request) => ({ status: "ready", request })),
    execute: input.execute,
    ...(input.deliverResult === undefined ? {} : { deliverResult: input.deliverResult }),
  };
}

function delegatedAgentTool(allowedTools: readonly string[]): AgentLoopAgentTool {
  return {
    toolName: "call_sub_agent",
    toolDescription: "Call a reviewer for one bounded task.",
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
      additionalProperties: false,
    },
    resolve: async () => ({
      agentName: "reviewer",
      instructions: "Review the delegated task and return the complete result.",
      input: "Inspect the requested material.",
      callerAgentId: "sub-agent:reviewer",
      allowedTools,
    }),
  };
}

function toolDefinition(name: string, operationType: "read-only" | "read-write"): ToolDefinition {
  return {
    name,
    description: `Execute ${name}.`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    metadata: {
      category: "workspace",
      riskLevel: operationType === "read-only" ? "low" : "medium",
      operationType,
      requiresConfirmation: operationType !== "read-only",
    },
  };
}

function oversizedReportTool(execute: ToolExecutor["execute"]): ToolExecutor {
  return {
    definition: {
      name: "produce_report",
      description: "Produce a report for the current task.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      metadata: {
        category: "workspace",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
    },
    execute,
  };
}

function writeConfirmationRequest() {
  return {
    confirmationId: "confirm-write",
    toolCallFactId: "write-call",
    title: "Write file",
    actionSummary: "Write a.txt",
    affectedResources: ["a.txt"],
    riskLevel: "medium" as const,
    requestedAt: "2026-07-20T00:00:00.000Z",
    sourceRefs: [],
  };
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForValue(predicate: () => boolean): Promise<void> {
  while (!predicate()) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
