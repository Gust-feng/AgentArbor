import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PathMemoryCaptureInput, PathMemoryCaptureResult } from "../../path-memory/contracts.js";
import { closePanelServer, createPanelRequestHandler } from "../request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "../runtime.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

function captureInputFixture(runId: string): PathMemoryCaptureInput {
  return {
    source: {
      feature: "ordinary",
      runId,
      sourceRevision: 2,
      conversationId: `conversation-${runId}`,
      userTurnId: `${runId}-user`,
      assistantTurnId: `${runId}-assistant`,
      runCreatedAt: "2026-07-26T09:00:00.000Z",
      terminalAt: "2026-07-26T09:00:04.000Z",
    },
    scope: { workspaceRoot: "C:/workspace/demo", workspaceSelection: "default" },
    goal: { userRequest: "检查构建", taskContextRefs: [] },
    path: {
      executionStarted: true,
      toolSteps: [{
        ordinal: 1,
        toolFactId: `${runId}-tool-1`,
        toolName: "run_command",
        status: "completed",
        durationMs: 40,
        resultRef: `ordinary-run:${runId}#tool:${runId}-tool-1`,
      }],
    },
    outcome: { terminalStatus: "completed", answerRef: `ordinary-run:${runId}#answer` },
    verification: { status: "not_recorded", evidenceRefs: [] },
    evidenceRefs: [`ordinary-run:${runId}`],
  };
}

function capturedMemoryId(result: PathMemoryCaptureResult): string {
  assert.notEqual(result.status, "suppressed");
  return result.status === "suppressed" ? result.memoryId : result.memory.id;
}

function candidateBody(sourcePathMemoryIds: readonly string[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourcePathMemoryIds,
    title: "Build check workflow",
    statement: "Run the build before answering build questions",
    appliesWhen: ["user asks about build status"],
    confidence: "medium",
    ...overrides,
  };
}

async function startExperienceCandidateTestServer(directory: string): Promise<{
  readonly baseUrl: string;
  readonly runtime: PanelRuntime;
  readonly httpServer: Server;
}> {
  const runtime = createPanelRuntime({ configDirectory: directory });
  const httpServer = createServer(createPanelRequestHandler(runtime));
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Panel test server did not expose a TCP port");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, runtime, httpServer };
}

