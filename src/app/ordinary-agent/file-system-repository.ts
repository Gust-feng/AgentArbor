import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { persistedModelProtocolExtensions } from "../../domain/intelligence/index.js";
import { toolCallFactId } from "../../domain/tools/index.js";
import {
  ORDINARY_RUN_SCHEMA_VERSION,
  OrdinaryFeatureError,
  type OrdinaryRunRepository,
  type OrdinaryRunSnapshotDocument,
  type OrdinaryRunState,
  type OrdinaryRunSummary,
} from "./contracts.js";

const MANIFEST_SCHEMA_VERSION = "ordinary-run-manifest/v1" as const;

export class OrdinaryRunSnapshotIncompatibleError extends Error {
  readonly code = "ordinary_run_snapshot_incompatible" as const;

  constructor(readonly runId: string, reason: string) {
    super(`Ordinary run snapshot ${runId} is incompatible with ${ORDINARY_RUN_SCHEMA_VERSION}: ${reason}`);
    this.name = "OrdinaryRunSnapshotIncompatibleError";
  }
}

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(), z.string(), z.number().finite(), z.boolean(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]));
const confirmationSchema = z.object({
  confirmationId: z.string().min(1), runId: z.string().min(1), conversationId: z.string().optional(),
  title: z.string(), actionSummary: z.string(), consequence: z.string().optional(),
  affectedResources: z.array(z.string()), riskLevel: z.enum(["low", "medium", "high"]),
  resumeAvailability: z.enum(["live", "lost_after_restart"]).optional(), requestedAt: z.string().min(1),
  expiresAt: z.string().optional(), sourceRefs: z.array(z.string()),
}).strict();
const confirmationDecisionSchema = z.object({
  confirmationId: z.string().min(1), runId: z.string().min(1),
  decision: z.enum(["approve_once", "deny", "guidance"]), decidedAt: z.string().min(1),
  guidance: z.string().optional(),
}).strict();
const usageSchema = z.object({
  inputTokens: z.number().finite().nonnegative().optional(),
  outputTokens: z.number().finite().nonnegative().optional(),
  totalTokens: z.number().finite().nonnegative().optional(),
  cachedInputTokens: z.number().finite().nonnegative().optional(),
  cacheWriteInputTokens: z.number().finite().nonnegative().optional(),
  uncachedInputTokens: z.number().finite().nonnegative().optional(),
  reasoningOutputTokens: z.number().finite().nonnegative().optional(),
  estimatedCostUsd: z.number().finite().nonnegative().optional(),
  latencyMs: z.number().finite().nonnegative().optional(),
  firstTokenLatencyMs: z.number().finite().nonnegative().optional(),
  outputDurationMs: z.number().finite().nonnegative().optional(),
  outputTokensPerSecond: z.number().finite().nonnegative().optional(),
}).strict();
const toolCallSchema = z.object({
  callId: z.string().min(1), factId: z.string().min(1).optional(), toolName: z.string().min(1), input: jsonValueSchema.optional(),
  output: jsonValueSchema.optional(), status: z.enum(["completed", "failed", "approval_required", "cancelled"]),
  error: z.string().optional(), errorDomain: z.string().optional(), errorFacts: z.record(z.string(), jsonValueSchema).optional(),
  durationMs: z.number().finite().nonnegative(), confirmationRequest: confirmationSchema.optional(),
}).strict();
const modelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]), content: z.string(), ref: z.string().optional(),
  toolCallId: z.string().optional(), toolName: z.string().optional(),
  toolCalls: z.array(z.object({
    callId: z.string().min(1), toolName: z.string().min(1), input: jsonValueSchema.optional(),
  }).strict()).optional(),
  protocolExtensions: z.record(z.string(), jsonValueSchema).optional(),
}).strict().superRefine((message, context) => {
  if (message.protocolExtensions === undefined) return;
  try {
    if (persistedModelProtocolExtensions(message.protocolExtensions) === undefined) {
      context.addIssue({ code: "custom", message: "unknown protocol extensions are not durable" });
    }
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "protocol extension is invalid" });
  }
});
const configSchema = z.object({
  profileId: z.string().min(1), providerKind: z.enum(["openai_compatible", "anthropic", "gemini", "ollama", "local"]),
  protocolKind: z.enum(["openai_responses", "openai_compatible_chat_completions", "anthropic_messages", "gemini_generate_content"]),
  baseUrl: z.string(), defaultAiMode: z.enum(["none", "fake", "openai-compatible", "openai-responses"]),
  secretRef: z.string(), secretConfigured: z.boolean(), updatedAt: z.string().min(1),
}).passthrough();
const capabilitySnapshotSchema = z.object({
  snapshotId: z.string().min(1), createdAt: z.string().min(1), activeModel: configSchema,
  modelCapabilities: z.object({
    contextWindowTokens: z.number().positive(), maxOutputTokens: z.number().positive(), supportsToolCalling: z.boolean(),
    supportsParallelToolCalls: z.boolean(), supportsStructuredOutputs: z.boolean(), supportsStreaming: z.boolean(),
    supportsVisionInput: z.boolean(), supportsReasoningEffort: z.boolean(), preferredApiStyle: z.string(), stability: z.string(),
  }).passthrough(),
  toolCatalog: z.object({
    scope: z.literal("desktop-basic"),
    tools: z.array(z.object({ name: z.string().min(1), description: z.string(), enabled: z.boolean(), availability: z.enum(["available", "unavailable"]) }).passthrough()),
    allowedTools: z.array(z.string()),
  }).passthrough(),
  skillCatalog: z.array(z.object({ id: z.string().min(1), name: z.string(), description: z.string(), enabled: z.boolean() }).passthrough()),
  subAgentCatalog: z.array(z.object({ id: z.string().min(1), name: z.string(), description: z.string(), enabled: z.boolean() }).passthrough()),
  mcpCatalog: z.array(z.object({ serverId: z.string().min(1), enabled: z.boolean(), availability: z.string() }).passthrough()),
  workspace: z.object({ workspaceDirectory: z.string(), updatedAt: z.string().min(1) }).strict(), securitySummary: z.string(), warnings: z.array(z.string()),
}).passthrough();
const birthSchema = z.object({
  instructions: z.string(), aiMode: z.enum(["none", "fake", "openai-compatible", "openai-responses"]), config: configSchema,
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  agentDefinitionRef: z.object({
    agentId: z.string().min(1), agentDisplayName: z.string(), promptRef: z.string().min(1), promptVersion: z.string().min(1),
    outputContractId: z.string().min(1), toolVisibilityProfileId: z.string().min(1), definitionHash: z.string().optional(),
  }).strict(),
  capabilitySnapshot: capabilitySnapshotSchema,
  informationAccess: z.object({
    sourcePreference: z.array(z.string()), web: z.object({
      provider: z.enum(["tavily", "exa", "zai", "metaso", "google", "bing", "model_builtin", "none"]),
      maxResults: z.number().nonnegative(), secretConfigured: z.boolean(), status: z.enum(["ready", "no-provider", "disabled"]), updatedAt: z.string(),
    }).passthrough(), stubs: z.object({
      docs: z.enum(["stub", "readonly_stub"]), packages: z.enum(["stub", "readonly_stub"]),
      github: z.enum(["stub", "readonly_stub"]), run_memory: z.enum(["stub", "readonly_stub"]),
    }).strict(),
  }).passthrough(),
  toolConfirmationPolicy: z.enum(["prompt", "full_access"]),
}).strict();
const statusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued") }).strict(),
  z.object({ kind: z.literal("running") }).strict(),
  z.object({ kind: z.literal("awaiting_approval"), confirmationRequests: z.array(confirmationSchema).min(1), continuationAvailability: z.literal("live_only") }).strict(),
  z.object({ kind: z.literal("completed"), answer: z.string() }).strict(),
  z.object({ kind: z.literal("failed"), error: z.object({ code: z.string().min(1), message: z.string() }).strict() }).strict(),
  z.object({ kind: z.literal("cancelled"), reason: z.string() }).strict(),
  z.object({ kind: z.literal("blocked"), reason: z.object({ code: z.string().min(1), message: z.string() }).strict(), continueBy: z.enum(["new_turn", "retry"]) }).strict(),
]);
const capabilityResolutionSchema = z.object({
  resolutionId: z.string().min(1),
  snapshotId: z.string().min(1),
  runMode: z.literal("agent"),
  agentId: z.string().min(1),
  agentDisplayName: z.string(),
  toolVisibilityProfileId: z.string().min(1),
  capabilityPlan: z.object({
    protocolToolCallCapabilities: z.object({
      protocolKind: z.enum(["openai_responses", "openai_compatible_chat_completions", "anthropic_messages", "gemini_generate_content"]),
      canSendToolDefinitions: z.boolean(),
      canReceiveToolCalls: z.boolean(),
      canRoundTripToolResults: z.boolean(),
    }).strict(),
    modelCapabilities: capabilitySnapshotSchema.shape.modelCapabilities,
    canExposeModelTools: z.boolean(),
    tools: z.object({ canExposeToModel: z.boolean(), allowedTools: z.array(z.string()) }).strict().optional(),
    fileOperations: z.object({
      canReadWorkspace: z.boolean(), canWriteWorkspace: z.boolean(), canDeleteWorkspace: z.boolean(), canExecuteCommands: z.boolean(),
    }).strict().optional(),
    uiDisplay: z.object({
      canShowStreamingOutput: z.boolean(), canShowToolCards: z.boolean(), visibleToolNames: z.array(z.string()),
    }).strict().optional(),
    allowedTools: z.array(z.string()),
    warnings: z.array(z.string()),
  }).strict(),
  allowedTools: z.array(z.string()),
  toolExposures: z.array(z.object({
    name: z.string().min(1), displayName: z.string(), enabled: z.boolean(), modelVisible: z.boolean(),
    scopes: z.array(z.enum(["desktop-basic", "underground", "research", "workspace", "mcp"])),
    availability: z.enum(["available", "unavailable"]), riskLevel: z.enum(["low", "medium", "high"]),
    operationType: z.enum(["read-only", "read-write", "execute", "external-submit"]),
    fileOperation: z.enum(["create", "write", "append", "edit", "delete"]).optional(),
    requiresConfirmation: z.boolean(), confirmationPolicy: z.enum(["prompt", "full_access"]).optional(),
    reasonCode: z.enum([
      "model_tools_unsupported", "tool_disabled", "tool_unavailable", "not_in_run_scope", "permission_denied",
      "profile_hidden", "available_full_access", "available_requires_confirmation", "available",
      "no_executable_tool_runner", "executable_tool_missing", "tool_contract_mismatch",
      "selected_skill_resources_available", "selected_skill_resources_unavailable", "no_enabled_sub_agents",
    ]).optional(),
    reason: z.string(),
  }).strict()),
  enabledSkills: z.array(z.object({
    id: z.string().min(1), name: z.string(), description: z.string(), triggers: z.array(z.string()),
  }).passthrough()),
  mcpDrafts: z.array(z.object({
    draftId: z.string().min(1), source: z.literal("mcp"), label: z.string(),
    availability: z.enum(["configured", "disabled", "unavailable"]), enabled: z.boolean(), reason: z.string(),
  }).strict()),
  warnings: z.array(z.string()),
  createdAt: z.string().min(1),
}).strict();
const eventBase = {
  eventId: z.string().min(1), runId: z.string().min(1), sequence: z.number().int().positive(), recordedAt: z.string().min(1),
};
const eventSchema = z.discriminatedUnion("type", [
  z.object({ ...eventBase, type: z.literal("run.created") }).strict(),
  z.object({ ...eventBase, type: z.literal("run.started") }).strict(),
  z.object({ ...eventBase, type: z.literal("run.approval_requested"), confirmationRequests: z.array(confirmationSchema).min(1), toolCallIds: z.array(z.string().min(1)) }).strict(),
  z.object({ ...eventBase, type: z.literal("run.approval_decided"), decision: confirmationDecisionSchema }).strict(),
  z.object({ ...eventBase, type: z.literal("run.completed"), toolCallIds: z.array(z.string().min(1)) }).strict(),
  z.object({ ...eventBase, type: z.literal("run.failed"), code: z.string().min(1), toolCallIds: z.array(z.string().min(1)) }).strict(),
  z.object({ ...eventBase, type: z.literal("run.cancelled"), reason: z.string(), toolCallIds: z.array(z.string().min(1)) }).strict(),
  z.object({ ...eventBase, type: z.literal("run.blocked"), code: z.string().min(1) }).strict(),
]);
const rawStateSchema = z.object({
  runId: z.string().min(1),
  turn: z.object({
    conversationId: z.string().min(1), lineageId: z.string().min(1), ordinal: z.number().int().positive(),
    userTurnId: z.string().min(1), assistantTurnId: z.string().min(1), predecessorRunId: z.string().min(1).optional(),
  }).strict(),
  input: z.object({
    userMessage: z.string(),
    taskSoil: z.object({
      contextRefs: z.array(z.object({
        attachmentId: z.string().optional(),
        ref: z.string().min(1),
        kind: z.enum(["file", "project", "web", "workspace"]),
        title: z.string().optional(),
        summary: z.string().optional(),
        metadata: z.object({
          byteLength: z.number().int().nonnegative().optional(),
          mimeType: z.string().optional(),
          available: z.boolean().optional(),
          truncated: z.boolean().optional(),
        }).strict().optional(),
        readonlyPreview: z.object({
          title: z.string().optional(),
          text: z.string(),
        }).strict().optional(),
      }).strict()).optional(),
      permissionBoundaryRefs: z.array(z.string()).optional(),
    }).strict().optional(),
  }).strict(),
  birth: birthSchema,
  status: statusSchema,
  canonicalMessages: z.array(modelMessageSchema),
  toolCalls: z.array(toolCallSchema),
  toolResultRecordedAt: z.record(z.string(), z.string().min(1)),
  usage: usageSchema,
  capabilityResolution: capabilityResolutionSchema.optional(),
  timeline: z.array(eventSchema).min(1),
  timestamps: z.object({ createdAt: z.string().min(1), updatedAt: z.string().min(1), terminalAt: z.string().optional() }).strict(),
}).strict().superRefine((state, context) => {
  state.timeline.forEach((event, index) => {
    if (event.runId !== state.runId || event.sequence !== index + 1) {
      context.addIssue({ code: "custom", message: "timeline identity or sequence is invalid", path: ["timeline", index] });
    }
  });
  const terminal = ["completed", "failed", "cancelled", "blocked"].includes(state.status.kind);
  if (terminal !== (state.timestamps.terminalAt !== undefined)) {
    context.addIssue({ code: "custom", message: "terminal status and terminalAt must agree", path: ["timestamps", "terminalAt"] });
  }
  if (state.turn.predecessorRunId === state.runId) {
    context.addIssue({ code: "custom", message: "a run cannot be its own predecessor", path: ["turn", "predecessorRunId"] });
  }
  if ((state.turn.predecessorRunId === undefined) !== (state.turn.ordinal === 1)) {
    context.addIssue({ code: "custom", message: "the first turn must have no predecessor and later turns must have one", path: ["turn"] });
  }
  const expectedLastEvent = {
    queued: "run.created",
    running: ["run.started", "run.approval_decided"],
    awaiting_approval: "run.approval_requested",
    completed: "run.completed",
    failed: "run.failed",
    cancelled: "run.cancelled",
    blocked: "run.blocked",
  }[state.status.kind];
  const lastEventType = state.timeline.at(-1)?.type;
  if (Array.isArray(expectedLastEvent) ? !expectedLastEvent.includes(String(lastEventType)) : lastEventType !== expectedLastEvent) {
    context.addIssue({ code: "custom", message: "status does not match the last timeline event", path: ["timeline"] });
  }
  const eventIds = new Set<string>();
  for (const [index, event] of state.timeline.entries()) {
    if (eventIds.has(event.eventId)) context.addIssue({ code: "custom", message: "event identity is duplicated", path: ["timeline", index, "eventId"] });
    eventIds.add(event.eventId);
  }
  const toolCallIds = new Set<string>();
  for (const [index, call] of state.toolCalls.entries()) {
    const factId = toolCallFactId(call);
    if (toolCallIds.has(factId)) context.addIssue({ code: "custom", message: "tool fact identity is duplicated", path: ["toolCalls", index, "factId"] });
    toolCallIds.add(factId);
    const resultKey = `${factId}:${call.status}`;
    if (call.status !== "approval_required" && state.toolResultRecordedAt[resultKey] === undefined) {
      context.addIssue({ code: "custom", message: "resolved tool result occurrence time is missing", path: ["toolResultRecordedAt", resultKey] });
    }
  }
  validateCanonicalMessageChain(state.canonicalMessages, context);
});
const stateSchema: z.ZodType<OrdinaryRunState> = z.custom<OrdinaryRunState>((value) => rawStateSchema.safeParse(value).success);
const documentSchema: z.ZodType<OrdinaryRunSnapshotDocument> = z.object({
  schemaVersion: z.literal(ORDINARY_RUN_SCHEMA_VERSION), revision: z.number().int().positive(), savedAt: z.string().min(1), state: stateSchema,
}).strict();
const summarySchema = z.object({
  runId: z.string().min(1), conversationId: z.string().min(1), userTurnId: z.string().min(1), assistantTurnId: z.string().min(1),
  status: z.enum(["queued", "running", "awaiting_approval", "completed", "failed", "cancelled", "blocked"]),
  createdAt: z.string().min(1), updatedAt: z.string().min(1),
}).strict();
const manifestSchema = z.object({ schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION), entries: z.array(summarySchema) }).strict();

