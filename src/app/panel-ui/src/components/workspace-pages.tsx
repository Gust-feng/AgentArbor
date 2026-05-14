import React, { useMemo, useState } from "react";
import { ChevronRight, Cpu, Database, Globe2, Plus, ShieldCheck, Wrench, Zap } from "lucide-react";
import type { ConfigResponse, SkillDefinition, ToolCatalogItem, ToolsResponse } from "../types";

type ModelForm = { readonly baseUrl: string; readonly model: string; readonly apiKey: string };
type ToolForm = { readonly provider: string; readonly tavilyApiKey: string; readonly maxResults: string };
type ButtonVariant = "primary" | "outline";

const TOOL_TABS = ["全部", "已启用", "本地", "需要确认"] as const;

const TOOL_COPY: Record<string, { readonly title: string; readonly description: string }> = {
  browser_snapshot: {
    title: "浏览器快照",
    description: "打开网页并返回安全的文本快照，适合网页阅读和事实核对。",
  },
  edit_file: {
    title: "编辑文件",
    description: "在当前工作区内按精确匹配修改文本文件，并返回变更摘要。",
  },
  grep_files: {
    title: "搜索文件",
    description: "在本地工作区搜索文本，返回匹配文件、行号和片段。",
  },
  read_file: {
    title: "读取文件",
    description: "读取授权范围内的文件内容，用于理解项目上下文。",
  },
  list_directory: {
    title: "浏览目录",
    description: "查看工作区目录结构，帮助定位相关文件。",
  },
  write_file: {
    title: "写入文件",
    description: "在明确授权后创建或覆盖文件，并保留可审阅的操作记录。",
  },
  run_command: {
    title: "运行命令",
    description: "在本地工作区执行命令，返回安全摘要和退出状态。",
  },
  web_search: {
    title: "网页搜索",
    description: "通过已配置的搜索服务获取外部资料摘要。",
  },
};

