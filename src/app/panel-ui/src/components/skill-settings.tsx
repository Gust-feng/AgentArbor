import React from "react";
import { RefreshCw } from "lucide-react";
import type { SkillDefinition } from "../contracts/skills";

export function SkillSettings(props: {
  readonly skills: readonly SkillDefinition[];
  readonly saving?: boolean;
  readonly onRefreshSkills: () => void;
  readonly onUpdateSkill: (skill: Pick<SkillDefinition, "id" | "stateKey">, enabled: boolean) => void;
}): React.ReactElement {
  const enabledCount = props.skills.filter((skill) => skill.enabled).length;
  return (
    <section className="skills-settings">
      <header className="skills-toolbar">
        <span>{enabledCount} / {props.skills.length} 启用</span>
        <button
          type="button"
          className="skills-refresh-button"
          onClick={props.onRefreshSkills}
          disabled={props.saving}
        >
          <RefreshCw size={14} />
          {props.saving ? "刷新中" : "刷新"}
        </button>
      </header>
      {props.skills.length === 0 ? (
        <div className="skills-empty">暂无技能 · <code>.agents/skills/&lt;skill-name&gt;/SKILL.md</code></div>
      ) : (
        <div className="skills-list" aria-label="技能列表">
          {props.skills.map((skill) => (
            <SkillRow
              key={skill.stateKey ?? skill.id}
              skill={skill}
              saving={props.saving}
              onToggle={() => props.onUpdateSkill(skill, !skill.enabled)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SkillRow(props: {
  readonly skill: SkillDefinition;
  readonly saving?: boolean;
  readonly onToggle: () => void;
}): React.ReactElement {
  const sourcePath = compactSkillSourcePath(props.skill.sourcePath);
  const lastUsedAt = formatSkillDateTime(props.skill.lastUsedAt);
  const toggleActionLabel = props.skill.enabled ? "停用" : "启用";
  return (
    <article className={`skills-row ${props.skill.enabled ? "" : "disabled"}`}>
      <div className="skills-row-main">
        <div className="skills-row-title">
          <strong>{props.skill.name}</strong>
          <span className={props.skill.enabled ? "enabled" : "disabled"}>{props.skill.enabled ? "启用" : "停用"}</span>
        </div>
        <p>{skillSummary(props.skill)}</p>
        <div className="skills-row-meta">
          <span>{skillTriggerLabel(props.skill)}</span>
          {props.skill.category !== undefined && props.skill.category.length > 0 && <span>{props.skill.category}</span>}
          {lastUsedAt !== undefined && <span>最近使用：{lastUsedAt}</span>}
          {sourcePath !== undefined && <span title={props.skill.sourcePath}>{sourcePath}</span>}
        </div>
        {props.skill.loadError !== undefined && props.skill.loadError.length > 0 && (
          <div className="skills-row-error">加载失败：{props.skill.loadError}</div>
        )}
      </div>
      <button
        type="button"
        className="capability-toggle"
        aria-pressed={props.skill.enabled}
        aria-label={`${toggleActionLabel} ${props.skill.name}`}
        onClick={props.onToggle}
        disabled={props.saving}
      >
        {toggleActionLabel}
      </button>
    </article>
  );
}

function skillSummary(skill: SkillDefinition): string {
  return skill.summary?.trim() || skill.description?.trim() || "未填写描述";
}

function skillTriggerLabel(skill: SkillDefinition): string {
  const triggers = skill.triggers ?? [];
  if (triggers.length === 0) {
    return "按任务匹配";
  }
  return `按任务匹配 · ${triggers.slice(0, 3).join(" / ")}`;
}

function compactSkillSourcePath(sourcePath: string | undefined): string | undefined {
  if (sourcePath === undefined || sourcePath.length === 0) {
    return undefined;
  }
  const normalized = sourcePath.replace(/\\/g, "/");
  const marker = "/.agents/skills/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + 1);
  }
  return normalized;
}

function formatSkillDateTime(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
