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
        <h3>能力原则</h3>
        <p>这里配置可用服务和安全边界，不编排固定流程。助手会根据当前任务自主决定是否读取上下文、查证网页、调用工具或注入工作方法。</p>
        <SettingRow label="工具调用">
          <span className="settings-value">{props.config?.capabilities?.modelCapabilities?.supportsToolCalling === false ? "当前模型未声明支持" : "由模型按任务判断"}</span>
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
      <h3>网页查证服务</h3>
      <p>当前服务：{providerName(current)}。这只决定网络查证是否可用，不替助手决定何时搜索或如何判断资料。</p>
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
      <p>启用状态是工具可用性的边界，不是任务流程。具体是否调用仍由助手在运行时判断，并受确认门约束。</p>
      <div className="capability-list">
        {catalog.length === 0 ? (
          <div className="capability-empty">当前没有发现可展示的运行时工具。</div>
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
      <p>工作方法只作为可注入的上下文候选。是否采用、如何组合和何时忽略，仍交给模型按任务判断。</p>
      <div className="capability-list">
        {props.skills.length === 0 ? (
          <div className="capability-empty">当前没有发现已安装的工作方法。</div>
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
