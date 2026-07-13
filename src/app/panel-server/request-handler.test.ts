import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { BasicAgentRunExecutionInput, BasicAgentRunExecutionResult } from "../basic-agent-runtime/index.js";
import type { PanelRunJob } from "./run-jobs.js";
import {
  closePanelServer,
  createPanelRequestHandler,
  PanelShutdownTimeoutError,
} from "./request-handler.js";
import { createPanelRuntime, type PanelRuntime } from "./runtime.js";

test("panel server close aborts active runs and cleans owned background processes", async (t) => {
  const killedPids: number[] = [];
  const runtime = await createTestPanelRuntime(t, {
    processTerminator: {
      killTree(pid) {
        killedPids.push(pid);
        return pid === 32001
          ? { status: "killed", signal: "SIGTERM" }
          : { status: "exited", message: `Process ${pid} was not running.` };
      },
    },
  }, panelRuntimeHooks());
  const retainedOutput = await runtime.toolOutputStore.retain({
    mediaType: "text/plain",
    content: "shutdown-retained-output",
    sourceToolName: "shutdown_fixture",
    sourceCallId: "shutdown-call",
  });
  const abort = new AbortController();
  runtime.abortControllers.set("run-shutdown-a", abort);
  runtime.processRegistry.register({
    processId: "shutdown-owned-background",
    runId: "run-shutdown-a",
    pid: 32001,
    kind: "background",
    owned: true,
    commandLine: "pnpm dev",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
  });
  runtime.processRegistry.register({
    processId: "shutdown-owned-unknown",
    runId: "run-shutdown-b",
    pid: 32002,
    kind: "background",
    owned: true,
    commandLine: "node server.js",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "unknown",
  });
  runtime.processRegistry.register({
    processId: "shutdown-unowned-background",
    runId: "run-shutdown-c",
    pid: 32003,
    kind: "background",
    owned: false,
    commandLine: "external server",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
  });
  runtime.processRegistry.register({
    processId: "shutdown-owned-foreground",
    runId: "run-shutdown-d",
    pid: 32004,
    kind: "foreground",
    owned: true,
    commandLine: "node long-task.js",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
  });
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await listen(server);

  await closePanelServer(server, runtime);

  assert.equal(abort.signal.aborted, true);
  assert.deepEqual(killedPids, [32001, 32002]);
  assert.equal(runtime.processRegistry.get("shutdown-owned-background")?.status, "killed");
  assert.equal(runtime.processRegistry.get("shutdown-owned-unknown")?.status, "exited");
  assert.equal(runtime.processRegistry.get("shutdown-unowned-background")?.status, "running");
  assert.equal(runtime.processRegistry.get("shutdown-owned-foreground")?.status, "running");
  assert.equal(
    await runtime.toolOutputStore.read(retainedOutput.ref, { startChar: 0, maxChars: 30_000 }),
    undefined,
  );
  const cleanupFacts = runtime.processRegistry.listCleanupFacts();
  assert.equal(cleanupFacts[0]?.scope, "registry");
  assert.equal(cleanupFacts[0]?.reason, "shutdown");
  assert.deepEqual(
    cleanupFacts[0]?.attempted.map((attempt) => [attempt.processId, attempt.outcome]),
    [
      ["shutdown-owned-background", "killed"],
      ["shutdown-owned-unknown", "already-exited"],
    ]
  );
});

test("panel server close runs shutdown cleanup before server close callback resolves", async (t) => {
  const killedPids: number[] = [];
  const runtime = await createTestPanelRuntime(t, {
    processTerminator: {
      killTree(pid) {
        killedPids.push(pid);
        return { status: "killed", signal: "SIGTERM" };
      },
    },
  }, panelRuntimeHooks());
  const abort = new AbortController();
  runtime.abortControllers.set("run-shutdown-open-connection", abort);
  runtime.processRegistry.register({
    processId: "shutdown-open-connection-background",
    runId: "run-shutdown-open-connection",
    pid: 33001,
    kind: "background",
    owned: true,
    commandLine: "pnpm dev",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-15T00:00:00.000Z",
    status: "running",
  });

  let closeCallback: ((error?: Error) => void) | undefined;
  let closeAllConnectionsCalls = 0;
  const server = {
    close(callback?: (error?: Error) => void) {
      closeCallback = callback;
      return this as Server;
    },
    closeAllConnections() {
      closeAllConnectionsCalls += 1;
    },
  } as Server;

  const closing = closePanelServer(server, runtime);
  let closeSettled = false;
  closing.then(
    () => {
      closeSettled = true;
    },
    () => {
      closeSettled = true;
    }
  );

  await waitFor(() => runtime.processRegistry.get("shutdown-open-connection-background")?.status === "killed");

  assert.equal(closeSettled, false);
  assert.equal(abort.signal.aborted, true);
  assert.deepEqual(killedPids, [33001]);
  assert.equal(runtime.processRegistry.get("shutdown-open-connection-background")?.status, "killed");
  assert.equal(closeCallback !== undefined, true);

  closeCallback?.();
  await closing;
  assert.equal(closeSettled, true);
  assert.equal(closeAllConnectionsCalls, 1);
});