export function createFileSystemOrdinaryRunRepository(rootDir: string): OrdinaryRunRepository {
  let writeQueue = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    save(state, expectedRevision) {
      return enqueue(async () => {
        const current = await readSnapshot(rootDir, state.runId);
        const actualRevision = current?.revision ?? 0;
        if (actualRevision !== expectedRevision) {
          const cause = new Error(
            `Ordinary run ${state.runId} revision conflict: expected ${expectedRevision}, received ${actualRevision}`,
          );
          throw new OrdinaryFeatureError("ordinary_revision_conflict", cause.message, { cause });
        }
        const document: OrdinaryRunSnapshotDocument = {
          schemaVersion: ORDINARY_RUN_SCHEMA_VERSION,
          revision: actualRevision + 1,
          savedAt: state.timestamps.updatedAt,
          state: cloneJson(state),
        };
        const validation = documentSchema.safeParse(document);
        if (!validation.success) throw new OrdinaryRunSnapshotIncompatibleError(state.runId, z.prettifyError(validation.error));
        await writeJsonAtomically(snapshotPath(rootDir, state.runId), document);
        // The snapshot is the commit. The list manifest is disposable and rebuilt by list().
        await repairManifest(rootDir).catch(() => undefined);
        return cloneJson(document);
      });
    },
    get(runId) { return readSnapshot(rootDir, runId); },
    async list(limit = 50) {
      const summaries = await scanSummaries(rootDir);
      await writeManifest(rootDir, summaries).catch(() => undefined);
      return cloneJson(summaries.slice(0, Math.max(0, Math.floor(limit))));
    },
    delete(runId) {
      return enqueue(async () => {
        await fs.rm(runDirectory(rootDir, runId), { recursive: true, force: true });
        await repairManifest(rootDir).catch(() => undefined);
      });
    },
  };
}

