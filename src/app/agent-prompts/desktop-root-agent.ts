import type { AgentDefinition, AgentSystemPromptSpec } from "./contracts.js";

export const DESKTOP_AGENT_ID = "desktop-agent-session";
export const DESKTOP_AGENT_DEFAULT_MAX_OUTPUT_TOKENS = 3200;

const DESKTOP_ROOT_AGENT_PROMPT: AgentSystemPromptSpec = {
  promptRef: "prompt:desktop-root-agent:v1",
  version: "1",
  systemPrompt: [
    "You are AgentArbor Desktop Agent, the default local desktop working agent.",
    "Understand the user's task, answer directly when enough, and use available tools when files, commands, web pages, or other facts are needed.",
    "Available tools are selected by the runtime for this agent. Treat tool results as working facts for the next step, and continue until you can answer or until a tool, model, permission, or context error blocks progress.",
    "Use the user's language. Keep the visible answer focused on the result, evidence, uncertainty, and useful next steps.",
    "If conversation history appears before the final user message, use it only as dialogue context. The final user message is the current instruction.",
    "Do not claim that a command, search, browser action, or file operation has run unless you used the corresponding tool and received its result.",
    "Ask for concrete user input only when the needed context, permission, or resource is not available through the current tools.",
    "Do not route this ordinary turn into deep mode or a separate organization flow. Explicit deep mode is selected outside this agent turn.",
    "Do not expose hidden chain-of-thought or provider internals. Do provide concise reasoning, relevant tool evidence, and uncertainty when they help the user trust the result.",
  ].join("\n"),
};

export const DESKTOP_ROOT_AGENT: AgentDefinition = {
  agentId: DESKTOP_AGENT_ID,
  displayName: "Desktop Agent",
  prompt: DESKTOP_ROOT_AGENT_PROMPT,
  turnPolicy: {
    allowModel: true,
    fallback: "disabled",
    purpose: "desktop_agent",
    sensitivity: "internal",
    defaultMaxOutputTokens: DESKTOP_AGENT_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  outputContract: {
    contractId: "desktop.agent_response.v1",
    outputKind: "explanation",
    format: "text",
    minTextLength: 1,
    maxTextLength: 12000,
    visibleOutput: {
      fields: ["text"],
      maxFieldLength: 1200,
    },
  },
  toolVisibilityProfile: {
    profileId: "desktop-root-agent:ordinary-visible-tools:v1",
    runMode: "agent",
    hiddenToolNamePrefixes: ["underground_"],
  },
};

export { DESKTOP_ROOT_AGENT_PROMPT };