test("panel server close cancels a scheduled Ordinary run before its deferred execution starts", async (t) => {
  let executionCalls = 0;
  const runtime = await createTestPanelRuntime(t, {}, {
    ...panelRuntimeHooks(),
    async executeRun(): Promise<BasicAgentRunExecutionResult> {
      executionCalls += 1;
      return { completed: true };
    },
  });
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await listen(server);

  const run = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "close before scheduled execution starts",
    aiMode: "fake",
  });
  assert.equal(runtime.abortControllers.has(run.runId), true);
  runtime.runExecutor.schedule(run.runId);
  assert.equal(runtime.activeRunJobs.size, 1);

  await closePanelServer(server, runtime);

  assert.equal(executionCalls, 0);
  assert.equal(runtime.runJobs.get(run.runId)?.status, "cancelled");
  assert.equal(runtime.abortControllers.has(run.runId), false);
  assert.equal(runtime.activeRunJobs.size, 0);
});

test("panel server close quiesces Ordinary queue scheduling before active runs finish", async (t) => {
  let executionStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    executionStarted = resolve;
  });
  let queuedScheduleCalls = 0;
  const runtime = await createTestPanelRuntime(t, {}, {
    ...panelRuntimeHooks(),
    async executeRun(_runtime, execution): Promise<BasicAgentRunExecutionResult> {
      executionStarted();
      if (!execution.abortSignal.aborted) {
        await new Promise<void>((resolve) => {
          execution.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      return { completed: true };
    },
    scheduleNextQueuedConversationRun(): void {
      queuedScheduleCalls += 1;
    },
  });
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await listen(server);

  await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "do not admit queued work during close",
    aiMode: "fake",
  });
  await started;
  await closePanelServer(server, runtime);

  assert.equal(runtime.isQuiescing, true);
  assert.equal(queuedScheduleCalls, 0);
  assert.equal(runtime.activeRunJobs.size, 0);
});

test("panel server close repeatedly aborts controllers that appear while waiting for idle", async (t) => {
  const runtime = await createTestPanelRuntime(t, {}, panelRuntimeHooks());
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await listen(server);

  let lateControllerAborted = false;
  let releaseLateJob!: () => void;
  const lateJob = new Promise<void>((resolve) => {
    releaseLateJob = resolve;
  });
  const safetyTimer = setTimeout(releaseLateJob, 250);
  const introduceLateJob = Promise.resolve().then(() => {
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => {
      lateControllerAborted = true;
      clearTimeout(safetyTimer);
      releaseLateJob();
    }, { once: true });
    runtime.abortControllers.set("run-late-during-close", controller);
    runtime.activeRunJobs.add(lateJob);
    void lateJob.finally(() => {
      runtime.activeRunJobs.delete(lateJob);
      runtime.abortControllers.delete("run-late-during-close");
    });
  });
  runtime.activeRunJobs.add(introduceLateJob);
  void introduceLateJob.finally(() => {
    runtime.activeRunJobs.delete(introduceLateJob);
  });

  await closePanelServer(server, runtime);

  assert.equal(lateControllerAborted, true);
  assert.equal(runtime.abortControllers.size, 0);
  assert.equal(runtime.activeRunJobs.size, 0);
});

test("panel server close releases a pending Ordinary approval continuation exactly once", async (t) => {
  let releaseCalls = 0;
  const runtime = await createTestPanelRuntime(t, {}, {
    ...panelRuntimeHooks(),
    async executeRun(): Promise<BasicAgentRunExecutionResult> {
      return {
        pendingApproval: {
          confirmationId: "confirmation-shutdown",
          async release() {
            releaseCalls += 1;
          },
          async resume() {
            return { completed: true };
          },
          async resumeWithDecision() {
            return { completed: true };
          },
        },
      };
    },
  });
  const run = await runtime.runExecutor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "wait for shutdown approval cleanup",
    aiMode: "fake",
  });
  await Promise.allSettled([...runtime.activeRunJobs]);
  assert.equal(runtime.runJobs.get(run.runId)?.status, "approval_needed");
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await listen(server);

  await closePanelServer(server, runtime);
  await runtime.runExecutor.dispose();

  assert.equal(releaseCalls, 1);
});