async function readSnapshot(rootDir: string, runId: string): Promise<OrdinaryRunSnapshotDocument | undefined> {
  const raw = await readJson(snapshotPath(rootDir, runId), runId);
  if (raw === undefined) return undefined;
  const result = documentSchema.safeParse(raw);
  if (!result.success || result.data.state.runId !== runId) {
    throw new OrdinaryRunSnapshotIncompatibleError(runId, result.success ? "run identity is invalid" : z.prettifyError(result.error));
  }
  return cloneJson(result.data);
}

async function scanSummaries(rootDir: string): Promise<OrdinaryRunSummary[]> {
  const directory = path.join(rootDir, "runs");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  });
  const documents = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) =>
    readSnapshot(rootDir, decodeURIComponent(entry.name))));
  return documents.filter((document): document is OrdinaryRunSnapshotDocument => document !== undefined)
    .map(summaryFromDocument)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function repairManifest(rootDir: string): Promise<void> { await writeManifest(rootDir, await scanSummaries(rootDir)); }
async function writeManifest(rootDir: string, entries: readonly OrdinaryRunSummary[]): Promise<void> {
  const manifest = { schemaVersion: MANIFEST_SCHEMA_VERSION, entries };
  const result = manifestSchema.safeParse(manifest);
  if (!result.success) throw new OrdinaryRunSnapshotIncompatibleError("manifest", z.prettifyError(result.error));
  await writeJsonAtomically(manifestPath(rootDir), manifest);
}

