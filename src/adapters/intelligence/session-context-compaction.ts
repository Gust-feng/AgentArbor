import {
  DEFAULT_COMPACTION_SETTINGS,
  compact,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  shouldCompact,
  type AgentMessage,
  type CompactionSettings,
  type Session,
} from "@earendil-works/pi-agent-core";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { AgentSessionEntryRef } from "../../app/model-runtime/agent-session.js";

export type SessionContextCompactionResult =
  | { readonly status: "unchanged" }
  | {
      readonly status: "compacted";
      readonly compactedContextMessages: readonly AgentMessage[];
      readonly compactionEntryRef: AgentSessionEntryRef;
      readonly tokensBefore: number;
    }
  | {
      readonly status: "failed";
      readonly code: "context_compaction_failed" | "context_overflow";
      readonly error: string;
    };

export type SessionContextCompactionInput = {
  readonly agentSession: Session;
  readonly activeContextMessages: readonly AgentMessage[];
  readonly modelRegistry: Models;
  readonly selectedModel: Model<Api>;
  readonly abortSignal: AbortSignal;
  readonly compactionSettings?: CompactionSettings;
  readonly compactionInstructions?: string;
};

/** Compacts the active Session branch and returns the exact context for the next provider request. */
export async function compactSessionContextIfNeeded(
  input: SessionContextCompactionInput,
): Promise<SessionContextCompactionResult> {
  const compactionSettings = input.compactionSettings ?? DEFAULT_COMPACTION_SETTINGS;
  if (!compactionSettings.enabled) return { status: "unchanged" };
  const contextTokens = estimateContextTokens([...input.activeContextMessages]).tokens;
  if (!shouldCompact(contextTokens, input.selectedModel.contextWindow, compactionSettings)) {
    return { status: "unchanged" };
  }
  const prepared = prepareCompaction(await input.agentSession.getBranch(), compactionSettings);
  if (!prepared.ok) {
    return { status: "failed", code: "context_compaction_failed", error: prepared.error.message };
  }
  if (prepared.value === undefined) {
    return {
      status: "failed",
      code: "context_overflow",
      error: "The active session context exceeds the model window but has no safe compaction cut point.",
    };
  }
  const compacted = await compact(
    prepared.value,
    input.modelRegistry,
    input.selectedModel,
    input.compactionInstructions,
    input.abortSignal,
  );
  if (!compacted.ok) {
    return { status: "failed", code: "context_compaction_failed", error: compacted.error.message };
  }
  const compactionEntryId = await input.agentSession.appendCompaction(
    compacted.value.summary,
    compacted.value.firstKeptEntryId,
    compacted.value.tokensBefore,
    compacted.value.details,
  );
  const compactedContextMessages = (await input.agentSession.buildContext()).messages;
  // A retained assistant message still carries usage for its pre-compaction
  // request. That usage is no longer a valid size for the rebuilt context.
  const compactedContextTokens = compactedContextMessages.reduce(
    (total, message) => total + estimateTokens(message),
    0,
  );
  if (shouldCompact(
    compactedContextTokens,
    input.selectedModel.contextWindow,
    compactionSettings,
  )) {
    return {
      status: "failed",
      code: "context_overflow",
      error: "The active session context still exceeds the safe model window after compaction.",
    };
  }
  const sessionId = (await input.agentSession.getMetadata()).id;
  return {
    status: "compacted",
    compactedContextMessages,
    compactionEntryRef: { sessionId, entryId: compactionEntryId },
    tokensBefore: compacted.value.tokensBefore,
  };
}
