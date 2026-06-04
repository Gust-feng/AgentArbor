import type { SkillDefinition } from "../../domain/basic-agent/index.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-prompts.js";
import {
  discoverSkills,
  loadSkillBody,
  selectTriggeredSkills,
  type SkillStateStore,
} from "../skills/index.js";

export type PanelSkillRuntime = {
  readonly skillRoots: readonly string[];
  readonly skillStateStore?: SkillStateStore;
  readonly capabilityCenter?: {
    listSkills(): Promise<readonly SkillDefinition[]>;
    invalidate(): void;
  };
};

export async function listPanelSkills(runtime: PanelSkillRuntime): Promise<readonly SkillDefinition[]> {
  if (runtime.capabilityCenter !== undefined) {
    return runtime.capabilityCenter.listSkills();
  }
  return discoverSkills({ roots: runtime.skillRoots, stateStore: runtime.skillStateStore });
}

export async function setPanelSkillEnabled(
  runtime: PanelSkillRuntime,
  skillId: string,
  enabled: boolean
): Promise<boolean> {
  if (runtime.skillStateStore === undefined) {
    return false;
  }
  await runtime.skillStateStore.setEnabled(skillId, enabled);
  runtime.capabilityCenter?.invalidate();
  return true;
}

export async function resolveTriggeredSkillContexts(
  runtime: PanelSkillRuntime,
  goal: string
): Promise<readonly DesktopAgentSkillContext[]> {
  const skills = await listPanelSkills(runtime);
  const triggered = selectTriggeredSkills(goal, skills, 4);
  const contexts = await Promise.all(triggered.map(async (skill): Promise<DesktopAgentSkillContext> => {
    const body = await loadSkillBody(skill);
    void runtime.skillStateStore?.markUsed(skill.id);
    return {
      skill,
      body,
      triggerReason: skill.triggers.length === 0
        ? "技能名称或描述匹配当前任务。"
        : `触发词：${skill.triggers.join(" / ")}`,
    };
  }));
  return contexts;
}
