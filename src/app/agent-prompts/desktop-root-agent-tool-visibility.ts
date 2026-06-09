import type { AgentToolVisibilityProfile } from "./contracts.js";

export const DESKTOP_ROOT_AGENT_TOOL_VISIBILITY: AgentToolVisibilityProfile = {
  profileId: "desktop-root-agent:ordinary-visible-tools:v2",
  runMode: "agent",
  visibleToolScopes: ["desktop-basic", "workspace", "research", "mcp"],
  hiddenToolScopes: ["underground"],
};
