import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import { isToolCallEventMessageType } from "../../domain/common.js";
import type {
  RuntimeDatabase,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";

export type RestorableOrdinaryRuntimeSnapshot = RuntimeRunSnapshot & {
  readonly run: RuntimeRunSnapshot["run"] & {
    readonly runKind: "desktop";
    readonly runMode: "agent";
    readonly capabilitySnapshot: NonNullable<RuntimeRunSnapshot["run"]["capabilitySnapshot"]>;
    readonly informationAccess: NonNullable<RuntimeRunSnapshot["run"]["informationAccess"]>;
    readonly agentDefinitionRef: NonNullable<RuntimeRunSnapshot["run"]["agentDefinitionRef"]>;
  };
  readonly basicRun: BasicAgentRun & {
    readonly agentDefinitionRef: NonNullable<BasicAgentRun["agentDefinitionRef"]>;
  };
  readonly basicEvents: readonly RunEvent[];
};

export class OrdinaryRuntimeSnapshotContractError extends Error {
  readonly code = "ordinary_runtime_snapshot_invalid";

  constructor(
    readonly runId: string,
    readonly missingFacts: readonly string[]
  ) {
    super(
      `普通 Agent 持久化记录缺少新契约要求的运行事实（${missingFacts.join("、")}），` +
      "属于开发期失效数据；请清理本地 runtime 记录后重新运行。"
    );
    this.name = "OrdinaryRuntimeSnapshotContractError";
  }
}

/**
 * Reads a persisted run at an Ordinary consumer boundary.
 *
 * Legacy non-Ordinary records remain owned by their feature. Any persisted
 * `agent` record, however, must pass the clean-break contract before a
 * conversation or read-model consumer is allowed to inspect its facts.
 */
export async function readRuntimeSnapshotWithOrdinaryContract(
  runtimeDatabase: Pick<RuntimeDatabase, "getRun"> | undefined,
  runId: string
): Promise<RuntimeRunSnapshot | undefined> {
  const snapshot = await runtimeDatabase?.getRun(runId);
  if (snapshot?.run.runMode === "agent") {
    return requireRestorableOrdinaryRuntimeSnapshot(snapshot);
  }
  return snapshot;
}

/**
 * Freezes the clean-break read boundary for Ordinary snapshots.
 *
 * Legacy Underground snapshots are owned by their compatibility feature and
 * intentionally remain outside this contract. Ordinary readers must trust the
 * records written by the Ordinary feature itself; they must not reconstruct
 * missing events or substitute current Host configuration.
 */
export function requireRestorableOrdinaryRuntimeSnapshot(
  snapshot: RuntimeRunSnapshot
): RestorableOrdinaryRuntimeSnapshot {
  if (snapshot.run.runMode !== "agent") {
    throw new TypeError("Ordinary snapshot validation only accepts runMode=agent.");
  }

  const missingFacts: string[] = [];
  if (snapshot.run.runKind !== "desktop") {
    missingFacts.push("run.runKind");
  }
  if (snapshot.run.capabilitySnapshot == null) {
    missingFacts.push("run.capabilitySnapshot");
  }
  if (snapshot.run.informationAccess == null) {
    missingFacts.push("run.informationAccess");
  }
  if (snapshot.run.agentDefinitionRef == null) {
    missingFacts.push("run.agentDefinitionRef");
  }
  if (snapshot.basicRun == null) {
    missingFacts.push("basicRun");
  } else {
    if (snapshot.basicRun.runId !== snapshot.run.runId) {
      missingFacts.push("basicRun.runId");
    }
    if (snapshot.basicRun.runMode !== snapshot.run.runMode) {
      missingFacts.push("basicRun.runMode");
    }
    if (snapshot.basicRun.agentDefinitionRef == null) {
      missingFacts.push("basicRun.agentDefinitionRef");
    } else if (
      snapshot.run.agentDefinitionRef != null &&
      !sameAgentDefinitionRef(snapshot.basicRun.agentDefinitionRef, snapshot.run.agentDefinitionRef)
    ) {
      missingFacts.push("basicRun.agentDefinitionRefMismatch");
    }
  }

  const persistedEvents = Array.isArray(snapshot.basicEvents)
    ? snapshot.basicEvents.filter((event) => event.visibility !== "debug")
    : [];
  if (persistedEvents.length === 0) {
    missingFacts.push("basicEvents");
  } else {
    if (persistedEvents.some((event) => event.runId !== snapshot.run.runId)) {
      missingFacts.push("basicEvents.runId");
    }
    const terminalType = ordinaryTerminalEventType(snapshot.run.status);
    if (terminalType !== undefined && !persistedEvents.some((event) => event.type === terminalType)) {
      missingFacts.push(`basicEvents.${terminalType}`);
    }
  }

  for (const event of snapshot.events) {
    if (!isOrdinaryToolFactEventType(event.type)) {
      continue;
    }
    if (!isRecord(event.payload)) {
      missingFacts.push(`events.${event.sequence}.payload`);
      continue;
    }
    if (hasLegacyToolPayloadPresentation(event.payload)) {
      missingFacts.push(`events.${event.sequence}.payloadPresentation`);
    }
    const payloadLength = safeJsonLength(event.payload);
    if (payloadLength === undefined) {
      missingFacts.push(`events.${event.sequence}.payloadJson`);
    } else if (payloadLength > 64_000) {
      missingFacts.push(`events.${event.sequence}.payloadBound`);
    }
  }

  for (const call of snapshot.toolCalls) {
    if (hasLegacyToolCallCacheFields(call)) {
      missingFacts.push(`toolCalls.${call.callId}.presentation`);
    }
  }

  if (snapshot.contextLedger?.entries.some((entry) => (entry as { readonly kind?: unknown }).kind === "tool_evidence")) {
    missingFacts.push("contextLedger.toolEvidence");
  }

  if (missingFacts.length > 0) {
    throw new OrdinaryRuntimeSnapshotContractError(snapshot.run.runId, missingFacts);
  }
  return snapshot as RestorableOrdinaryRuntimeSnapshot;
}

const LEGACY_PRESENTATION_KEYS = new Set(["display", "projection", "envelope", "canonicalResult"]);
const LEGACY_TOOL_CALL_CACHE_KEYS = new Set([
  ...LEGACY_PRESENTATION_KEYS,
  "action",
  "path",
  "query",
  "command",
  "exitCode",
  "summary",
  "preview",
  "truncated",
  "input",
  "output",
]);

function isOrdinaryToolFactEventType(type: RuntimeRunSnapshot["events"][number]["type"]): boolean {
  return isToolCallEventMessageType(type);
}

function hasLegacyToolPayloadPresentation(payload: Readonly<Record<string, unknown>>): boolean {
  return hasOwnKey(payload, LEGACY_PRESENTATION_KEYS);
}

function hasLegacyToolCallCacheFields(call: RuntimeRunSnapshot["toolCalls"][number]): boolean {
  return hasOwnKey(call as unknown as Readonly<Record<string, unknown>>, LEGACY_TOOL_CALL_CACHE_KEYS);
}

function hasOwnKey(
  record: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
): boolean {
  return [...keys].some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonLength(value: unknown): number | undefined {
  try {
    return JSON.stringify(value)?.length;
  } catch {
    return undefined;
  }
}

function sameAgentDefinitionRef(
  left: NonNullable<BasicAgentRun["agentDefinitionRef"]>,
  right: NonNullable<RuntimeRunSnapshot["run"]["agentDefinitionRef"]>,
): boolean {
  return left.agentId === right.agentId &&
    left.agentDisplayName === right.agentDisplayName &&
    left.promptRef === right.promptRef &&
    left.promptVersion === right.promptVersion &&
    left.outputContractId === right.outputContractId &&
    left.toolVisibilityProfileId === right.toolVisibilityProfileId &&
    left.definitionHash === right.definitionHash;
}

function ordinaryTerminalEventType(
  status: RuntimeRunSnapshot["run"]["status"]
): "final.result" | "run.failed" | "run.cancelled" | "run.blocked" | undefined {
  if (status === "completed") return "final.result";
  if (status === "failed") return "run.failed";
  if (status === "cancelled") return "run.cancelled";
  if (status === "blocked") return "run.blocked";
  return undefined;
}
