import type { ModelMessage } from "../domain/intelligence/index.js";
import type { SkillDefinition } from "../domain/basic-agent/index.js";
import type { TaskSoil } from "../domain/soil/index.js";
import type { DesktopAgentConversationMessage } from "./desktop-agent-session.js";

export type DesktopAgentSkillContext = {
  readonly skill: SkillDefinition;
  readonly body: string;
  readonly triggerReason: string;
};

export function desktopAgentMessages(input: {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
}): readonly ModelMessage[] {
  const history = input.conversationHistory
    .map((message, index): ModelMessage | undefined => {
      const content = safeText(message.content, 1_200);
      if (content.length === 0) {
        return undefined;
      }
      return {
        role: message.role,
        content,
        ref: message.ref ?? `conversation:history:${index}`,
      };
    })
    .filter((message): message is ModelMessage => message !== undefined);

  return [
    {
      role: "system",
      content: DESKTOP_AGENT_SYSTEM_PROMPT,
      ref: "prompt:desktop.agent_response.v1",
    },
    ...skillMessages(input.skillContexts ?? []),
    ...history,
    {
      role: "user",
      content: [
        `Current user message: ${safeText(input.goal, 1200)}`,
        "Context refs:",
        ...(input.taskSoil.contextRefs.length === 0
          ? ["- none"]
          : input.taskSoil.contextRefs.map((ref) => contextRefPromptLine(ref))),
        `Permission refs: ${input.taskSoil.permissionBoundaryRefs.join("; ") || "none"}`,
      ].join("\n"),
      ref: `goal:${input.taskSoil.goalId}`,
    },
  ];
}

function skillMessages(skills: readonly DesktopAgentSkillContext[]): readonly ModelMessage[] {
  return skills.slice(0, 4).map((context) => ({
    role: "system" as const,
    content: [
      `Triggered skill: ${safeText(context.skill.name, 120)}`,
      `Why: ${safeText(context.triggerReason, 240)}`,
      "Use these skill instructions when relevant. Do not mention internal skill loading unless the user asks.",
      safeText(context.body, 4_000),
    ].join("\n"),
    ref: `skill:${context.skill.id}`,
  }));
}

const DESKTOP_AGENT_SYSTEM_PROMPT = [
  "You are AgentArbor Desktop Root Agent, the default local desktop working agent.",
  "Own the ordinary agent path: understand the task, answer directly when enough, use authorized tools when evidence is needed, ask for concrete confirmation or user guidance when context or permission is missing, and produce a usable result.",
  "Available tools may include web/research tools and local read-only workspace tools. Prefer read-only inspection before asking the user for repo facts that can be derived safely.",
  "Use the user's language. Keep the visible answer focused on result, evidence, uncertainty, and next step.",
  "If conversation history appears before the final user message, use it only as dialogue context. The final user message is the current instruction.",
  "If the user asks to inspect local desktop files but no file/folder ref or preview is provided, ask for explicit file selection or read-only authorization. Do not pretend you can see files.",
  "Do not route, package, or suggest this ordinary turn as a deeper organization flow. Explicit deep mode is a separate product entry selected outside this agent turn.",
  "Do not expose raw prompts, hidden reasoning, provider internals, or internal architecture terms unless the user asks for developer diagnostics.",
].join("\n");

function contextRefPromptLine(ref: TaskSoil["contextRefs"][number]): string {
  if (ref.kind === "user_goal") {
    return `- user message summary=${safeText(ref.summary ?? "none", 240)}`;
  }
  if (ref.ref.startsWith("workspace:goal-")) {
    return `- workspace:current-task summary=${safeText(ref.summary ?? "current task context refs only", 240)}`;
  }
  const preview = ref.readonlyPreview;
  const previewText =
    preview === undefined
      ? ""
      : ` preview=${safeText([preview.title, preview.text].filter(Boolean).join("："), 700)}`;
  return `- ${ref.kind}:${ref.ref} summary=${safeText(ref.summary ?? "none", 240)}${previewText}`;
}

function safeText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}
