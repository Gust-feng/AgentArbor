import React from "react";
import type { ConfigResponse, SkillDefinition, ToolCatalogItem, ToolsResponse } from "../types";
import type { SettingsTab } from "../ui-state";

type ModelForm = { readonly baseUrl: string; readonly model: string; readonly apiKey: string };
type ToolForm = { readonly provider: string; readonly tavilyApiKey: string; readonly maxResults: string };

export function SettingsPanel(props: {
  readonly tab: SettingsTab;
  readonly setTab: (tab: SettingsTab) => void;
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly skills: readonly SkillDefinition[];
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly aiMode: "none" | "fake" | "openai-compatible";
  readonly setAiMode: (mode: "none" | "fake" | "openai-compatible") => void;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly onClose: () => void;
  readonly onSaveModel: () => void;
  readonly onSaveWorkspace: () => void;
  readonly onSaveTools: () => void;
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
}): React.ReactElement {
  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label="设置">
        <header>
          <div>
            <strong>设置</strong>
            <p>配置模型、工作目录、工具和安全边界。</p>
          </div>
          <button type="button" onClick={props.onClose}>关闭</button>
        </header>
        <nav className="settings-tabs">
          {(["model", "workspace", "skills", "tools", "safety"] as const).map((tab) => (
            <button type="button" className={props.tab === tab ? "selected" : ""} onClick={() => props.setTab(tab)} key={tab}>
              {settingsTabLabel(tab)}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {props.tab === "model" && (
            <section className="settings-card">
              <h2>模型</h2>
              <label>Base URL <input value={props.modelForm.baseUrl} onChange={(event) => props.setModelForm({ ...props.modelForm, baseUrl: event.target.value })} /></label>
              <label>模型名 <input value={props.modelForm.model} onChange={(event) => props.setModelForm({ ...props.modelForm, model: event.target.value })} /></label>
              <label>默认模式
                <select value={props.aiMode} onChange={(event) => props.setAiMode(event.target.value as "none" | "fake" | "openai-compatible")}>
                  <option value="openai-compatible">真实模型</option>
                  <option value="fake">测试模型</option>
                  <option value="none">停用模型</option>
                </select>
              </label>
              <label>API Key <input value={props.modelForm.apiKey} onChange={(event) => props.setModelForm({ ...props.modelForm, apiKey: event.target.value })} placeholder={props.config?.config?.secretConfigured ? "已保存，留空则不修改" : "请输入密钥"} /></label>
              <button type="button" className="primary" onClick={props.onSaveModel}>保存模型配置</button>
            </section>
          )}
          {props.tab === "workspace" && (
            <section className="settings-card">
              <h2>工作目录</h2>
              <label>文件夹 <input value={props.workspaceDirectory} onChange={(event) => props.setWorkspaceDirectory(event.target.value)} /></label>
              <button type="button" className="primary" onClick={props.onSaveWorkspace}>保存工作目录</button>
            </section>
          )}
          {props.tab === "skills" && (
            <section className="settings-card">
              <h2>技能</h2>
              {props.skills.length === 0 ? <p className="muted">当前工作区没有发现技能。</p> : props.skills.map((skill) => (
                <article className="settings-row" key={skill.id}>
                  <div>
                    <strong>{skill.name}</strong>
                    <p>{skill.description}</p>
                  </div>
                  <label className="toggle"><input type="checkbox" checked={skill.enabled} onChange={(event) => props.onUpdateSkill(skill.id, event.target.checked)} />启用</label>
                </article>
              ))}
            </section>
          )}
          {props.tab === "tools" && (
            <section className="settings-card">
              <h2>工具</h2>
              <label>搜索服务
                <select value={props.toolForm.provider} onChange={(event) => props.setToolForm({ ...props.toolForm, provider: event.target.value })}>
                  <option value="tavily">Tavily</option>
                  <option value="none">无</option>
                </select>
              </label>
              <label>Tavily Key <input type="password" value={props.toolForm.tavilyApiKey} onChange={(event) => props.setToolForm({ ...props.toolForm, tavilyApiKey: event.target.value })} placeholder={props.tools?.tools?.webSearch?.secretConfigured ? "已保存，留空则不修改" : "请输入密钥"} /></label>
              <label>结果数 <input type="number" min={1} max={10} value={props.toolForm.maxResults} onChange={(event) => props.setToolForm({ ...props.toolForm, maxResults: event.target.value })} /></label>
              <button type="button" className="primary" onClick={props.onSaveTools}>保存工具配置</button>
              <ToolCatalog tools={props.tools?.tools?.catalog?.tools ?? []} />
            </section>
          )}
          {props.tab === "safety" && (
            <section className="settings-card">
              <h2>安全</h2>
              <p>密钥只进入本地 secret store。普通会话、运行记录和工具结果只展示安全摘要。</p>
              <p>写入、编辑、命令执行和外部提交类操作会先请求确认。</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function ToolCatalog({ tools }: { readonly tools: readonly ToolCatalogItem[] }): React.ReactElement {
  return (
    <div className="tool-catalog">
      {tools.slice(0, 12).map((tool) => (
        <article className="settings-row" key={tool.name}>
          <div>
            <strong>{tool.displayName ?? tool.name}</strong>
            <p>{tool.description ?? "可用工具"}</p>
          </div>
          <span className={`status-pill ${tool.enabled && tool.available !== false ? "success" : "muted"}`}>
            {tool.enabled && tool.available !== false ? "可用" : "不可用"}
          </span>
        </article>
      ))}
    </div>
  );
}

function settingsTabLabel(tab: SettingsTab): string {
  if (tab === "model") return "模型";
  if (tab === "workspace") return "工作目录";
  if (tab === "skills") return "技能";
  if (tab === "tools") return "工具";
  return "安全";
}
