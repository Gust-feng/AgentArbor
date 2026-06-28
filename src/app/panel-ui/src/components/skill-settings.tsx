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
        <div className="skills-empty">暂无技能</div>
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
  const lastUsed = skillLastUsedView(props.skill.lastUsedAt);
  const hasCategory = props.skill.category !== undefined && props.skill.category.length > 0;
  const sourceLabel = skillSourceLabel(props.skill);
  const hasMeta = hasCategory || sourceLabel !== undefined || lastUsed !== undefined;
  const toggleActionLabel = props.skill.enabled ? "停用" : "启用";
  return (
    <article className={`skills-row ${props.skill.enabled ? "" : "disabled"}`}>
      <div className="skills-row-main">
        <div className="skills-row-title">
          <strong>{props.skill.name}</strong>
          <span className={props.skill.enabled ? "enabled" : "disabled"}>{props.skill.enabled ? "启用" : "停用"}</span>
        </div>
        <p>{skillSummary(props.skill)}</p>
        {hasMeta && (
          <div className="skills-row-meta">
            {sourceLabel !== undefined && (
              <span className="source">
                {sourceLabel}
              </span>
            )}
            {hasCategory && <span>{props.skill.category}</span>}
            {lastUsed !== undefined && (
              <span className={lastUsed.kind === "invalid" ? "muted" : undefined}>
                最近使用：{lastUsed.dateTime === undefined ? (
                  lastUsed.label
                ) : (
                  <time dateTime={lastUsed.dateTime}>{lastUsed.label}</time>
                )}
              </span>
            )}
          </div>
        )}
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

function skillSourceLabel(skill: SkillDefinition): string | undefined {
  switch (skill.sourceKind) {
    case "project":
      return "项目";
    case "user":
      return "全局";
    case "plugin":
      return "插件";
    case "admin":
      return "管理员";
    case "custom":
      return "自定义";
    default:
      return undefined;
  }
}

type SkillLastUsedView = {
  readonly kind: "known" | "invalid";
  readonly label: string;
  readonly dateTime?: string;
  readonly title?: string;
};

function skillLastUsedView(value: string | undefined): SkillLastUsedView | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { kind: "invalid", label: "记录异常", title: value };
  }
  return {
    kind: "known",
    label: formatSkillLastUsedDate(date),
    dateTime: date.toISOString(),
    title: date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

function formatSkillLastUsedDate(date: Date): string {
  const now = new Date();
  const todayStart = startOfLocalDay(now).getTime();
  const dateStart = startOfLocalDay(date).getTime();
  const dayOffset = Math.round((dateStart - todayStart) / 86_400_000);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (dayOffset === 0) {
    return `今天 ${time}`;
  }
  if (dayOffset === -1) {
    return `昨天 ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日 ${time}`;
  }
  return `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日 ${time}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