export function SkillsPage(props: {
  readonly skills: readonly SkillDefinition[];
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
  readonly onStartSkill: (skill: SkillDefinition) => void;
}): React.ReactElement {
  const enabledSkills = props.skills.filter((skill) => skill.enabled);
  return (
    <section className="workspace-page" aria-label="技能">
      <div className="workspace-shell">
        <PageHeader
          title="技能"
          subtitle="管理和配置 AI 助手的能力模块"
          actions={undefined}
        />
        {enabledSkills.length > 0 && (
          <section className="workspace-section">
            <SectionDivider label="常用技能" />
            <div className="workspace-card-grid">
              {enabledSkills.slice(0, 3).map((skill) => <SkillCard skill={skill} onUpdateSkill={props.onUpdateSkill} onStartSkill={props.onStartSkill} key={skill.id} />)}
            </div>
          </section>
        )}
        <section className="workspace-section">
          <SectionDivider label="全部技能" />
          {props.skills.length === 0 ? (
            <EmptyBlock>当前工作区没有发现技能。</EmptyBlock>
          ) : (
            <div className="workspace-card-grid">
              {props.skills.map((skill) => <SkillCard skill={skill} onUpdateSkill={props.onUpdateSkill} onStartSkill={props.onStartSkill} key={skill.id} />)}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export function ToolsPage(props: {
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly onSaveTools: () => void;
}): React.ReactElement {
  const [activeTab, setActiveTab] = useState<(typeof TOOL_TABS)[number]>("全部");
  const [configOpen, setConfigOpen] = useState(false);
  const catalog = props.tools?.tools?.catalog?.tools ?? [];
  const connectedTools = useMemo(() => catalog.filter((tool) => tool.enabled && tool.available !== false), [catalog]);
  const visibleTools = useMemo(() => filterTools(catalog, activeTab), [catalog, activeTab]);
  return (
    <section className="workspace-page" aria-label="工具">
      <div className="workspace-shell">
        <PageHeader
          title="工具"
          subtitle="扩展 AI 助手的能力，接入外部服务与数据源"
          actions={<Button variant="primary" icon={<Plus size={13} />} onClick={() => setConfigOpen(true)}>接入工具</Button>}
        />
        <TabBar tabs={TOOL_TABS} activeTab={activeTab} onChange={setActiveTab} />

        <section className="workspace-section">
          <SectionDivider label="已接入" />
          <div className="workspace-card-grid">
            <WebSearchConfigCard
              configOpen={configOpen}
              onToggle={() => setConfigOpen((value) => !value)}
              tools={props.tools}
              toolForm={props.toolForm}
              setToolForm={props.setToolForm}
              onSaveTools={props.onSaveTools}
            />
            {connectedTools.slice(0, 2).map((tool) => <ToolCard tool={tool} actionLabel="配置" key={`connected:${tool.name}`} />)}
          </div>
        </section>

        <section className="workspace-section">
          <SectionDivider label="工具目录" />
          {visibleTools.length === 0 ? (
            <EmptyBlock>当前没有可展示的工具。</EmptyBlock>
          ) : (
            <div className="workspace-card-grid">
              {visibleTools.map((tool) => <ToolCard tool={tool} actionLabel={tool.enabled ? "已接入" : "可配置"} key={tool.name} />)}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export function RoutinesPage(): React.ReactElement {
  return (
    <section className="workspace-page" aria-label="例行任务">
      <div className="workspace-shell">
        <PageHeader
          title="例行任务"
          subtitle="配置定期自动执行的任务流程"
        />
        <EmptyBlock>当前还没有例行任务。</EmptyBlock>
      </div>
    </section>
  );
}

export function SettingsPage(props: {
  readonly config?: ConfigResponse;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly aiMode: "none" | "openai-compatible";
  readonly setAiMode: (mode: "none" | "openai-compatible") => void;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSaveModel: () => void;
  readonly onSaveWorkspace: () => void;
}): React.ReactElement {
  const [activeTab, setActiveTab] = useState<"model" | "workspace" | "safety">("model");
  const tabs = [
    { id: "model", label: "模型设置", icon: <Cpu size={15} /> },
    { id: "workspace", label: "工作目录", icon: <Database size={15} /> },
    { id: "safety", label: "安全边界", icon: <ShieldCheck size={15} /> },
  ] as const;
  return (
    <section className="settings-shell" aria-label="设置">
      <div className="settings-nav">
        <p className="settings-nav-label">设置</p>
        {tabs.map(({ id, label, icon }) => (
          <button type="button" className={activeTab === id ? "selected" : ""} key={id} onClick={() => setActiveTab(id)}>
            <span className="settings-nav-main">{icon}{label}</span>
            {activeTab === id && <ChevronRight size={13} />}
          </button>
        ))}
      </div>
      <div className="settings-content">
        <div className="settings-content-inner">
          <PageHeader
            title={tabs.find((tab) => tab.id === activeTab)?.label ?? "设置"}
            subtitle={activeTab === "model" ? "配置默认模型和运行模式" : activeTab === "workspace" ? "定义当前桌面 Agent 的工作目录" : "明确密钥、确认和工具可见性的边界"}
          />
          <div className="flex flex-col gap-5">
            {activeTab === "model" && (
              <>
                <section className="settings-panel-card">
                  <SettingRow label="Base URL" description="模型服务地址。" control={<input className="settings-input" value={props.modelForm.baseUrl} onChange={(event) => props.setModelForm({ ...props.modelForm, baseUrl: event.target.value })} />} />
                  <SettingRow label="模型名" description="默认使用的模型。" control={<input className="settings-input" value={props.modelForm.model} onChange={(event) => props.setModelForm({ ...props.modelForm, model: event.target.value })} />} />
                  <SettingRow label="运行模式" description="选择是否启用已配置的模型服务。" control={<select className="settings-input" value={props.aiMode} onChange={(event) => props.setAiMode(event.target.value as "none" | "openai-compatible")}><option value="openai-compatible">启用模型</option><option value="none">停用模型</option></select>} />
                  <SettingRow label="API Key" description="密钥只进入本地 secret store。" control={<input className="settings-input" value={props.modelForm.apiKey} onChange={(event) => props.setModelForm({ ...props.modelForm, apiKey: event.target.value })} placeholder={props.config?.config?.secretConfigured ? "已保存，留空则不修改" : "请输入密钥"} />} last />
                </section>
                <Button variant="primary" onClick={props.onSaveModel}>保存模型配置</Button>
              </>
            )}
            {activeTab === "workspace" && (
              <>
                <section className="settings-panel-card">
                  <SettingRow label="文件夹" description="Agent 默认使用的工作区根目录。" control={<input className="settings-input" value={props.workspaceDirectory} onChange={(event) => props.setWorkspaceDirectory(event.target.value)} />} last />
                </section>
                <Button variant="primary" onClick={props.onSaveWorkspace}>保存工作目录</Button>
              </>
            )}
            {activeTab === "safety" && (
              <section className="settings-panel-card">
                <SettingRow label="密钥存储" description="密钥只进入本地 secret store，不会进入普通会话或运行记录。" control={<span className="settings-value">本地隔离</span>} />
                <SettingRow label="可见输出" description="普通视图只展示安全摘要、证据和结果，不展示原始输出。" control={<span className="settings-value">安全投影</span>} />
                <SettingRow label="危险操作" description="写入、编辑、命令执行和外部提交类操作会先请求确认。" control={<span className="settings-value">需确认</span>} last />
              </section>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PageHeader(props: { readonly title: string; readonly subtitle?: string; readonly actions?: React.ReactNode }): React.ReactElement {
  return (
    <header className="workspace-page-header">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      {props.actions && <div className="workspace-header-actions">{props.actions}</div>}
    </header>
  );
}

function TabBar<T extends string>(props: { readonly tabs: readonly T[]; readonly activeTab: T; readonly onChange: (tab: T) => void }): React.ReactElement {
  return (
    <div className="workspace-tab-bar">
      {props.tabs.map((tab) => (
        <button type="button" className={props.activeTab === tab ? "selected" : ""} onClick={() => props.onChange(tab)} key={tab}>{tab}</button>
      ))}
    </div>
  );
}

function SectionDivider({ label }: { readonly label: string }): React.ReactElement {
  return (
    <div className="workspace-divider">
      <hr />
      <span>{label}</span>
      <hr />
    </div>
  );
}

function Button(props: { readonly variant?: ButtonVariant; readonly icon?: React.ReactNode; readonly children: React.ReactNode; readonly onClick?: () => void }): React.ReactElement {
  return (
    <button type="button" className={`workspace-button ${props.variant ?? "outline"}`} onClick={props.onClick}>
      {props.icon && <span>{props.icon}</span>}
      {props.children}
    </button>
  );
}

function EmptyBlock(props: { readonly children: React.ReactNode }): React.ReactElement {
  return <div className="workspace-empty">{props.children}</div>;
}

function SkillCard(props: {
  readonly skill: SkillDefinition;
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
  readonly onStartSkill: (skill: SkillDefinition) => void;
}): React.ReactElement {
  return (
    <article
      className="workspace-card workspace-action-card"
      role="button"
      tabIndex={0}
      onClick={() => props.onStartSkill(props.skill)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onStartSkill(props.skill);
        }
      }}
    >
      <div className="workspace-card-header">
        <IconTile icon={<Zap size={16} />} />
        <label className="workspace-switch" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={props.skill.enabled} onChange={(event) => props.onUpdateSkill(props.skill.id, event.target.checked)} />
          <span />
        </label>
      </div>
      <div className="workspace-card-main">
        <h3 className="workspace-card-title">{props.skill.name}</h3>
        <p className="workspace-card-desc">{props.skill.description}</p>
      </div>
      <div className="workspace-card-footer">
        <span className="muted-label">{props.skill.enabled ? "已启用" : "已停用"}</span>
        <span className="muted-label">开始对话</span>
      </div>
    </article>
  );
}

function WebSearchConfigCard(props: {
  readonly configOpen: boolean;
  readonly onToggle: () => void;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly onSaveTools: () => void;
}): React.ReactElement {
  const configured = props.tools?.tools?.webSearch?.secretConfigured === true;
  const provider = props.tools?.tools?.webSearch?.provider ?? props.toolForm.provider;
  return (
    <article className="workspace-card workspace-config-card">
      <div className="workspace-card-header">
        <IconTile icon={<Globe2 size={16} />} />
        <Badge tone={configured ? "success" : "neutral"}>{configured ? "已配置" : "待配置"}</Badge>
      </div>
      <div className="workspace-card-main">
        <h3 className="workspace-card-title">网页搜索</h3>
        <p className="workspace-card-desc">当前服务：{provider === "none" ? "未启用" : providerName(provider)}。用于搜索网页资料并返回安全摘要。</p>
      </div>
      {props.configOpen && (
        <div className="workspace-compact-form">
          <label>搜索服务<select className="settings-input" value={props.toolForm.provider} onChange={(event) => props.setToolForm({ ...props.toolForm, provider: event.target.value })}><option value="tavily">Tavily</option><option value="none">无</option></select></label>
          <label>Tavily Key<input className="settings-input" type="password" value={props.toolForm.tavilyApiKey} onChange={(event) => props.setToolForm({ ...props.toolForm, tavilyApiKey: event.target.value })} placeholder={configured ? "已保存，留空则不修改" : "请输入密钥"} /></label>
          <label>结果数<input className="settings-input" type="number" min={1} max={10} value={props.toolForm.maxResults} onChange={(event) => props.setToolForm({ ...props.toolForm, maxResults: event.target.value })} /></label>
        </div>
      )}
      <div className="workspace-card-footer">
        <button type="button" className="workspace-inline-action" onClick={props.onToggle}>{props.configOpen ? "收起" : "配置"}</button>
        {props.configOpen && <Button variant="primary" onClick={props.onSaveTools}>保存</Button>}
      </div>
    </article>
  );
}

function ToolCard(props: { readonly tool: ToolCatalogItem; readonly actionLabel: string }): React.ReactElement {
  const copy = toolCopy(props.tool);
  const enabled = props.tool.enabled && props.tool.available !== false;
  return (
    <article className="workspace-card">
      <div className="workspace-card-header">
        <IconTile icon={<Wrench size={16} />} />
        <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "可用" : "不可用"}</Badge>
      </div>
      <div className="workspace-card-main">
        <h3 className="workspace-card-title">{copy.title}</h3>
        <p className="workspace-card-desc">{copy.description}</p>
        {copy.idLabel && <small className="workspace-card-id">{copy.idLabel}</small>}
      </div>
      <div className="workspace-card-footer">
        <span className="muted-label">{toolMeta(props.tool)}</span>
        <span className="muted-label">{props.actionLabel}</span>
      </div>
    </article>
  );
}

function IconTile({ icon }: { readonly icon: React.ReactNode }): React.ReactElement {
  return <div className="workspace-card-icon"><div className="workspace-card-icon-mark">{icon}</div></div>;
}

function Badge(props: { readonly tone: "success" | "neutral" | "warning"; readonly children: React.ReactNode }): React.ReactElement {
  return <span className={`workspace-pill ${props.tone}`}>{props.children}</span>;
}

function SettingRow(props: {
  readonly label: string;
  readonly description: string;
  readonly control: React.ReactNode;
  readonly last?: boolean;
}): React.ReactElement {
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <strong>{props.label}</strong>
        <p>{props.description}</p>
      </div>
      <div className="settings-row-control">{props.control}</div>
    </div>
  );
}

function filterTools(catalog: readonly ToolCatalogItem[], tab: (typeof TOOL_TABS)[number]): readonly ToolCatalogItem[] {
  if (tab === "已启用") return catalog.filter((tool) => tool.enabled && tool.available !== false);
  if (tab === "本地") return catalog.filter((tool) => tool.operationType !== "network");
  if (tab === "需要确认") return catalog.filter((tool) => tool.requiresConfirmation === true || tool.riskLevel === "high");
  return catalog;
}

function toolCopy(tool: ToolCatalogItem): { readonly title: string; readonly description: string; readonly idLabel?: string } {
  const mapped = TOOL_COPY[tool.name];
  const title = tool.displayName ?? mapped?.title ?? titleFromId(tool.name);
  return {
    title,
    description: mapped?.description ?? tool.description ?? "可供 Agent 在授权边界内调用的本地能力。",
    idLabel: title === tool.name ? undefined : tool.name,
  };
}

function titleFromId(value: string): string {
  return value.split(/[-_]/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}

function toolMeta(tool: ToolCatalogItem): string {
  if (tool.requiresConfirmation === true || tool.riskLevel === "high") return "需确认";
  if (tool.category !== undefined && tool.category.length > 0) return tool.category;
  return tool.operationType ?? "工具";
}

function providerName(provider: string): string {
  if (provider === "tavily") return "Tavily";
  if (provider === "none") return "未启用";
  return provider;
}
