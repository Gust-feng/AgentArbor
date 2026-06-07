import type { AgentTurnPolicySpec } from "./contracts.js";

export const DESKTOP_AGENT_DEFAULT_MAX_OUTPUT_TOKENS = 3200;

export const DESKTOP_ROOT_AGENT_TURN_POLICY: AgentTurnPolicySpec = {
  allowModel: true,
  fallback: "disabled",
  purpose: "desktop_agent",
  sensitivity: "internal",
  defaultMaxOutputTokens: DESKTOP_AGENT_DEFAULT_MAX_OUTPUT_TOKENS,
};
