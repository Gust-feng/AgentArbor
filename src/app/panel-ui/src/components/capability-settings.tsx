import React from "react";
import type { ConfigResponse } from "../contracts/config";
import type { SkillDefinition } from "../contracts/skills";
import type { ToolsResponse } from "../contracts/tools";
import type { ToolForm } from "./settings-types";
import { providerName, toolDescription, toolMeta, toolTitle } from "./settings-tool-copy";
import { SettingRow } from "./workspace-common";

const SAVED_API_KEY_MASK = "****************";

export function CapabilitiesSettings(props: {
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly savingTools?: boolean;
  readonly onSaveTools: () => void;
  readonly onUpdateTool: (toolName: string, enabled: boolean) => void;
  readonly skills: readonly SkillDefinition[];
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
}): React.ReactElement {
  return (
    <div className="capability-settings-stack">
      <section className="settings-card">
        <h3>基础能力</h3>
        <SettingRow label="工具调用">
          <span className="settings-value">{props.config?.capabilities?.modelCapabilities?.supportsToolCalling === false ? "未声明支持" : "可用"}</span>
        </SettingRow>
        <SettingRow label="外部查证">
          <span className="settings-value">{providerName(props.tools?.tools?.webSearch?.provider ?? props.toolForm.provider)}</span>
        </SettingRow>
      </section>
      <WebSearchSettings
        tools={props.tools}
        toolForm={props.toolForm}
        setToolForm={props.setToolForm}
        saving={props.savingTools}
        onSaveTools={props.onSaveTools}
      />
      <ToolCatalogSettings tools={props.tools} saving={props.savingTools} onUpdateTool={props.onUpdateTool} />
      <SkillContextSettings skills={props.skills} onUpdateSkill={props.onUpdateSkill} />
    </div>
  );
}

function WebSearchSettings(props: {
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly saving?: boolean;
  readonly onSaveTools: () => void;
}): React.ReactElement {
  const configured = props.tools?.tools?.webSearch?.secretConfigured === true;
  const current = props.tools?.tools?.webSearch?.provider ?? props.toolForm.provider;
  return (
    <section className="settings-card service-settings-card">
      <h3>网页查证</h3>
      <div className="service-config-grid">
        <label>
          搜索服务
          <select value={props.toolForm.provider} onChange={(event) => props.setToolForm({ ...props.toolForm, provider: event.target.value })}>
            <option value="tavily">Tavily</option>
            <option value="none">无</option>
          </select>
        </label>
        <label>
          Tavily Key
          <input
            type="password"
            value={props.toolForm.tavilyApiKey}
            onChange={(event) => props.setToolForm({ ...props.toolForm, tavilyApiKey: event.target.value })}
            placeholder={configured ? SAVED_API_KEY_MASK : "请输入密钥"}
          />
        </label>
        <label>
          结果数
          <input
            type="number"
            min={1}
            max={10}
            value={props.toolForm.maxResults}
            onChange={(event) => props.setToolForm({ ...props.toolForm, maxResults: event.target.value })}
          />
        </label>
        <button type="button" className="page-action-button primary" onClick={props.onSaveTools} disabled={props.saving}>
          {props.saving ? "保存中" : "保存"}
        </button>
      </div>
    </section>
  );
}

function ToolCatalogSettings(props: {
  readonly tools?: ToolsResponse;
  readonly saving?: boolean;
  readonly onUpdateTool: (toolName: string, enabled: boolean) => void;
}): React.ReactElement {
  const catalog = props.tools?.tools?.catalog?.tools ?? [];
  return (
    <section className="settings-card capability-list-card">
      <h3>运行时工具</h3>
      <div className="capability-list">
        {catalog.length === 0 ? (
          <div className="capability-empty">暂无工具</div>
        ) : (
          catalog.map((tool) => (
            <CapabilityRow
              key={tool.name}
              title={toolTitle(tool)}
              description={toolDescription(tool)}
              meta={toolMeta(tool)}
              enabled={tool.enabled && tool.available !== false}
              blocked={tool.available === false}
              onToggle={() => props.onUpdateTool(tool.name, !tool.enabled)}
              disabled={props.saving === true || tool.available === false}
            />
          ))
        )}
      </div>
    </section>
  );
}

function SkillContextSettings(props: {
  readonly skills: readonly SkillDefinition[];
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
}): React.ReactElement {
  return (
    <section className="settings-card capability-list-card">
      <h3>工作方法</h3>
      <div className="capability-list">
        {props.skills.length === 0 ? (
          <div className="capability-empty">暂无工作方法</div>
        ) : (
          props.skills.map((skill) => (
            <CapabilityRow
              key={skill.id}
              title={skill.name}
              description={skill.description}
              meta={skill.triggers?.slice(0, 2).join(" · ") || "按任务匹配"}
              enabled={skill.enabled}
              onToggle={() => props.onUpdateSkill(skill.id, !skill.enabled)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function CapabilityRow(props: {
  readonly title: string;
  readonly description: string;
  readonly meta: string;
  readonly enabled: boolean;
  readonly blocked?: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}): React.ReactElement {
  return (
    <article className="capability-row">
      <div className="capability-row-main">
        <strong>{props.title}</strong>
        <span>{props.description}</span>
      </div>
      <div className="capability-row-meta">
        <span>{props.blocked === true ? "不可用" : props.meta}</span>
        <button
          type="button"
          className="capability-toggle"
          aria-pressed={props.enabled}
          disabled={props.disabled}
          onClick={props.onToggle}
        >
          {props.enabled ? "可用" : "停用"}
        </button>
      </div>
    </article>
  );
}
