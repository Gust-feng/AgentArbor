import type { AgentDefinition } from "./contracts.js";
import { DESKTOP_AGENT_ID } from "./desktop-agent-identity.js";
import { DESKTOP_ROOT_AGENT_OUTPUT_CONTRACT } from "./desktop-root-agent-output-contract.js";
import {
  DESKTOP_ROOT_AGENT_PROMPT,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_1,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V3,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V2,
  DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V1,
} from "./desktop-root-agent-prompt.js";
import { DESKTOP_ROOT_AGENT_TOOL_VISIBILITY } from "./desktop-root-agent-tool-visibility.js";
import { DESKTOP_ROOT_AGENT_TURN_POLICY } from "./desktop-root-agent-turn-policy.js";

export const DESKTOP_ROOT_AGENT: AgentDefinition = {
  agentId: DESKTOP_AGENT_ID,
  displayName: "Desktop Agent",
  prompt: DESKTOP_ROOT_AGENT_PROMPT,
  turnPolicy: DESKTOP_ROOT_AGENT_TURN_POLICY,
  outputContract: DESKTOP_ROOT_AGENT_OUTPUT_CONTRACT,
  toolVisibilityProfile: DESKTOP_ROOT_AGENT_TOOL_VISIBILITY,
};

export const DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_1: AgentDefinition = {
  ...DESKTOP_ROOT_AGENT,
  prompt: DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_1,
};

export const DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V3: AgentDefinition = {
  ...DESKTOP_ROOT_AGENT,
  prompt: DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V3,
};

export const DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V1: AgentDefinition = {
  ...DESKTOP_ROOT_AGENT,
  prompt: DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V1,
};

export const DESKTOP_ROOT_AGENT_LEGACY_PROMPT_VERSION_V2: AgentDefinition = {
  ...DESKTOP_ROOT_AGENT,
  prompt: DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V2,
};