function summaryFromDocument(document: OrdinaryRunSnapshotDocument): OrdinaryRunSummary {
  return {
    runId: document.state.runId,
    conversationId: document.state.turn.conversationId,
    userTurnId: document.state.turn.userTurnId,
    assistantTurnId: document.state.turn.assistantTurnId,
    status: document.state.status.kind,
    createdAt: document.state.timestamps.createdAt,
    updatedAt: document.state.timestamps.updatedAt,
  };
}

function validateCanonicalMessageChain(
  messages: readonly z.infer<typeof modelMessageSchema>[],
  context: z.RefinementCtx,
): void {
  const pending = new Map<string, string>();
  const completed = new Set<string>();
  for (const [index, message] of messages.entries()) {
    if (message.role === "assistant") {
      if (message.toolCallId !== undefined || message.toolName !== undefined) {
        context.addIssue({ code: "custom", message: "assistant messages cannot be tool results", path: ["canonicalMessages", index] });
      }
      for (const call of message.toolCalls ?? []) {
        if (pending.has(call.callId) || completed.has(call.callId)) {
          context.addIssue({ code: "custom", message: "model tool call identity is duplicated", path: ["canonicalMessages", index, "toolCalls"] });
        }
        pending.set(call.callId, call.toolName);
      }
      continue;
    }
    if (message.role === "tool") {
      const expectedTool = message.toolCallId === undefined ? undefined : pending.get(message.toolCallId);
      if (message.toolCallId === undefined || expectedTool === undefined ||
          (message.toolName !== undefined && message.toolName !== expectedTool) ||
          message.toolCalls !== undefined || message.protocolExtensions !== undefined) {
        context.addIssue({ code: "custom", message: "tool result does not match a pending model tool call", path: ["canonicalMessages", index] });
      } else {
        pending.delete(message.toolCallId);
        completed.add(message.toolCallId);
      }
      continue;
    }
    if (message.toolCallId !== undefined || message.toolName !== undefined ||
        message.toolCalls !== undefined || message.protocolExtensions !== undefined) {
      context.addIssue({ code: "custom", message: "system/user messages contain tool-only fields", path: ["canonicalMessages", index] });
    }
  }
  if (pending.size > 0) context.addIssue({ code: "custom", message: "canonical messages contain unresolved model tool calls", path: ["canonicalMessages"] });
}

