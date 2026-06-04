import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startLocalPanelServer, type PanelProviderFetch } from "./panel-server.js";
import {
  assertSafePanelJsonText,
  removeTemporaryTree,
  requestJson,
  requestSse,
  waitForRun,
} from "./panel-server-test-utils.js";
import {
  createInvalidOpenAiResponse,
  createOpenAiSearchToolCallResponse,
  createOpenAiStreamTextResponse,
  createStubOpenAiAggregationResponse,
  createStubOpenAiResponse,
  hasResponsesToolDefinition,
  hasResponsesToolOutput,
  parseResponsesRequestBody,
  responsesRequestText,
} from "./panel-openai-test-fixtures.js";

test("panel rejects disabled AI mode without starting an approved underground run or leaking secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-ai-disabled-"));
  const secret = "sk-ai-disabled-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret, model: "unused-model" },
    });
    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "none" },
    });

    assert.equal(run.status, 400);
    assert.equal(run.text.includes(secret), false);
    assert.equal(run.body.ok, false);
    assert.equal(run.body.error.code, "ai_disabled");
    assert.equal(run.body.summary.ai.enabled, false);
    assert.equal(run.body.summary.ai.status, "configuration_failed");
    assert.equal(run.body.summary.ai.eventCounts.requested, 0);
    assert.equal(run.body.summary.ai.modelCallRefs.length, 0);
    assert.equal(run.body.observation, undefined);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel fake AI run exposes model and candidate summaries without model prompt content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-fake-"));
  const secret = "sk-visible-output-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "unused-fake-model",
        apiKey: secret,
      },
    });
    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: {
        goal: "需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。",
        aiMode: "fake",
      },
    });

    assert.equal(run.status, 200);
    assert.equal(run.body.summary.ai.mode, "fake");
    assert.equal(run.body.summary.ai.eventCounts.requested > 0, true);
    assert.equal(run.body.summary.ai.modelCallRefs.length > 0, true);
    assert.equal(run.body.summary.ai.modelCallRefs.some((call: { visibleOutput?: unknown }) => call.visibleOutput !== undefined), true);
    assert.equal(run.body.tracking.provider.status, "fake_provider");
    assert.equal(run.body.tracking.modelTotals.requested > 0, true);
    assert.equal(run.body.tracking.rootletsByKind.option.model.completed > 0, true);
    assert.equal(run.body.tracking.aiCandidates.total > 0, true);
    assert.equal(run.body.tracking.convergence.outcome === "approved" || run.body.tracking.convergence.outcome === "awaiting_user", true);
    const visibleCalls = run.body.transcript.modelCalls.filter(
      (call: { visibleOutput?: unknown }) => call.visibleOutput !== undefined
    ) as {
      readonly rootletKind?: string;
      readonly visibleOutput: {
        readonly contractId: string;
        readonly outputKind: string;
        readonly validationStatus: string;
        readonly rootletKind?: string;
        readonly truncated: boolean;
        readonly items: readonly {
          readonly fields: readonly { readonly name: string; readonly value: string; readonly truncated: boolean }[];
        }[];
      };
    }[];
    const optionCall = visibleCalls.find((call: { rootletKind?: string }) => call.rootletKind === "option");
    const riskCall = visibleCalls.find((call: { rootletKind?: string }) => call.rootletKind === "risk");
    assert.equal(visibleCalls.length > 0, true);
    if (optionCall === undefined) {
      throw new Error("Expected option visible output in fake AI panel run.");
    }
    if (riskCall === undefined) {
      throw new Error("Expected risk visible output in fake AI panel run.");
    }
    assert.equal(optionCall.visibleOutput.contractId, "underground.rootlet_candidate_advice.option.v2");
    assert.equal(optionCall.visibleOutput.outputKind, "candidate");
    assert.equal(optionCall.visibleOutput.validationStatus, "passed");
    assert.equal(optionCall.visibleOutput.rootletKind, "option");
    assert.equal(optionCall.visibleOutput.truncated, false);
    const optionFields = optionCall.visibleOutput.items[0]?.fields ?? [];
    assert.equal(
      optionFields.some(
        (field: { name: string; value: string }) =>
          field.name === "summary" && field.value.includes("Fake option candidate advice 1")
      ),
      true
    );
    assert.equal(optionFields.some((field: { name: string; value: string }) => field.name === "tradeoffs" && field.value.includes("goal-specific")), true);
    assert.equal(optionFields.some((field: { name: string; truncated: boolean }) => field.name === "applicability" && field.truncated === false), true);
    assert.equal(
      riskCall.visibleOutput.items[0].fields.some((field: { name: string }) => field.name === "impactScope"),
      true
    );
    assertSafePanelJsonText(run.text);
    assert.equal(run.text.includes("API key"), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop explicit deep mode runs Underground organization and stops at Plan boundary", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-fake-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Build a Desktop Shell visible deep mode direction.", aiMode: "fake", runMode: "deep" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(start.body.runKind, "desktop");
    assert.equal(start.body.runMode, "deep");
    assert.equal(start.body.route, undefined);
    assert.equal(completed.body.runKind, "desktop");
    assert.equal(completed.body.runMode, "deep");
    assert.equal(completed.body.route, undefined);
    assert.equal(
      completed.body.transcript.events.some((event: { type: string; summary?: string }) =>
        event.type === "run.started" && String(event.summary ?? "").includes("深度处理")
      ),
      true
    );
    assert.equal(completed.body.canvas.kind, "underground_deep_canvas");
    assert.equal(completed.body.canvas.task.goalSummary.includes("Desktop Shell visible deep mode direction"), true);
    assert.equal(completed.body.canvas.underground.status, "approved_package_created");
    assert.equal(completed.body.canvas.underground.packageRef.validationPassed, true);
    assert.equal(completed.body.canvas.underground.recommendedDirection.summary.length > 0, true);
    assert.equal(completed.body.canvas.underground.recommendedDirection.reason.includes("汇总"), true);
    assert.equal(completed.body.canvas.underground.keyEvidenceRefs.length > 0, true);
    assert.equal(completed.body.canvas.underground.childRunCount > 0, true);
    assert.equal(completed.body.canvas.underground.parentSynthesisCount > 0, true);
    assert.equal(
      completed.body.transcript.events.some((event: { summary?: string }) =>
        String(event.summary ?? "").includes("深度处理")
      ),
      true
    );
    assert.equal(JSON.stringify(completed.body.canvas).includes("Fake parent synthesis"), false);
    assert.equal(JSON.stringify(completed.body.canvas).includes("Fake Work Session"), false);
    assert.equal(completed.body.tracking.run.abovegroundStatus, "not_started");
    assert.notEqual(completed.body.tracking.package, undefined);
    assert.equal(completed.body.tracking.agentRunTree.childRuns.length > 0, true);
    assert.equal(completed.body.tracking.agentRunTree.parentSyntheses.length > 0, true);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "direction_handoff.completed"), true);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "underground.exploration_planned"), true);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assert.equal(completed.body.transcript.events.some((event: { type: string }) => event.type === "final.result"), true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop deep mode real AI contract failure surfaces a stopped diagnostic", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-contract-failure-"));
  const secret = "sk-desktop-contract-failure-secret";
  let modelCallCount = 0;
  const providerFetch: PanelProviderFetch = async () => {
    modelCallCount += 1;
    return createInvalidOpenAiResponse("desktop-contract-failure-model");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-contract-failure-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: "分析当前仓库并输出报告，Use a real model path with invalid structured output.",
        aiMode: "openai-compatible",
        runMode: "deep",
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const failedCalls = completed.body.transcript.modelCalls.filter((call: { status: string }) => call.status === "failed");
    const failedCall = failedCalls.at(-1);

    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.runMode, "deep");
    assert.equal(completed.body.error, undefined);
    assert.equal(completed.body.canvas.kind, "underground_deep_canvas");
    assert.equal(completed.body.canvas.underground.status, "stopped");
    assert.equal(completed.body.canvas.underground.packageRef.validationPassed, false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "model.failed"), true);
    assert.equal(modelCallCount >= 1, true);
    assert.equal(failedCall?.failureKind, "output_validation");
    assert.equal(typeof failedCall?.outputContractId, "string");
    assert.equal(completed.text.includes(secret), false);
    assert.equal(completed.text.includes("bad raw output"), false);
    assert.equal(completed.text.includes("hidden_reasoning"), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop deep mode internal decision stream is not rendered as assistant answer on contract failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-internal-stream-filter-"));
  const secret = "sk-desktop-internal-stream-filter-secret";
  const leakedInternalDecision = "我是内部决策流，不应该进入主对话。";
  let modelCallCount = 0;
  const providerFetch: PanelProviderFetch = async () => {
    modelCallCount += 1;
    return createOpenAiStreamTextResponse("desktop-internal-stream-filter-model", [
      leakedInternalDecision.slice(0, 8),
      leakedInternalDecision.slice(8),
    ]);
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-internal-stream-filter-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "分析当前仓库并输出报告。", aiMode: "openai-compatible", runMode: "deep" },
    });
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const liveAssistantDeltas = stream.events.filter(
      (event) => event.type === "model.output.delta" && event.agentLabel === "助手"
    );

    assert.equal(modelCallCount >= 1, true);
    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.canvas.kind, "underground_deep_canvas");
    assert.equal(completed.body.canvas.underground.status, "stopped");
    assert.equal(liveAssistantDeltas.length, 0);
    assert.equal(stream.text.includes(leakedInternalDecision), false);
    assert.equal(completed.text.includes(leakedInternalDecision), false);
    assert.equal(stream.text.includes(secret), false);
    assert.equal(completed.text.includes(secret), false);
    assertSafePanelJsonText(`${stream.text}\n${completed.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel async fake AI transcript includes agent work notes and redacts model internals", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-transcript-"));
  const secret = "sk-transcript-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "unused-fake-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/underground/runs", {
      method: "POST",
      body: {
        goal: "需要风险、安全、资产、证据、约束和反驳，并且权限未知待确认。",
        aiMode: "fake",
      },
    });
    const completed = await waitForRun(server.url, start.body.runId, (body) => body.status === "completed");
    const transcriptText = JSON.stringify(completed.body.transcript);
    const agentIds = completed.body.transcript.workNotes.map((note: { agentId: string }) => note.agentId);

    assert.equal(agentIds.includes("underground-rootlet-agents"), true);
    assert.equal(agentIds.includes("intelligence-channel"), true);
    assert.equal(agentIds.includes("underground-convergence-judge"), true);
    assert.equal(agentIds.includes("underground-handoff-steward"), true);
    assert.equal(completed.body.transcript.modelCalls.length > 0, true);
    assert.equal(
      completed.body.transcript.modelCalls.some((call: { visibleOutput?: unknown }) => call.visibleOutput !== undefined),
      true
    );
    assert.equal(transcriptText.includes(secret), false);
    assert.equal(transcriptText.includes("sanitizedMessages"), false);
    assert.equal(transcriptText.includes("Return JSON only"), false);
    assertSafePanelJsonText(transcriptText);
    assert.equal(transcriptText.includes("Fake option candidate advice"), true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel openai-compatible visible output truncates long fields and excludes raw provider response", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-visible-output-"));
  const secret = "sk-visible-output-secret";
  const longSummary = "Long visible model output ".repeat(20);
  const providerFetch: PanelProviderFetch = async () =>
    createStubOpenAiResponse("visible-output-model", { summary: longSummary });
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "visible-output-model",
        apiKey: secret,
      },
    });

    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a visible output helper.", aiMode: "openai-compatible" },
    });
    const visibleOutput = run.body.transcript.modelCalls.find(
      (call: { visibleOutput?: unknown }) => call.visibleOutput !== undefined
    )?.visibleOutput;
    const summaryField = visibleOutput?.items[0].fields.find((field: { name: string }) => field.name === "summary");

    assert.equal(run.status, 200);
    assert.equal(visibleOutput?.validationStatus, "passed");
    assert.equal(summaryField?.truncated, true);
    assert.equal(summaryField.value.length <= 180, true);
    assert.equal(run.text.includes(longSummary), false);
    assert.equal(run.text.includes("choices"), false);
    assertSafePanelJsonText(run.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel validation failed model output falls back without approved visible output", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-invalid-output-"));
  const secret = "sk-invalid-output-secret";
  const providerFetch: PanelProviderFetch = async () => createInvalidOpenAiResponse("invalid-output-model");
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "invalid-output-model",
        apiKey: secret,
      },
    });

    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a helper with invalid provider output.", aiMode: "openai-compatible" },
    });
    const failedCall = run.body.transcript.modelCalls.find((call: { status: string }) => call.status === "failed");

    assert.equal(run.status, 200);
    assert.equal(failedCall?.validationStatus, "failed");
    assert.equal(failedCall?.failureKind, "output_validation");
    assert.equal(failedCall?.visibleOutput, undefined);
    assert.equal(run.body.summary.ai.fallbackCount > 0, true);
    assert.equal(run.text.includes("bad raw output"), false);
    assert.equal(run.text.includes("hidden_reasoning"), false);
    assert.equal(run.text.includes("provider raw response marker"), false);
    assertSafePanelJsonText(run.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel openai-compatible missing key fails before provider fetch", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-missing-key-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { model: "panel-model" },
    });
    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "openai-compatible" },
    });

    assert.equal(run.status, 400);
    assert.equal(fetchCalls, 0);
    assert.equal(run.body.ok, false);
    assert.equal(run.body.error.code, "missing_api_key");
    assert.equal(run.body.error.message, "模型密钥未配置。");
    assert.equal(run.body.summary.ai.status, "configuration_failed");
    assert.equal(run.body.summary.ai.eventCounts.requested, 0);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel openai-compatible run uses configured ToolCenter search from tools route", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-configured-tools-run-"));
  const modelSecret = "sk-configured-tools-secret";
  const tavilySecret = "tvly-configured-tools-secret";
  let modelFetchCalls = 0;
  let tavilyFetchCalls = 0;
  const providerFetch: PanelProviderFetch = async (url, init) => {
    if (url === "https://api.tavily.com/search") {
      tavilyFetchCalls += 1;
      const body = JSON.parse(init.body) as { api_key?: string; max_results?: number };
      assert.equal(body.api_key, tavilySecret);
      assert.equal(body.max_results, 1);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: "Configured panel search",
              url: "https://example.test/panel-search",
              content: "Panel configured ToolCenter search snippet.",
            },
          ],
        }),
      };
    }

    modelFetchCalls += 1;
    const body = parseResponsesRequestBody(init.body);
    const isCandidateAggregation = responsesRequestText(body).includes("aggregationRationale");
    if (isCandidateAggregation) {
      return createStubOpenAiAggregationResponse("configured-tools-model");
    }
    const hasToolMessage = hasResponsesToolOutput(body);
    return hasToolMessage || !hasResponsesToolDefinition(body, "search")
      ? createStubOpenAiResponse("configured-tools-model")
      : createOpenAiSearchToolCallResponse();
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "configured-tools-model",
        apiKey: modelSecret,
      },
    });
    await requestJson(server.url, "/api/config/tools/web-search", {
      method: "POST",
      body: {
        provider: "tavily",
        apiKey: tavilySecret,
        maxResults: 1,
      },
    });

    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "openai-compatible" },
    });

    assert.equal(run.status, 200);
    assert.equal(modelFetchCalls >= 2, true);
    assert.equal(tavilyFetchCalls, 2);
    assert.equal(run.body.trace.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(JSON.stringify(run.body).includes(modelSecret), false);
    assert.equal(JSON.stringify(run.body).includes(tavilySecret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel openai-compatible missing model does not leak configured API key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-missing-model-"));
  const secret = "sk-model-missing-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret },
    });
    const run = await requestJson(server.url, "/api/underground/run", {
      method: "POST",
      body: { goal: "Build a small deterministic helper.", aiMode: "openai-compatible" },
    });

    assert.equal(run.status, 400);
    assert.equal(run.text.includes(secret), false);
    assert.equal(run.body.error.code, "missing_model_name");
    assert.equal(run.body.error.message, "模型未配置。");
    assert.equal(run.body.summary.ai.eventCounts.requested, 0);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});