test("ExperienceCandidate API supports the full governance lifecycle with immutable history", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-experience-candidate-api-lifecycle-"));
  const { baseUrl, runtime, httpServer } = await startExperienceCandidateTestServer(directory);
  try {
    const memory = await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-lifecycle"));
    const sourceId = capturedMemoryId(memory);

    const proposed = await requestJson(baseUrl, "/api/experience-candidates", {
      method: "POST",
      body: candidateBody([sourceId]),
    });
    assert.equal(proposed.status, 201);
    assert.equal(proposed.body.ok, true);
    const candidateId = proposed.body.candidate.candidateId as string;
    assert.match(candidateId, /^experience-candidate:/);
    assert.equal(proposed.body.candidate.revision, 1);
    assert.deepEqual(proposed.body.candidate.governance, { status: "proposed" });
    assert.deepEqual(proposed.body.candidate.notApplicableWhen, []);
    const encodedId = encodeURIComponent(candidateId);

    const fetched = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}`);
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.body.candidate, proposed.body.candidate);
    assert.equal(fetched.body.revisions, 1);

    const revised = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/revisions`, {
      method: "POST",
      body: candidateBody([sourceId], {
        title: "Refined build workflow",
        notApplicableWhen: ["documentation-only tasks"],
        confidence: "high",
      }),
    });
    assert.equal(revised.status, 200);
    assert.equal(revised.body.candidate.revision, 2);
    assert.equal(revised.body.candidate.title, "Refined build workflow");
    assert.deepEqual(revised.body.candidate.origin, { kind: "revised", fromRevision: 1 });
    assert.deepEqual(revised.body.candidate.governance, { status: "proposed" });

    const accepted = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/decision`, {
      method: "POST",
      body: { decision: "accept", reason: "verified twice" },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.candidate.revision, 3);
    assert.equal(accepted.body.candidate.governance.status, "accepted");
    assert.equal(accepted.body.candidate.governance.reason, "verified twice");
    assert.equal(typeof accepted.body.candidate.governance.decidedAt, "string");
    assert.deepEqual(accepted.body.candidate.origin, { kind: "decision", fromRevision: 2 });
    // Decision keeps head content identical.
    assert.equal(accepted.body.candidate.title, "Refined build workflow");

    const retired = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/decision`, {
      method: "POST",
      body: { decision: "retire" },
    });
    assert.equal(retired.status, 200);
    assert.equal(retired.body.candidate.revision, 4);
    assert.equal(retired.body.candidate.governance.status, "retired");

    const history = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/revisions`);
    assert.equal(history.status, 200);
    assert.deepEqual(
      history.body.revisions.map((record: { revision: number }) => record.revision),
      [1, 2, 3, 4],
    );
    // Full origin chain stays traceable across the lifecycle.
    assert.deepEqual(
      history.body.revisions.map((record: { origin: unknown }) => record.origin),
      [
        { kind: "proposed" },
        { kind: "revised", fromRevision: 1 },
        { kind: "decision", fromRevision: 2 },
        { kind: "decision", fromRevision: 3 },
      ],
    );
    assert.deepEqual(
      history.body.revisions.map((record: { governance: { status: string } }) => record.governance.status),
      ["proposed", "proposed", "accepted", "retired"],
    );

    const head = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}`);
    assert.equal(head.body.candidate.revision, 4);
    assert.equal(head.body.revisions, 4);
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("ExperienceCandidate API rejects missing sources, illegal transitions and bad input", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-experience-candidate-api-errors-"));
  const { baseUrl, runtime, httpServer } = await startExperienceCandidateTestServer(directory);
  try {
    const missingSource = await requestJson(baseUrl, "/api/experience-candidates", {
      method: "POST",
      body: candidateBody(["path-memory:ordinary:never-existed"]),
    });
    assert.equal(missingSource.status, 422);
    assert.equal(missingSource.body.error.code, "experience_candidate_source_not_found");
    assert.match(missingSource.body.error.message, /path-memory:ordinary:never-existed/);

    const invalidBody = await requestJson(baseUrl, "/api/experience-candidates", {
      method: "POST",
      body: { title: "no sources" },
    });
    assert.equal(invalidBody.status, 400);
    assert.equal(invalidBody.body.error.code, "invalid_experience_candidate_input");

    const memory = await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-errors"));
    const proposed = await requestJson(baseUrl, "/api/experience-candidates", {
      method: "POST",
      body: candidateBody([capturedMemoryId(memory)]),
    });
    const encodedId = encodeURIComponent(proposed.body.candidate.candidateId as string);

    const rejected = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/decision`, {
      method: "POST",
      body: { decision: "reject", reason: "not reusable" },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.candidate.governance.status, "rejected");

    // Retiring a rejected candidate is an illegal transition.
    const retireRejected = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/decision`, {
      method: "POST",
      body: { decision: "retire" },
    });
    assert.equal(retireRejected.status, 409);
    assert.equal(retireRejected.body.error.code, "experience_candidate_invalid_transition");

    const badDecision = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/decision`, {
      method: "POST",
      body: { decision: "promote" },
    });
    assert.equal(badDecision.status, 400);
    assert.equal(badDecision.body.error.code, "invalid_experience_candidate_decision");

    const unknownCandidate = await requestJson(
      baseUrl,
      `/api/experience-candidates/${encodeURIComponent("experience-candidate:missing")}/decision`,
      { method: "POST", body: { decision: "accept" } },
    );
    assert.equal(unknownCandidate.status, 404);
    assert.equal(unknownCandidate.body.error.code, "experience_candidate_not_found");

    const unknownGet = await requestJson(
      baseUrl,
      `/api/experience-candidates/${encodeURIComponent("experience-candidate:missing")}`,
    );
    assert.equal(unknownGet.status, 404);
    assert.equal(unknownGet.body.error.code, "experience_candidate_not_found");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("ExperienceCandidate list endpoint filters heads by status, source and limit", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-experience-candidate-api-list-"));
  const { baseUrl, runtime, httpServer } = await startExperienceCandidateTestServer(directory);
  try {
    const firstMemory = await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-list-a"));
    const secondMemory = await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-list-b"));

    const first = await requestJson(baseUrl, "/api/experience-candidates", {
      method: "POST",
      body: candidateBody([capturedMemoryId(firstMemory)], { title: "First" }),
    });
    const second = await requestJson(baseUrl, "/api/experience-candidates", {
      method: "POST",
      body: candidateBody([capturedMemoryId(secondMemory)], { title: "Second" }),
    });
    await requestJson(
      baseUrl,
      `/api/experience-candidates/${encodeURIComponent(second.body.candidate.candidateId as string)}/decision`,
      { method: "POST", body: { decision: "accept" } },
    );

    const all = await requestJson(baseUrl, "/api/experience-candidates");
    assert.equal(all.status, 200);
    assert.equal(all.body.candidates.length, 2);

    const proposedOnly = await requestJson(baseUrl, "/api/experience-candidates?status=proposed");
    assert.deepEqual(
      proposedOnly.body.candidates.map((record: { candidateId: string }) => record.candidateId),
      [first.body.candidate.candidateId],
    );

    const acceptedOnly = await requestJson(baseUrl, "/api/experience-candidates?status=accepted");
    assert.deepEqual(
      acceptedOnly.body.candidates.map((record: { candidateId: string }) => record.candidateId),
      [second.body.candidate.candidateId],
    );

    const bySource = await requestJson(
      baseUrl,
      `/api/experience-candidates?sourcePathMemoryId=${encodeURIComponent(capturedMemoryId(firstMemory))}`,
    );
    assert.deepEqual(
      bySource.body.candidates.map((record: { candidateId: string }) => record.candidateId),
      [first.body.candidate.candidateId],
    );

    const limited = await requestJson(baseUrl, "/api/experience-candidates?limit=1");
    assert.equal(limited.body.candidates.length, 1);

    const invalidStatus = await requestJson(baseUrl, "/api/experience-candidates?status=exploded");
    assert.equal(invalidStatus.status, 400);
    assert.equal(invalidStatus.body.error.code, "invalid_experience_candidate_status");

    const invalidLimit = await requestJson(baseUrl, "/api/experience-candidates?limit=zero");
    assert.equal(invalidLimit.status, 400);
    assert.equal(invalidLimit.body.error.code, "invalid_experience_candidate_limit");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});

test("ExperienceCandidate decisions still work after the source PathMemory is deleted", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-experience-candidate-api-source-gone-"));
  const { baseUrl, runtime, httpServer } = await startExperienceCandidateTestServer(directory);
  try {
    const memory = await runtime.pathMemoryFeature.commands.capture(captureInputFixture("run-source-gone"));
    const proposed = await requestJson(baseUrl, "/api/experience-candidates", {
      method: "POST",
      body: candidateBody([capturedMemoryId(memory)]),
    });
    const encodedId = encodeURIComponent(proposed.body.candidate.candidateId as string);

    await runtime.pathMemoryFeature.commands.delete(capturedMemoryId(memory));

    // Archival references may be unavailable; decisions never re-validate sources.
    const accepted = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/decision`, {
      method: "POST",
      body: { decision: "accept" },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.candidate.governance.status, "accepted");

    // Revising with the vanished source is rejected because revise re-validates.
    const revised = await requestJson(baseUrl, `/api/experience-candidates/${encodedId}/revisions`, {
      method: "POST",
      body: candidateBody([capturedMemoryId(memory)]),
    });
    assert.equal(revised.status, 422);
    assert.equal(revised.body.error.code, "experience_candidate_source_not_found");
  } finally {
    await closePanelServer(httpServer, runtime);
    await removeTemporaryTree(directory);
  }
});
