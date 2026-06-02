import React, { useState } from "react";
import {
  LayoutList,
  MessageSquarePlus,
  Plus,
  Sparkles,
  Zap,
} from "lucide-react";
import type { SkillDefinition } from "../contracts/skills";
import { compact, relativeTime } from "../text";
import { EmptyBlock, IconTile, PageHeader, Pill, SearchBox, TabBar, Toggle } from "./workspace-common";

const SKILL_TABS = ["全部", "已启用", "已停用"] as const;

export function SkillsPage(props: {
  readonly skills: readonly SkillDefinition[];
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
  readonly onStartSkill: (skill: SkillDefinition) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<(typeof SKILL_TABS)[number]>("全部");
  const visibleSkills = props.skills.filter((skill) => {
    if (activeTab === "已启用" && !skill.enabled) return false;
    if (activeTab === "已停用" && skill.enabled) return false;
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return true;
    const copy = skillCopy(skill);
    return [copy.title, copy.description, skill.name, skill.description, ...copy.chips, ...(skill.triggers ?? [])].some((value) => value.toLowerCase().includes(normalized));
  });
  return (
    <section className="workspace-page" aria-label="工作方式">
      <div className="workspace-shell">
        <div className="workspace-page-kicker">
          <Sparkles size={13} />
          可复用工作方法
        </div>
        <PageHeader
          title="工作方式"
          subtitle="保存常用的工作方式，让新任务可以直接带上合适的步骤、语气和检查重点。"
          actions={
            <button type="button" className="page-action-button primary" disabled>
              <Plus size={14} />
              新建
            </button>
          }
        />
        <div className="workspace-filter-row">
          <SearchBox value={query} onChange={setQuery} placeholder="搜索工作方式" />
          <TabBar tabs={SKILL_TABS} activeTab={activeTab} onChange={setActiveTab} />
        </div>
        {visibleSkills.length === 0 ? (
          <EmptyBlock>当前工作区没有发现可用工作方式。</EmptyBlock>
        ) : (
          <div className="skill-grid">
            {visibleSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onUpdateSkill={props.onUpdateSkill}
                onStartSkill={props.onStartSkill}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SkillCard(props: {
  readonly skill: SkillDefinition;
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
  readonly onStartSkill: (skill: SkillDefinition) => void;
}): React.ReactElement {
  const copy = skillCopy(props.skill);
  const lastUsed = props.skill.lastUsedAt === undefined ? "尚未使用" : relativeTime(props.skill.lastUsedAt);
  return (
    <article className="skill-card">
      <header>
        <IconTile icon={copy.icon} />
        <Toggle checked={props.skill.enabled} onChange={(enabled) => props.onUpdateSkill(props.skill.id, enabled)} label={props.skill.enabled ? "停用工作方式" : "启用工作方式"} />
      </header>
      <div>
        <div className="skill-title-row">
          <h2>{copy.title}</h2>
          <Pill tone={props.skill.enabled ? "success" : "neutral"}>{props.skill.enabled ? "已启用" : "未启用"}</Pill>
        </div>
        <p>{copy.description}</p>
      </div>
      {copy.chips.length > 0 && (
        <div className="chip-row">
          {copy.chips.slice(0, 3).map((chip) => <span key={chip}>{compact(chip, 16)}</span>)}
        </div>
      )}
      <footer>
        <span>最近：{lastUsed}</span>
        <button type="button" disabled={!props.skill.enabled} onClick={() => props.onStartSkill(props.skill)}>
          <MessageSquarePlus size={14} />
          使用
        </button>
      </footer>
    </article>
  );
}

function skillCopy(skill: SkillDefinition): {
  readonly title: string;
  readonly description: string;
  readonly chips: readonly string[];
  readonly icon: React.ReactNode;
} {
  const normalized = `${skill.id} ${skill.name}`.toLowerCase();
  if (normalized.includes("agentarbor-workbench-ui")) {
    return {
      title: "工作台界面设计",
      description: "用于设计、审查和重建普通 Agent 面板、任务会话与工作上下文。",
      chips: ["界面结构", "任务会话", "工作记录"],
      icon: <LayoutList size={17} />,
    };
  }
  if (normalized.includes("ai-agent-workspace-panel")) {
    return {
      title: "Agent 工作区面板",
      description: "用于规划 AI 工作区、任务入口、进度摘要、确认和成果预览。",
      chips: ["工作区", "待确认", "成果预览"],
      icon: <Zap size={17} />,
    };
  }
  return {
    title: titleFromSkillName(skill.name),
    description: descriptionFromSkill(skill),
    chips: chipsFromSkill(skill),
    icon: <Zap size={17} />,
  };
}

function titleFromSkillName(name: string): string {
  if (/[\u4e00-\u9fff]/.test(name)) return name;
  const normalized = name.replace(/^agentarbor[-_]?/i, "").replace(/[-_]+/g, " ").trim();
  return normalized.length === 0 ? "工作方法" : normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function descriptionFromSkill(skill: SkillDefinition): string {
  if (/[\u4e00-\u9fff]/.test(skill.description)) return skill.description;
  if (skill.triggers !== undefined && skill.triggers.length > 0) {
    return `围绕「${compact(skill.triggers[0], 36)}」组织上下文和执行重点。`;
  }
  return "可在授权边界内为当前任务注入专门的工作方式。";
}

function chipsFromSkill(skill: SkillDefinition): readonly string[] {
  if (skill.triggers === undefined || skill.triggers.length === 0) return ["工作方法"];
  return skill.triggers.slice(0, 3).map((trigger) => /[\u4e00-\u9fff]/.test(trigger) ? trigger : "触发规则");
}
