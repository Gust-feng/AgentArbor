import type { IncomingMessage, ServerResponse } from "node:http";
import type { OrdinaryRunActivity, OrdinaryRunActivityCursor, OrdinaryRunState } from "../ordinary-agent/contracts.js";
import { durableOrdinaryRunReplayFromState } from "../ordinary-agent/ordinary-agent-feature.js";
import { nowIso } from "../../kernel/id.js";
import {
  encodeOrdinaryPanelCursor,
  parseOrdinaryPanelCursor,
  projectOrdinaryPanelActivityBatch,
  projectOrdinaryPanelConversation,
  projectOrdinaryPanelConversationSummary,
  projectOrdinaryPanelRunView,
  type OrdinaryPanelRunView,
} from "./ordinary-agent-panel-projection.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import {
  parseConfirmationDecision,
  parseConversationPinInput,
  parseConversationRenameInput,
  parseConversationRollbackInput,
  parseRunInput,
} from "./request-parsers.js";
import type { PanelRuntime } from "./runtime.js";

export async function handlePanelOrdinaryRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/conversations") {
    writeJson(response, 200, { ok: true, conversations: await listConversations(runtime) });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/conversations") {
    await submitTurn(runtime, request, response);
    return true;
  }

  const messages = /^\/api\/conversations\/([^/]+)\/messages$/u.exec(url.pathname);
  if (request.method === "POST" && messages !== null) {
    await submitTurn(runtime, request, response, decode(messages[1]));
    return true;
  }
  const rename = /^\/api\/conversations\/([^/]+)\/rename$/u.exec(url.pathname);
  if (request.method === "POST" && rename !== null) {
    const conversationId = decode(rename[1]);
    const input = parseConversationRenameInput(await readJsonBody(request));
    const conversation = await runtime.ordinaryAgentFeature.commands.renameConversation(conversationId, input.title);
    writeJson(response, 200, {
      ok: true,
      conversation: await projectConversation(runtime, conversation),
      conversations: await listConversations(runtime),
    });
    return true;
  }
  const pin = /^\/api\/conversations\/([^/]+)\/pin$/u.exec(url.pathname);
  if (request.method === "POST" && pin !== null) {
    const conversationId = decode(pin[1]);
    const input = parseConversationPinInput(await readJsonBody(request));
    const conversation = await runtime.ordinaryAgentFeature.commands.setConversationPinned(conversationId, input.pinned);
    writeJson(response, 200, {
      ok: true,
      conversation: await projectConversation(runtime, conversation),
      conversations: await listConversations(runtime),
    });
    return true;
  }
  const rollback = /^\/api\/conversations\/([^/]+)\/rollback$/u.exec(url.pathname);
  if (request.method === "POST" && rollback !== null) {
    const conversationId = decode(rollback[1]);
    const input = parseConversationRollbackInput(await readJsonBody(request));
    const existing = await runtime.ordinaryAgentFeature.queries.getConversation(conversationId);
    if (existing === undefined) throw new PanelHttpError(404, "conversation_not_found", "未找到对话。");
    const targetTurnId = input.targetTurnId;
    const targetRunId = targetTurnId === undefined
      ? input.targetRunId
      : existing.turns.find((turn) => turn.turnId === targetTurnId)?.runId;
    if (targetTurnId !== undefined && targetRunId === undefined) {
      throw new PanelHttpError(404, "conversation_turn_not_found", "未找到要回退到的对话轮次。");
    }
    const conversation = await runtime.ordinaryAgentFeature.commands.rollbackConversation({
      conversationId,
      targetRunId,
      stepsBack: input.stepsBack,
    });
    writeJson(response, 200, { ok: true, conversation: await projectConversation(runtime, conversation) });
    return true;
  }

  const conversation = /^\/api\/conversations\/([^/]+)$/u.exec(url.pathname);
  if (request.method === "GET" && conversation !== null) {
    const view = await runtime.ordinaryAgentFeature.queries.getConversation(decode(conversation[1]));
    if (view === undefined) throw new PanelHttpError(404, "conversation_not_found", "未找到对话。");
    writeJson(response, 200, { ok: true, conversation: await projectConversation(runtime, view) });
    return true;
  }
  if (request.method === "DELETE" && conversation !== null) {
    const conversationId = decode(conversation[1]);
    await runtime.ordinaryAgentFeature.commands.deleteConversation(conversationId);
    writeJson(response, 200, {
      ok: true,
      deletedConversationId: conversationId,
      conversations: await listConversations(runtime),
    });
    return true;
  }

  const runView = /^\/api\/basic-agent\/runs\/([^/]+)\/view$/u.exec(url.pathname);
  if (request.method === "GET" && runView !== null) {
    const runId = decode(runView[1]);
    const cursor = requestCursor(url, request);
    const view = await projectRunView(runtime, runId, cursor);
    if (view === undefined) throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行视图。");
    writeJson(response, 200, { ok: true, view: view.view });
    return true;
  }
  const stream = /^\/api\/basic-agent\/runs\/([^/]+)\/stream$/u.exec(url.pathname);
  if (request.method === "GET" && stream !== null) {
    await streamRun(runtime, decode(stream[1]), requestCursor(url, request), request, response);
    return true;
  }
  const cancel = /^\/api\/basic-agent\/runs\/([^/]+)\/cancel$/u.exec(url.pathname);
  if (request.method === "POST" && cancel !== null) {
    const state = await runtime.ordinaryAgentFeature.commands.cancel(decode(cancel[1]), "cancelled_by_user");
    writeJson(response, 200, { ok: true, run: projectCommandRun(state).view.run });
    return true;
  }
  const confirmation = /^\/api\/basic-agent\/runs\/([^/]+)\/confirmations\/([^/]+)\/decision$/u.exec(url.pathname);
  if (request.method === "POST" && confirmation !== null) {
    const runId = decode(confirmation[1]);
    const confirmationId = decode(confirmation[2]);
    const decision = parseConfirmationDecision(await readJsonBody(request));
    const state = await runtime.ordinaryAgentFeature.commands.decideApproval({
      runId,
      confirmationId,
      decision: decision.decision,
      guidance: decision.guidance,
      decidedAt: nowIso(),
    });
    writeJson(response, 200, { ok: true, run: projectCommandRun(state).view.run });
    return true;
  }
  return false;
}

