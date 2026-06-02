import type { Screen } from "./components/sidebar";
import type { SkillDefinition } from "./contracts/skills";

export function startSkillChat(
  skill: SkillDefinition,
  setScreen: (screen: Screen) => void,
  setGoal: (goal: string) => void
): void {
  const trigger = skill.triggers?.[0]?.trim();
  setScreen("chat-empty");
  setGoal(trigger === undefined || trigger.length === 0
    ? `按「${skill.name}」处理当前任务：`
    : `按「${skill.name}」处理当前任务：${trigger}`);
}