async function readJson(filePath: string, runId: string): Promise<unknown | undefined> {
  const content = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (content === undefined) return undefined;
  try { return JSON.parse(content) as unknown; }
  catch { throw new OrdinaryRunSnapshotIncompatibleError(runId, "stored JSON is invalid"); }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  const tempDirectory = path.join(directory, ".tmp");
  const tempPath = path.join(tempDirectory, `${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await fs.mkdir(tempDirectory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { await renameWithRetry(tempPath, filePath); }
  catch (error) { await fs.rm(tempPath, { force: true }).catch(() => undefined); throw error; }
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try { await fs.rename(source, target); return; }
    catch (error) {
      if (attempt === 6 || !isTransientRenameError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}

function isTransientRenameError(error: unknown): boolean { return isNodeError(error, "EPERM") || isNodeError(error, "EACCES") || isNodeError(error, "EBUSY"); }
function snapshotPath(rootDir: string, runId: string): string { return path.join(runDirectory(rootDir, runId), "snapshot.json"); }
function runDirectory(rootDir: string, runId: string): string { return path.join(rootDir, "runs", encodeURIComponent(runId)); }
function manifestPath(rootDir: string): string { return path.join(rootDir, "manifest.json"); }
function isNodeError(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { readonly code?: unknown }).code === code; }
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
