import React from "react";
import type { ConfigResponse } from "../contracts/config";
import type { SkillDefinition } from "../contracts/skills";
import type { ToolsResponse } from "../contracts/tools";
import type { McpServerForm, ToolForm } from "./settings-types";
import { providerName, toolDescription, toolMeta, toolTitle } from "./settings-tool-copy";
import { SettingRow } from "./workspace-common";

const SAVED_API_KEY_MASK = "****************";

export function CapabilitiesSettings(props: {
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly mcpServerForm: McpServerForm;
  readonly setMcpServerForm: (form: McpServerForm) => void;
  readonly savingTools?: boolean;
  readonly onSaveTools: () => void;
  readonly onSaveMcpServer: () => void;
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
      <McpServiceSettings
        tools={props.tools}
        form={props.mcpServerForm}
        setForm={props.setMcpServerForm}
        saving={props.savingTools}
        onSave={props.onSaveMcpServer}
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

function McpServiceSettings(props: {
  readonly tools?: ToolsResponse;
  readonly form: McpServerForm;
  readonly setForm: (form: McpServerForm) => void;
  readonly saving?: boolean;
  readonly onSave: () => void;
}): React.ReactElement {
  const catalog = props.tools?.mcpCatalog ?? [];
  const selectedServer = props.form.serverId.length === 0
    ? undefined
    : catalog.find((server) => server.serverId === props.form.serverId);
  const canSave = props.form.serverId.trim().length > 0;
  return (
    <section className="settings-card mcp-service-card">
      <div className="settings-card-title-row">
        <h3>MCP 服务</h3>
        <span>{catalog.length} 个</span>
      </div>
      <div className="mcp-service-list">
        {catalog.length === 0 ? (
          <div className="capability-empty">暂无服务</div>
        ) : (
          catalog.map((server) => (
            <button
              type="button"
              key={server.serverId}
              className={`mcp-service-row ${server.serverId === props.form.serverId ? "selected" : ""}`}
              onClick={() => props.setForm(formFromMcpCatalog(server, props.form))}
            >
              <span className="mcp-service-main">
                <strong>{server.label}</strong>
                <span>{mcpServerEndpoint(server)}</span>
              </span>
              <span className="mcp-service-meta">{mcpServerMeta(server)}</span>
            </button>
          ))
        )}
      </div>
      <div className="mcp-form-grid">
        <label>
          服务 ID
          <input
            value={props.form.serverId}
            onChange={(event) => props.setForm({ ...props.form, serverId: event.target.value })}
            placeholder="filesystem"
          />
        </label>
        <label>
          名称
          <input
            value={props.form.label}
            onChange={(event) => props.setForm({ ...props.form, label: event.target.value })}
            placeholder={props.form.serverId || "本地文件服务"}
          />
        </label>
        <label>
          连接方式
          <select
            value={props.form.transport}
            onChange={(event) => props.setForm({ ...props.form, transport: event.target.value === "http" ? "http" : "stdio" })}
          >
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
          </select>
        </label>
        {props.form.transport === "stdio" ? (
          <>
            <label className="mcp-form-wide">
              命令
              <input
                value={props.form.command}
                onChange={(event) => props.setForm({ ...props.form, command: event.target.value })}
                placeholder={selectedServer?.commandSummary ?? "node server.js"}
              />
            </label>
            <label className="mcp-form-wide">
              参数
              <textarea
                value={props.form.args}
                onChange={(event) => props.setForm({ ...props.form, args: event.target.value })}
                placeholder="每行一个参数"
              />
            </label>
          </>
        ) : (
          <label className="mcp-form-wide">
            URL
            <input
              value={props.form.url}
              onChange={(event) => props.setForm({ ...props.form, url: event.target.value })}
              placeholder={selectedServer?.url ?? "http://127.0.0.1:3000/mcp"}
            />
          </label>
        )}
        <label className="mcp-form-wide">
          环境密钥引用
          <textarea
            value={props.form.envSecretRefs}
            onChange={(event) => props.setForm({ ...props.form, envSecretRefs: event.target.value })}
            placeholder="每行一个环境变量名"
          />
        </label>
        <label className="mcp-enabled-field">
          <input
            type="checkbox"
            checked={props.form.enabled}
            onChange={(event) => props.setForm({ ...props.form, enabled: event.target.checked })}
          />
          启用
        </label>
        <button type="button" className="page-action-button primary" onClick={props.onSave} disabled={props.saving || !canSave}>
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

function formFromMcpCatalog(server: NonNullable<ToolsResponse["mcpCatalog"]>[number], previous: McpServerForm): McpServerForm {
  return {
    ...previous,
    serverId: server.serverId,
    label: server.label,
    transport: server.transport,
    command: "",
    args: "",
    url: server.url ?? "",
    envSecretRefs: "",
    enabled: server.enabled,
  };
}

function mcpServerEndpoint(server: NonNullable<ToolsResponse["mcpCatalog"]>[number]): string {
  if (server.transport === "http") {
    return server.url ?? "HTTP";
  }
  return server.commandSummary ?? "stdio";
}

function mcpServerMeta(server: NonNullable<ToolsResponse["mcpCatalog"]>[number]): string {
  const status = mcpRuntimeStatusLabel(server.runtimeStatus ?? server.availability);
  const toolCount = `${server.tools.length} 个工具`;
  const secretRefs = server.envSecretRefCount > 0 ? ` · ${server.envSecretRefCount} 个密钥引用` : "";
  const error = server.errorSummary === undefined ? "" : ` · ${server.errorSummary}`;
  return `${status} · ${toolCount}${secretRefs}${error}`;
}

function mcpRuntimeStatusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "configured":
      return "已配置";
    case "disabled":
      return "已停用";
    case "error":
      return "连接失败";
    case "unavailable":
      return "缺少配置";
    default:
      return "已配置";
  }
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