async function submitTurn(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  conversationId?: string,
): Promise<void> {
  const runInput = parseRunInput(await readJsonBody(request));
  if (runInput.requestedRunMode !== undefined && runInput.requestedRunMode !== "agent") {
    throw new PanelHttpError(400, "conversation_run_mode_not_supported", "对话入口只支持普通 Agent。");
  }
  const submitted = await runtime.ordinaryAgentFeature.commands.submitTurn({
    conversationId,
    input: { userMessage: runInput.goal, taskSoil: runInput.taskSoilInput },
    birth: await runtime.prepareOrdinaryRunBirth(runInput),
  });
  const run = projectCommandRun(submitted.run);
  writeJson(response, 202, {
    ok: true,
    conversation: projectOrdinaryPanelConversation({
      conversation: submitted.conversation,
      currentRun: run.view,
      workspaceRun: run.state,
    }),
    run: run.view.run,
  });
}

async function listConversations(runtime: PanelRuntime) {
  return Promise.all((await runtime.ordinaryAgentFeature.queries.listConversations(50)).map(async (conversation) => {
    const workspaceRun = conversation.latestRunId === undefined
      ? undefined
      : await runtime.ordinaryAgentFeature.queries.getRun(conversation.latestRunId);
    return projectOrdinaryPanelConversationSummary(conversation, workspaceRun);
  }));
}

async function projectConversation(
  runtime: PanelRuntime,
  conversation: Awaited<ReturnType<PanelRuntime["ordinaryAgentFeature"]["queries"]["getConversation"]>> extends infer T
    ? Exclude<T, undefined>
    : never,
) {
  const runId = conversation.activeRunId ?? conversation.latestRunId;
  const [currentRun, workspaceRun] = await Promise.all([
    runId === undefined ? Promise.resolve(undefined) : projectRunView(runtime, runId),
    conversation.latestRunId === undefined
      ? Promise.resolve(undefined)
      : runtime.ordinaryAgentFeature.queries.getRun(conversation.latestRunId),
  ]);
  return projectOrdinaryPanelConversation({
    conversation,
    currentRun: currentRun?.view,
    workspaceRun,
  });
}

function projectCommandRun(run: OrdinaryRunState): {
  readonly state: OrdinaryRunState;
  readonly view: OrdinaryPanelRunView;
} {
  return {
    state: run,
    view: projectOrdinaryPanelRunView({
      run,
      fullReplay: durableOrdinaryRunReplayFromState(run),
    }),
  };
}

