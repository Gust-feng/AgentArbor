import type { ModelCapabilities } from "../../domain/config/index.js";
import type { IntelligenceChannel } from "../../domain/intelligence/index.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent/desktop-agent-contracts.js";
import type { BasicAgentTokenCounter } from "./token-counter.js";

export type BasicAgentConversationSummary = {
  readonly summaryId: string;
  readonly summary: string;
  readonly coveredRefs: readonly string[];
  readonly modelRequestId: string;
  readonly modelResponseId?: string;
};

export type BasicAgentCompactionAgentIdentity = {
  readonly agentId: string;
  readonly displayName: string;
};

export type BasicAgentConversationCompactionResult = {
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly compacted: boolean;
  readonly tokenCount?: number;
  readonly threshold?: number;
  readonly failed?: {
    readonly message: string;
    readonly requestId?: string;
    readonly responseId?: string;
  };
};

export type CompactBasicAgentConversationInput = {
  readonly goal: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly agentIdentity?: BasicAgentCompactionAgentIdentity;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly intelligenceChannel: IntelligenceChannel;
  readonly modelCapabilities?: ModelCapabilities;
  readonly tokenCounter?: BasicAgentTokenCounter;
  readonly thresholdRatio?: number;
  readonly recentPairs?: number;
};