test("panel server close rejects a Deep request that passed the Panel gate before shutdown", async (t) => {
  const runtime = await createTestPanelRuntime(t, {}, panelRuntimeHooks());
  const conversationsBefore = await runtime.multiAgentFeature.listConversations(100);
  const server = createServer(createPanelRequestHandler(runtime));
  await listen(server);
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");

  let requestError: unknown;
  let resolveResponse!: (value: { readonly status: number; readonly body: any }) => void;
  let rejectResponse!: (error: unknown) => void;
  const responsePromise = new Promise<{ readonly status: number; readonly body: any }>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const request = httpRequest({
    host: "127.0.0.1",
    port: address.port,
    path: "/api/deep/conversations",
    method: "POST",
    headers: { "content-type": "application/json" },
  }, (response) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      text += chunk;
    });
    response.on("end", () => {
      resolveResponse({
        status: response.statusCode ?? 0,
        body: JSON.parse(text),
      });
    });
  });
  request.on("error", (error) => {
    requestError = error;
    rejectResponse(error);
  });
  request.write('{"goal":"shutdown');
  await waitFor(() => runtime.activeRequestJobs.size === 1);

  const closing = closePanelServer(server, runtime);
  request.end(' race","aiMode":"fake"}');
  const response = await responsePromise;
  await closing;

  assert.equal(requestError, undefined);
  assert.equal(response.status, 503);
  assert.equal(response.body?.error?.code, "deep_feature_quiescing");
  assert.deepEqual(
    (await runtime.multiAgentFeature.listConversations(100)).map((conversation) => conversation.conversationId),
    conversationsBefore.map((conversation) => conversation.conversationId),
  );
});

test("panel server close force-closes a request body that never finishes", async (t) => {
  const runtime = await createTestPanelRuntime(t, {}, panelRuntimeHooks());
  const server = createServer(createPanelRequestHandler(runtime));
  await listen(server);
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");

  let requestClosed!: () => void;
  const requestWasClosed = new Promise<void>((resolve) => {
    requestClosed = resolve;
  });
  const request = httpRequest({
    host: "127.0.0.1",
    port: address.port,
    path: "/api/deep/conversations",
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  request.on("error", () => requestClosed());
  request.on("close", () => requestClosed());
  request.write('{"goal":"never finished');
  await waitFor(() => runtime.activeRequestJobs.size === 1);

  const startedAt = Date.now();
  await closePanelServer(server, runtime);
  await requestWasClosed;

  assert.equal(runtime.activeRequestJobs.size, 0);
  assert.equal(Date.now() - startedAt < 4_000, true);
});

test("panel server close has a hard deadline when runtime cleanup ignores cancellation", async (t) => {
  const runtime = await createTestPanelRuntime(t, {}, panelRuntimeHooks());
  Object.defineProperty(runtime.multiAgentFeature, "dispose", {
    configurable: true,
    value: () => new Promise<void>(() => undefined),
  });
  let closeAllConnectionsCalls = 0;
  const server = {
    close(callback?: (error?: Error) => void) {
      callback?.();
      return this as Server;
    },
    closeAllConnections() {
      closeAllConnectionsCalls += 1;
    },
  } as Server;

  const startedAt = Date.now();
  await assert.rejects(
    closePanelServer(server, runtime, { runtimeCleanupTimeoutMs: 50 }),
    (error: unknown) => error instanceof PanelShutdownTimeoutError
      && error.code === "panel_shutdown_timeout"
      && error.timeoutMs === 50,
  );

  assert.equal(Date.now() - startedAt < 1_000, true);
  assert.equal(closeAllConnectionsCalls, 1);
});

function panelRuntimeHooks() {
  return {
    async executeRun(_runtime: PanelRuntime, _execution: BasicAgentRunExecutionInput): Promise<BasicAgentRunExecutionResult> {
      throw new Error("request-handler cleanup test should not execute a run");
    },
    async failRun(): Promise<void> {
      throw new Error("request-handler cleanup test should not fail a run");
    },
    scheduleNextQueuedConversationRun(_runtime: PanelRuntime, _completedJob: PanelRunJob): void {
      return undefined;
    },
  };
}

async function createTestPanelRuntime(
  t: TestContext,
  options: Parameters<typeof createPanelRuntime>[0],
  hooks: Parameters<typeof createPanelRuntime>[1],
): Promise<PanelRuntime> {
  const configDirectory = await mkdtemp(join(tmpdir(), "agentarbor-request-handler-"));
  const runtime = createPanelRuntime({ ...options, configDirectory }, hooks);
  const disposeMultiAgent = runtime.multiAgentFeature.dispose.bind(runtime.multiAgentFeature);
  t.after(async () => {
    runtime.runExecutor.quiesce();
    for (const controller of runtime.abortControllers.values()) {
      controller.abort();
    }
    await Promise.allSettled([...runtime.activeRunJobs]);
    await disposeMultiAgent();
    await runtime.runExecutor.dispose();
    await runtime.toolOutputStore.clear();
    await Promise.allSettled([...runtime.persistenceChains.values()]);
    await rm(configDirectory, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  return runtime;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  assert.equal(predicate(), true);
}