async function projectRunView(
  runtime: PanelRuntime,
  runId: string,
  cursor?: OrdinaryRunActivityCursor,
): Promise<{ readonly state: OrdinaryRunState; readonly view: OrdinaryPanelRunView } | undefined> {
  const [state, fullReplay, incremental] = await Promise.all([
    runtime.ordinaryAgentFeature.queries.getRun(runId),
    runtime.ordinaryAgentFeature.events.replay(runId),
    cursor === undefined ? Promise.resolve(undefined) : runtime.ordinaryAgentFeature.events.replay(runId, cursor),
  ]);
  if (state === undefined || fullReplay === undefined) return undefined;
  return {
    state,
    view: projectOrdinaryPanelRunView({
      run: state,
      fullReplay,
      replay: incremental ?? fullReplay,
    }),
  };
}

async function streamRun(
  runtime: PanelRuntime,
  runId: string,
  cursor: OrdinaryRunActivityCursor | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const initialRun = await runtime.ordinaryAgentFeature.queries.getRun(runId);
  if (initialRun === undefined) throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行事件。");

  const buffered: OrdinaryRunActivity[] = [];
  let initialized = false;
  let closed = false;
  let streamId = "";
  let lastSequence = cursor?.sequence ?? 0;
  let writeChain = Promise.resolve();
  const unsubscribe = runtime.ordinaryAgentFeature.events.subscribe(runId, (activity) => {
    if (!initialized) {
      buffered.push(activity);
      return;
    }
    writeChain = writeChain.then(() => writeActivity(activity)).catch(() => cleanup());
  });
  request.once("close", cleanup);
  request.once("error", cleanup);
  response.once("close", cleanup);
  response.once("error", cleanup);
  try {
    const replay = await runtime.ordinaryAgentFeature.events.replay(runId, cursor);
    if (replay === undefined) {
      cleanup(false);
      throw new PanelHttpError(404, "run_not_found", "未找到基础 Agent 运行事件。");
    }
    streamId = replay.cursor.streamId;
    if (replay.reset) lastSequence = 0;

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(`: AgentArbor ordinary agent stream ${runId}\n\n`);
    if (replay.reset) {
      const resetCursor = encodeOrdinaryPanelCursor({ streamId, sequence: 0 });
      response.write(`id: ${resetCursor}\n`);
      response.write("event: run.stream.reset\n");
      response.write(`data: ${JSON.stringify({ runId, cursor: resetCursor })}\n\n`);
    }
    for (const activity of replay.activities) await writeActivity(activity);
    lastSequence = Math.max(lastSequence, replay.cursor.sequence);
    initialized = true;
    for (const activity of buffered.splice(0)) await writeActivity(activity);
    const current = await runtime.ordinaryAgentFeature.queries.getRun(runId);
    if (current !== undefined && isTerminal(current)) cleanup();
  } catch (error) {
    cleanup(response.headersSent);
    throw error;
  }

  async function writeActivity(activity: OrdinaryRunActivity): Promise<void> {
    if (closed || activity.sequence <= lastSequence) return;
    const state = await runtime.ordinaryAgentFeature.queries.getRun(runId);
    if (state === undefined || closed) return cleanup();
    const batch = projectOrdinaryPanelActivityBatch({
      run: state,
      replay: {
        cursor: { streamId, sequence: activity.sequence },
        reset: false,
        activities: [activity],
      },
    });
    const event = batch.events[0];
    if (event !== undefined) {
      const token = encodeOrdinaryPanelCursor({ streamId, sequence: activity.sequence });
      response.write(`id: ${token}\n`);
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    lastSequence = activity.sequence;
    if (isTerminalTransition(activity)) cleanup();
  }

  function cleanup(endResponse = true): void {
    if (closed) return;
    closed = true;
    unsubscribe();
    request.off("close", cleanup);
    request.off("error", cleanup);
    response.off("close", cleanup);
    response.off("error", cleanup);
    if (endResponse && !response.writableEnded) response.end();
  }
}

function requestCursor(url: URL, request: IncomingMessage): OrdinaryRunActivityCursor | undefined {
  const header = request.headers["last-event-id"];
  const raw = url.searchParams.get("cursor") ?? (Array.isArray(header) ? header[0] : header);
  return parseOrdinaryPanelCursor(raw ?? undefined);
}

function isTerminal(run: OrdinaryRunState): boolean {
  return run.status.kind === "completed" || run.status.kind === "failed" ||
    run.status.kind === "cancelled" || run.status.kind === "blocked";
}

function isTerminalTransition(activity: OrdinaryRunActivity): boolean {
  if (activity.type !== "run.transition") return false;
  return activity.event.type === "run.completed" || activity.event.type === "run.failed" ||
    activity.event.type === "run.cancelled" || activity.event.type === "run.blocked";
}

function decode(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}
