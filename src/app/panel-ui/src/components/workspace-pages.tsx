import React, { useMemo, useState } from "react";
import { ChevronRight, Cpu, Database, Globe2, Plus, Search, ShieldCheck, Wrench, Zap } from "lucide-react";
import type {
  ConfigResponse,
  ModelProviderModelCatalog,
  ModelProviderPreset,
  SkillDefinition,
  ToolCatalogItem,
  ToolsResponse,
} from "../types";

type ModelForm = {
  readonly profileId: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
};
type ToolForm = { readonly provider: string; readonly tavilyApiKey: string; readonly maxResults: string };
type ButtonVariant = "primary" | "outline";

const TOOL_TABS = ["全部", "已启用", "本地", "需要确认"] as const;
const SKILL_TABS = ["全部", "已启用", "已停用"] as const;

export function SkillsPage(props: {
  readonly skills: readonly SkillDefinition[];
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
  readonly onStartSkill: (skill: SkillDefinition) => void;
}): React.ReactElement {
  const [activeTab, setActiveTab] = useState<(typeof SKILL_TABS)[number]>("全部");
  const [query, setQuery] = useState("");
  const enabledSkills = props.skills.filter((skill) => skill.enabled);
  const visibleSkills = props.skills.filter((skill) => {
    if (activeTab === "已启用" && !skill.enabled) return false;
    if (activeTab === "已停用" && skill.enabled) return false;
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) return true;
    return `${skill.name} ${skill.description}`.toLowerCase().includes(normalizedQuery);
  });
  return (
    <section className="workspace-page" aria-label="技能">
      <div className="workspace-shell">
        <PageHeader
          title="技能"
          subtitle="选择一个技能，让助手进入对应工作状态"
          actions={undefined}
        />
        <div className="workspace-filter-row">
          <label className="workspace-search" aria-label="搜索技能">
            <Search size={13} className="text-[var(--muted-faint)] shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索技能…"
              className="border-0 bg-transparent p-0 h-auto text-sm outline-none"
            />
          </label>
          <div className="workspace-filter-tabs ml-auto">
            {SKILL_TABS.map((tab) => (
              <button type="button" className={activeTab === tab ? "selected" : ""} onClick={() => setActiveTab(tab)} key={tab}>{tab}</button>
            ))}
          </div>
        </div>
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
          {visibleSkills.length === 0 ? (
            <EmptyBlock>当前工作区没有发现技能。</EmptyBlock>
          ) : (
            <div className="workspace-card-grid">
              {visibleSkills.map((skill) => <SkillCard skill={skill} onUpdateSkill={props.onUpdateSkill} onStartSkill={props.onStartSkill} key={skill.id} />)}
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
  readonly saving?: boolean;
  readonly onSaveTools: () => void;
  readonly onUpdateTool: (toolName: string, enabled: boolean) => void;
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
              saving={props.saving}
              onSaveTools={props.onSaveTools}
            />
            {connectedTools.slice(0, 2).map((tool) => (
              <ToolCard
                tool={tool}
                actionLabel={tool.enabled ? "已启用" : "已停用"}
                onUpdateTool={props.onUpdateTool}
                key={`connected:${tool.name}`}
              />
            ))}
          </div>
        </section>

        <section className="workspace-section">
          <SectionDivider label="工具目录" />
          {visibleTools.length === 0 ? (
            <EmptyBlock>当前没有可展示的工具。</EmptyBlock>
          ) : (
            <div className="workspace-card-grid">
              {visibleTools.map((tool) => (
                <ToolCard
                  tool={tool}
                  actionLabel={tool.enabled ? "已启用" : "已停用"}
                  onUpdateTool={props.onUpdateTool}
                  key={tool.name}
                />
              ))}
            </div>
          )}
        </section>
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
  readonly savingModel?: boolean;
  readonly savingWorkspace?: boolean;
  readonly onSaveModel: () => void;
  readonly onCreatePresetProfile: (preset: ModelProviderPreset) => void;
  readonly onCreateCustomProfile: () => void;
  readonly onActivateProfile: (profileId: string) => void;
  readonly onFetchModels: () => void;
  readonly modelCatalog?: ModelProviderModelCatalog;
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
          <button type="button" className={`sidebar-action ${activeTab === id ? "selected" : ""}`} key={id} onClick={() => setActiveTab(id)}>
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
                  <SettingRow label="当前配置" description="选择已保存的模型厂商配置。" control={<select className="settings-input" value={props.config?.config?.profileId ?? ""} onChange={(event) => props.onActivateProfile(event.target.value)}>{(props.config?.profiles ?? []).length === 0 && <option value="">默认配置</option>}{(props.config?.profiles ?? []).map((profile) => <option value={profile.profileId} key={profile.profileId}>{profile.label ?? profile.profileId}</option>)}</select>} />
                  <SettingRow label="名称" description="用于区分不同厂商或网关。" control={<input className="settings-input" value={props.modelForm.label} onChange={(event) => props.setModelForm({ ...props.modelForm, label: event.target.value })} />} />
                  <SettingRow label="Base URL" description="OpenAI SDK baseURL，按厂商要求填写，不自动假设 /v1。" control={<input className="settings-input" value={props.modelForm.baseUrl} onChange={(event) => props.setModelForm({ ...props.modelForm, baseUrl: event.target.value })} />} />
                  <SettingRow label="模型名" description="默认使用的模型，可从厂商模型列表选择。" control={<input className="settings-input" value={props.modelForm.model} onChange={(event) => props.setModelForm({ ...props.modelForm, model: event.target.value })} />} />
                  <SettingRow label="运行模式" description="选择是否启用已配置的模型服务。" control={<select className="settings-input" value={props.aiMode} onChange={(event) => props.setAiMode(event.target.value as "none" | "openai-compatible")}><option value="openai-compatible">启用模型</option><option value="none">停用模型</option></select>} />
                  <SettingRow label="API Key" description="密钥只进入本地 secret store。" control={<input className="settings-input" value={props.modelForm.apiKey} onChange={(event) => props.setModelForm({ ...props.modelForm, apiKey: event.target.value })} placeholder={props.config?.config?.secretConfigured ? "已保存，留空则不修改" : "请输入密钥"} />} last />
                </section>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={props.onSaveModel} disabled={props.savingModel}>{props.savingModel ? "保存中…" : "保存当前配置"}</Button>
                  <Button onClick={props.onCreateCustomProfile} disabled={props.savingModel}>保存为自定义厂商</Button>
                  <Button onClick={props.onFetchModels} disabled={props.savingModel || props.config?.config?.profileId === undefined}>获取模型列表</Button>
                </div>
                <ModelMarket presets={props.config?.modelProviderMarket?.presets ?? []} onCreatePresetProfile={props.onCreatePresetProfile} />
                <ModelCatalogPanel catalog={props.modelCatalog} selectedModel={props.modelForm.model} onSelectModel={(model) => props.setModelForm({ ...props.modelForm, model })} />
              </>
            )}
            {activeTab === "workspace" && (
              <>
                <section className="settings-panel-card">
                  <SettingRow label="文件夹" description="Agent 默认使用的工作区根目录。" control={<input className="settings-input" value={props.workspaceDirectory} onChange={(event) => props.setWorkspaceDirectory(event.target.value)} />} last />
                </section>
                <Button variant="primary" onClick={props.onSaveWorkspace} disabled={props.savingWorkspace}>{props.savingWorkspace ? "保存中…" : "保存工作目录"}</Button>
              </>
            )}
            {activeTab === "safety" && (
              <section className="settings-panel-card">
                <SettingRow label="密钥存储" description="密钥只进入本地 secret store，不会进入普通会话或运行记录。" control={<span className="settings-value">本地隔离</span>} />
                <SettingRow label="可见输出" description="普通视图只展示安全摘要、证据和结果，不展示原始输出。" control={<span className="settings-value">安全投影</span>} />
                <SettingRow label="确认边界" description="命令执行和删除文件需要确认；创建和编辑文件仍受工作区边界、大小限制和审计约束。" control={<span className="settings-value">按工具策略</span>} last />
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

function Button(props: { readonly variant?: ButtonVariant; readonly icon?: React.ReactNode; readonly children: React.ReactNode; readonly onClick?: () => void; readonly disabled?: boolean }): React.ReactElement {
  return (
    <button type="button" className={`workspace-button ${props.variant ?? "outline"}`} onClick={props.onClick} disabled={props.disabled}>
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
        <span className="muted-label">用于当前对话</span>
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
  readonly saving?: boolean;
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
        {props.configOpen && <Button variant="primary" onClick={props.onSaveTools} disabled={props.saving}>{props.saving ? "保存中…" : "保存"}</Button>}
      </div>
    </article>
  );
}

function ModelMarket(props: {
  readonly presets: readonly ModelProviderPreset[];
  readonly onCreatePresetProfile: (preset: ModelProviderPreset) => void;
}): React.ReactElement | null {
  if (props.presets.length === 0) return null;
  return (
    <section className="workspace-section">
      <SectionDivider label="常驻厂商" />
      <div className="workspace-card-grid">
        {props.presets.map((preset) => (
          <article className="workspace-card" key={preset.presetId}>
            <div className="workspace-card-header">
              <IconTile icon={<Cpu size={16} />} />
              <Badge tone="neutral">{preset.regionLabel ?? "OpenAI 兼容"}</Badge>
            </div>
            <div className="workspace-card-main">
              <h3 className="workspace-card-title">{preset.label}</h3>
              <p className="workspace-card-desc">{preset.description}</p>
            </div>
            <div className="workspace-card-footer">
              <span className="muted-label">{preset.defaultModel ?? "模型可同步"}</span>
              <button type="button" className="workspace-inline-action" onClick={() => props.onCreatePresetProfile(preset)}>添加</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ModelCatalogPanel(props: {
  readonly catalog?: ModelProviderModelCatalog;
  readonly selectedModel: string;
  readonly onSelectModel: (model: string) => void;
}): React.ReactElement | null {
  const catalog = props.catalog;
  if (catalog === undefined) return null;
  return (
    <section className="workspace-section">
      <SectionDivider label="模型列表" />
      {catalog.models.length === 0 ? (
        <EmptyBlock>该厂商没有返回可展示的模型。</EmptyBlock>
      ) : (
        <div className="workspace-card-grid">
          {catalog.models.slice(0, 12).map((model) => (
            <article className="workspace-card" key={model.id}>
              <div className="workspace-card-header">
                <IconTile icon={<Cpu size={16} />} />
                <Badge tone={model.id === props.selectedModel ? "success" : "neutral"}>{model.id === props.selectedModel ? "当前" : "可选"}</Badge>
              </div>
              <div className="workspace-card-main">
                <h3 className="workspace-card-title">{model.displayName}</h3>
                <p className="workspace-card-desc">{model.owner === undefined ? catalog.baseUrl : `归属：${model.owner}`}</p>
              </div>
              <div className="workspace-card-footer">
                <span className="muted-label">{model.createdAt === undefined ? "模型" : model.createdAt.slice(0, 10)}</span>
                <button type="button" className="workspace-inline-action" onClick={() => props.onSelectModel(model.id)}>选择</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ToolCard(props: {
  readonly tool: ToolCatalogItem;
  readonly actionLabel: string;
  readonly onUpdateTool: (toolName: string, enabled: boolean) => void;
}): React.ReactElement {
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
      </div>
      <div className="workspace-card-footer">
        <span className="muted-label">{toolMeta(props.tool)}</span>
        <span className="muted-label">{props.actionLabel}</span>
        <label className="workspace-switch" aria-label={`${copy.title}开关`}>
          <input
            type="checkbox"
            checked={props.tool.enabled}
            onChange={(event) => props.onUpdateTool(props.tool.name, event.target.checked)}
          />
          <span />
        </label>
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
  if (tab === "本地") return catalog.filter((tool) => tool.category === "filesystem" || tool.category === "terminal" || tool.category === "workspace");
  if (tab === "需要确认") return catalog.filter((tool) => tool.requiresConfirmation === true || tool.riskLevel === "high");
  return catalog;
}

function toolCopy(tool: ToolCatalogItem): { readonly title: string; readonly description: string } {
  const title = tool.displayName ?? "工具能力";
  return {
    title,
    description: tool.displayDescription ?? tool.description ?? "可供 Agent 在授权边界内调用的本地能力。",
  };
}

function toolMeta(tool: ToolCatalogItem): string {
  if (tool.requiresConfirmation === true || tool.riskLevel === "high") return tool.confirmationLabel ?? "需确认";
  return [tool.categoryLabel, tool.operationLabel].filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ") || "工具能力";
}

function providerName(provider: string): string {
  if (provider === "tavily") return "Tavily";
  if (provider === "none") return "未启用";
  return provider;
}
