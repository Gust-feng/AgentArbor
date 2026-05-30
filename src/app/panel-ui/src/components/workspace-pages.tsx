import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CloudCog,
  Database,
  Eye,
  EyeOff,
  FileSearch,
  Globe2,
  LayoutList,
  LockKeyhole,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type {
  ConfigResponse,
  ModelProviderModelCatalog,
  ModelProviderPreset,
  SkillDefinition,
  ToolCatalogItem,
  ToolsResponse,
} from "../types";
import { compact, relativeTime } from "../text";
import { resolveModelIconSvg } from "../model-icons";
import {
  modelProviderDisplayName,
  modelProviderSortRank,
  resolveModelProviderIdentity,
  resolveModelProviderLogo,
  type ModelProviderIdentity,
} from "../model-provider-logos";

type ModelForm = {
  readonly profileId: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly protocolKind: string;
  readonly model: string;
  readonly apiKey: string;
  readonly apiKeyCleared: boolean;
};

type ToolForm = {
  readonly provider: string;
  readonly tavilyApiKey: string;
  readonly maxResults: string;
};

export type SettingsGroup = "general" | "models" | "workspace" | "confirmation" | "appearance";

const SKILL_TABS = ["全部", "已启用", "已停用"] as const;
const TOOL_TABS = ["全部", "已启用", "本地", "需要确认"] as const;
const SAVED_API_KEY_MASK = "****************";

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
  const visibleTools = useMemo(() => filterTools(catalog, activeTab), [catalog, activeTab]);
  return (
    <section className="workspace-page" aria-label="工具">
      <div className="workspace-shell">
        <PageHeader
          title="工具"
          subtitle="管理助手可调用的本地与网络能力"
          actions={
            <button type="button" className="page-action-button" onClick={() => setConfigOpen((value) => !value)}>
              <Plus size={14} />
              接入工具
            </button>
          }
        />
        <TabBar tabs={TOOL_TABS} activeTab={activeTab} onChange={setActiveTab} />
        <section className="tools-table">
          <WebSearchRow
            open={configOpen}
            onToggle={() => setConfigOpen((value) => !value)}
            tools={props.tools}
            toolForm={props.toolForm}
            setToolForm={props.setToolForm}
            saving={props.saving}
            onSaveTools={props.onSaveTools}
          />
          {visibleTools.length === 0 ? (
            <EmptyBlock>当前没有可展示的工具。</EmptyBlock>
          ) : (
            visibleTools.map((tool) => (
              <ToolRow tool={tool} onUpdateTool={props.onUpdateTool} key={tool.name} />
            ))
          )}
        </section>
      </div>
    </section>
  );
}

export function SettingsDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGroup?: SettingsGroup;
  readonly config?: ConfigResponse;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly savingModel?: boolean;
  readonly onSaveModel: (form?: ModelForm) => Promise<void>;
  readonly onCreateCustomProfile: () => void;
  readonly onFetchModels: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly onSaveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly onRevealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
  readonly onSaveWorkspace: (workspaceDirectory?: string) => void;
}): React.ReactElement | null {
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("general");
  useEffect(() => {
    if (props.open) {
      setActiveGroup(props.initialGroup ?? "general");
    }
  }, [props.open, props.initialGroup]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  useEffect(() => {
    if (!props.open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [props.open]);

  if (!props.open) return null;

  const activeInfo = SETTINGS_GROUPS.find((group) => group.id === activeGroup) ?? SETTINGS_GROUPS[0]!;
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <button type="button" className="settings-backdrop" aria-label="关闭设置" onClick={props.onClose} />
      <section className="settings-dialog">
        <aside className="settings-sidebar">
          <button type="button" className="settings-close-button" onClick={props.onClose} aria-label="关闭">
            <X size={16} />
          </button>
          <nav aria-label="设置分组">
            {SETTINGS_GROUPS.map((group) => (
              <button
                type="button"
                key={group.id}
                className={group.id === activeGroup ? "active" : ""}
                onClick={() => setActiveGroup(group.id)}
              >
                {group.icon}
                <span>{group.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="settings-main">
          <header>
            <h2>{activeInfo.label}</h2>
          </header>
          <div className={`settings-content ${activeGroup === "models" ? "model-settings-content" : ""}`}>
            {activeGroup === "general" && <GeneralSettings config={props.config} />}
            {activeGroup === "models" && (
              <ModelSettings
                config={props.config}
                modelForm={props.modelForm}
                setModelForm={props.setModelForm}
                saving={props.savingModel}
                onSave={props.onSaveModel}
                onCreateCustomProfile={props.onCreateCustomProfile}
                onFetchModels={props.onFetchModels}
                onSaveModelCatalog={props.onSaveModelCatalog}
                onRevealModelApiKey={props.onRevealModelApiKey}
                modelCatalogs={props.modelCatalogs}
              />
            )}
            {activeGroup === "workspace" && (
              <WorkspaceSettings
                workspaceDirectory={props.workspaceDirectory}
                setWorkspaceDirectory={props.setWorkspaceDirectory}
                onSave={props.onSaveWorkspace}
              />
            )}
            {activeGroup === "confirmation" && <ConfirmationSettings />}
            {activeGroup === "appearance" && <AppearanceSettings />}
          </div>
        </div>
      </section>
    </div>
  );
}

function PageHeader(props: { readonly title: string; readonly subtitle?: string; readonly actions?: React.ReactNode }): React.ReactElement {
  return (
    <header className="workspace-page-header">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      {props.actions && <div>{props.actions}</div>}
    </header>
  );
}

function SearchBox(props: { readonly value: string; readonly onChange: (value: string) => void; readonly placeholder: string }): React.ReactElement {
  return (
    <label className="workspace-search">
      <Search size={14} />
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} />
    </label>
  );
}

function TabBar<T extends string>(props: { readonly tabs: readonly T[]; readonly activeTab: T; readonly onChange: (tab: T) => void }): React.ReactElement {
  return (
    <div className="workspace-tabs">
      {props.tabs.map((tab) => (
        <button type="button" className={props.activeTab === tab ? "active" : ""} onClick={() => props.onChange(tab)} key={tab}>
          {tab}
        </button>
      ))}
    </div>
  );
}

function EmptyBlock({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <div className="workspace-empty">{children}</div>;
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

function WebSearchRow(props: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly saving?: boolean;
  readonly onSaveTools: () => void;
}): React.ReactElement {
  const configured = props.tools?.tools?.webSearch?.secretConfigured === true;
  const current = props.tools?.tools?.webSearch?.provider ?? props.toolForm.provider;
  return (
    <article className="tool-row web-search-row">
      <div className="tool-main">
        <IconTile icon={<Globe2 size={17} />} />
        <div>
          <h2>网页搜索</h2>
          <p>当前服务：{providerName(current)}。用于搜索网页资料并返回资料摘要。</p>
        </div>
      </div>
      <div className="tool-meta">
        <Pill tone={configured ? "success" : "neutral"}>{configured ? "已配置" : "待配置"}</Pill>
        <span>网络资料</span>
      </div>
      <div className="tool-actions">
        <button type="button" onClick={props.onToggle}>{props.open ? "收起" : "配置"}</button>
      </div>
      {props.open && (
        <div className="tool-config-panel">
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
      )}
    </article>
  );
}

function ToolRow(props: {
  readonly tool: ToolCatalogItem;
  readonly onUpdateTool: (toolName: string, enabled: boolean) => void;
}): React.ReactElement {
  const copy = toolCopy(props.tool);
  const enabled = props.tool.enabled && props.tool.available !== false;
  return (
    <article className="tool-row">
      <div className="tool-main">
        <IconTile icon={toolIcon(props.tool)} />
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
      </div>
      <div className="tool-meta">
        <Pill tone={enabled ? "success" : "neutral"}>{enabled ? "可用" : "不可用"}</Pill>
        <span>{toolMeta(props.tool)}</span>
      </div>
      <div className="tool-actions">
        <Toggle checked={props.tool.enabled} onChange={(checked) => props.onUpdateTool(props.tool.name, checked)} label={`${copy.title}开关`} />
      </div>
    </article>
  );
}

function ModelSettings(props: {
  readonly config?: ConfigResponse;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly saving?: boolean;
  readonly onSave: (form?: ModelForm) => Promise<void>;
  readonly onCreateCustomProfile: () => void;
  readonly onFetchModels: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly onSaveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly onRevealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [fetchBusy, setFetchBusy] = useState(false);
  const [modelsFetchBusy, setModelsFetchBusy] = useState(false);
  const [fetchedCatalogs, setFetchedCatalogs] = useState<Record<string, ModelProviderModelCatalog>>({});
  const [modelNameDrafts, setModelNameDrafts] = useState<Record<string, string>>({});
  const [modelQuery, setModelQuery] = useState("");
  const [selectedModelRowId, setSelectedModelRowId] = useState<string | undefined>(undefined);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const fetchSeqRef = useRef(0);
  const revealRef = useRef(props.onRevealModelApiKey);
  revealRef.current = props.onRevealModelApiKey;
  const modelFormRef = useRef(props.modelForm);
  modelFormRef.current = props.modelForm;
  const activeProfileId = props.config?.config?.profileId ?? "";
  const items = useMemo(() => modelProviderItems(props.config), [props.config]);
  const [selectedKey, setSelectedKey] = useState("");
  const filteredItems = items.filter((item) => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return true;
    return [item.title, item.model, item.baseUrl].some((value) => value.toLowerCase().includes(normalized));
  });
  const selectedItem =
    items.find((item) => item.key === selectedKey) ??
    items.find((item) => item.profileId === activeProfileId) ??
    items[0];
  const selectedActive = selectedItem?.profileId !== undefined && selectedItem.profileId === activeProfileId;
  const selectedSecretConfigured = selectedItem?.profile?.secretConfigured === true || (selectedActive && props.config?.config?.secretConfigured === true);
  const selectedCatalog = selectedItem?.profileId === undefined ? undefined : props.modelCatalogs?.[selectedItem.profileId];
  const catalogModels = useMemo(
    () => modelCatalogItemsWithConfiguredModel(selectedCatalog?.models ?? [], selectedItem?.model, selectedItem?.title ?? selectedCatalog?.label ?? "model"),
    [selectedCatalog?.models, selectedCatalog?.label, selectedItem?.model, selectedItem?.title]
  );
  const savedModelIds = useMemo(() => new Set(catalogModels.map((model) => model.id)), [catalogModels]);
  const fetchedCatalog = selectedItem?.profileId === undefined ? undefined : fetchedCatalogs[selectedItem.profileId];
  const fetchedCandidates = (fetchedCatalog?.models ?? []).filter((model) => !savedModelIds.has(model.id));
  const normalizedModelQuery = modelQuery.trim().toLowerCase();
  const hasModelQuery = normalizedModelQuery.length > 0;
  const visibleCatalogModels = filterModelCatalogItems(catalogModels, normalizedModelQuery);
  const visibleFetchedCandidates = filterModelCatalogItems(fetchedCandidates, normalizedModelQuery);
  const showSavedCount = catalogModels.length > 0 || hasModelQuery;
  const showModelSearch = catalogModels.length > 0 || fetchedCandidates.length > 0 || hasModelQuery;
  const selectedProfileId = selectedItem?.profileId;
  const selectedModelIconSvg = selectedItem === undefined ? undefined : resolveModelIconSvg(resolveModelProviderIdentity(selectedItem));
  const hasKey = props.modelForm.apiKey.length > 0;
  const hasApiKeyAction = hasKey || selectedSecretConfigured;

  useEffect(() => {
    if (items.length === 0) return;
    if (selectedKey.length > 0 && items.some((item) => item.key === selectedKey)) return;
    setSelectedKey(items.find((item) => item.profileId === activeProfileId)?.key ?? items[0]!.key);
  }, [activeProfileId, items, selectedKey]);

  useEffect(() => {
    if (selectedItem === undefined) return;
    const seq = ++fetchSeqRef.current;
    const nextForm = modelFormFromProviderItem(selectedItem);
    setRevealed(false);
    setModelQuery("");
    setSelectedModelRowId(nextForm.model.trim().length === 0 ? undefined : nextForm.model);
    props.setModelForm(nextForm);

    if (!selectedSecretConfigured || selectedProfileId === undefined) {
      setFetchBusy(false);
      return;
    }

    setFetchBusy(true);
    void revealRef.current(selectedProfileId).then((key) => {
      if (seq !== fetchSeqRef.current) return;
      setFetchBusy(false);
      if (typeof key === "string" && key.length > 0) {
        setRevealed(false);
        if (modelFormRef.current.profileId === nextForm.profileId && modelFormRef.current.apiKey.length === 0) {
          props.setModelForm({ ...modelFormRef.current, apiKey: key, apiKeyCleared: false });
        }
      }
    }).catch(() => {
      if (seq === fetchSeqRef.current) setFetchBusy(false);
    });
  }, [selectedItem?.key, selectedProfileId, selectedSecretConfigured]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function scheduleModelSave(nextForm: ModelForm): void {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      void props.onSave(nextForm).catch(() => undefined);
    }, 700);
  }

  async function saveModelImmediately(nextForm: ModelForm): Promise<void> {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    await props.onSave(nextForm);
  }

  function selectItem(item: ModelProviderListItem): void {
    setSelectedKey(item.key);
  }

  function updateModelForm(patch: Partial<ModelForm>): void {
    const nextForm = { ...props.modelForm, ...patch };
    props.setModelForm(nextForm);
    scheduleModelSave(nextForm);
  }

  async function clearApiKey(): Promise<void> {
    if (selectedItem === undefined) return;
    fetchSeqRef.current += 1;
    const nextForm = {
      ...props.modelForm,
      profileId: modelProviderFormId(selectedItem),
      apiKey: "",
      apiKeyCleared: selectedSecretConfigured || hasKey,
    };
    setRevealed(false);
    props.setModelForm(nextForm);
    if (selectedItem.profileId !== undefined || selectedSecretConfigured) {
      await saveModelImmediately(nextForm).catch(() => undefined);
      return;
    }
  }

  async function fetchSelectedModels(): Promise<void> {
    if (selectedItem === undefined) return;
    const profileId = selectedItem.profileId ?? modelProviderFormId(selectedItem);
    setModelsFetchBusy(true);
    try {
      if (selectedItem.profileId === undefined) {
        await props.onSave(props.modelForm);
      }
      const catalog = await props.onFetchModels(profileId);
      if (catalog !== undefined) {
        setFetchedCatalogs((previous) => ({ ...previous, [catalog.profileId]: catalog }));
      }
    } catch {
      // The parent owns user-facing error state.
    } finally {
      setModelsFetchBusy(false);
    }
  }

  async function saveCatalogModels(models: readonly ModelProviderModelItem[]): Promise<void> {
    if (selectedItem?.profileId === undefined) return;
    const catalog = selectedCatalog ?? fetchedCatalog ?? {
      profileId: selectedItem.profileId,
      label: selectedItem.title,
      baseUrl: selectedItem.baseUrl,
      modelsPath: "/models",
      fetchedAt: new Date().toISOString(),
      models: [],
    };
    await props.onSaveModelCatalog(selectedItem.profileId, {
      ...catalog,
      profileId: selectedItem.profileId,
      label: catalog.label ?? selectedItem.title,
      baseUrl: catalog.baseUrl || selectedItem.baseUrl,
      fetchedAt: new Date().toISOString(),
      models,
    });
  }

  async function addCatalogModel(model: ModelProviderModelItem): Promise<void> {
    if (selectedItem?.profileId === undefined) return;
    const profileId = selectedItem.profileId;
    const nextModels = [...catalogModels.filter((item) => item.id !== model.id), model];
    try {
      await saveCatalogModels(nextModels);
    } catch {
      return;
    }
    setFetchedCatalogs((previous) => {
      const current = previous[profileId];
      if (current === undefined) return previous;
      return {
        ...previous,
        [profileId]: {
          ...current,
          models: current.models.filter((item) => item.id !== model.id),
        },
      };
    });
  }

  async function removeCatalogModel(modelId: string): Promise<void> {
    const nextModels = catalogModels.filter((model) => model.id !== modelId);
    try {
      await saveCatalogModels(nextModels);
    } catch {
      return;
    }
    if (props.modelForm.model === modelId) {
      const nextForm = { ...props.modelForm, model: "" };
      props.setModelForm(nextForm);
      setSelectedModelRowId(undefined);
      await saveModelImmediately(nextForm).catch(() => undefined);
    }
  }

  function selectCatalogModel(modelId: string): void {
    setSelectedModelRowId(modelId);
    if (props.modelForm.model === modelId) return;
    const nextForm = { ...props.modelForm, model: modelId };
    props.setModelForm(nextForm);
    void saveModelImmediately(nextForm).catch(() => undefined);
  }

  async function commitModelDisplayName(modelId: string, value: string): Promise<void> {
    const model = catalogModels.find((item) => item.id === modelId);
    if (model === undefined) return;
    const displayName = value.trim().length === 0 ? model.id : value.trim();
    if (displayName === model.displayName) {
      setModelNameDrafts((previous) => removeRecordKey(previous, modelId));
      return;
    }
    try {
      await saveCatalogModels(catalogModels.map((item) => item.id === modelId ? { ...item, displayName } : item));
      setModelNameDrafts((previous) => removeRecordKey(previous, modelId));
    } catch {
      // The parent owns user-facing error state.
    }
  }

  if (selectedItem === undefined) {
    return (
      <div className="settings-provider-manager empty">
        <EmptyBlock>暂无模型服务。请添加一个模型服务。</EmptyBlock>
      </div>
    );
  }

  return (
    <div className="settings-provider-manager">
      <aside className="provider-list-pane" aria-label="模型服务">
        <label className="provider-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" />
        </label>
        <div className="provider-list">
          {filteredItems.map((item) => {
            const selected = item.key === selectedItem.key;
            return (
              <article className={`provider-row ${selected ? "selected" : ""}`} key={item.key}>
                <button type="button" className="provider-row-main" onClick={() => selectItem(item)}>
                  <ProviderLogo item={item} />
                  <span>
                    <strong>{item.title}</strong>
                  </span>
                </button>
              </article>
            );
          })}
        </div>
        <button type="button" className="provider-add-button" onClick={props.onCreateCustomProfile} disabled={props.saving}>
          <Plus size={16} />
          添加
        </button>
      </aside>

      <section className="provider-detail-pane" aria-label="模型服务详情">
        <header className="provider-detail-header">
          <ProviderLogo item={selectedItem} large />
          <div>
            <h3>{selectedItem.title}</h3>
          </div>
        </header>

        <div className="provider-detail-divider" />

        <div className="provider-form">
          <label>
            <span>API Key</span>
            <div className="api-key-field">
              <input
                type={revealed ? "text" : "password"}
                className={revealed ? undefined : "api-key-input-masked"}
                value={props.modelForm.apiKey}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  const nextApiKey = event.target.value;
                  const nextForm = {
                    ...props.modelForm,
                    apiKey: nextApiKey,
                    apiKeyCleared: nextApiKey.length === 0 && selectedSecretConfigured,
                  };
                  props.setModelForm(nextForm);
                  scheduleModelSave(nextForm);
                }}
                placeholder={fetchBusy ? "加载中…" : "请输入密钥"}
              />
              <span className="api-key-actions">
                <button
                  type="button"
                  className="api-key-action"
                  aria-label={revealed ? "隐藏 API Key" : "查看 API Key"}
                  title={revealed ? "隐藏" : "查看"}
                  disabled={!hasApiKeyAction || fetchBusy || props.saving}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => setRevealed((value) => !value)}
                >
                  {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button
                  type="button"
                  className="api-key-action"
                  aria-label="清空 API Key"
                  title="清空"
                  disabled={!hasApiKeyAction || props.saving}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => void clearApiKey()}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
          </label>
          <label>
            <span>Base URL</span>
            <div className="provider-base-url-field">
              <input
                value={props.modelForm.baseUrl || selectedItem.baseUrl}
                onChange={(event) => {
                  updateModelForm({ baseUrl: event.target.value });
                }}
                placeholder="https://api.example.com/v1"
              />
            </div>
          </label>
          {selectedItem.preset === undefined && (
            <details className="provider-advanced-options">
              <summary>高级兼容设置</summary>
              <label>
                <span>协议</span>
                <select
                  value={props.modelForm.protocolKind || selectedItem.protocolKind}
                  aria-label="协议"
                  onChange={(event) => updateModelForm({ protocolKind: event.target.value })}
                >
                  {requestPathOptionsForProvider(selectedItem).map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </details>
          )}
        </div>

        <section className="model-list-panel">
          <div className="model-panel-toolbar">
            <div className="model-panel-title">
              <strong>模型列表</strong>
              {showSavedCount && <span>{formatModelCount(visibleCatalogModels.length, catalogModels.length, hasModelQuery)}</span>}
            </div>
            <div className="model-panel-actions">
              {showModelSearch && (
                <label className="model-search-field">
                  <Search size={14} />
                  <input
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder="搜索模型"
                    spellCheck={false}
                  />
                </label>
              )}
              <button type="button" onClick={() => void fetchSelectedModels()} disabled={props.saving || modelsFetchBusy}>
                <RefreshCw size={14} />
                {modelsFetchBusy ? "获取中" : "获取模型"}
              </button>
            </div>
          </div>
          <div className="model-section">
            {visibleCatalogModels.length === 0 && catalogModels.length > 0 ? (
              <div className="model-empty compact">无匹配模型</div>
            ) : (
              catalogModels.length > 0 && (
                <div className="model-list">
                  {visibleCatalogModels.map((model) => (
                    <div
                      className={`model-list-row saved ${model.id === selectedModelRowId ? "selected" : ""}`}
                      key={model.id}
                      role="option"
                      aria-selected={model.id === selectedModelRowId}
                      tabIndex={0}
                      onClick={() => selectCatalogModel(model.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        selectCatalogModel(model.id);
                      }}
                    >
                      <ModelIcon svg={selectedModelIconSvg} />
                      <div className="model-row-copy">
                        <input
                          className="model-name-input"
                          value={modelNameDrafts[model.id] ?? model.displayName ?? model.id}
                          placeholder={model.id}
                          aria-label={`模型名称 ${model.id}`}
                          spellCheck={false}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setModelNameDrafts((previous) => ({ ...previous, [model.id]: nextValue }));
                          }}
                          onFocus={() => selectCatalogModel(model.id)}
                          onBlur={(event) => {
                            void commitModelDisplayName(model.id, event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                        />
                        <small>{model.id}</small>
                      </div>
                      <button
                        type="button"
                        className="model-row-action"
                        aria-label={`移除 ${model.displayName}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeCatalogModel(model.id);
                        }}
                        disabled={props.saving}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
          {fetchedCatalog !== undefined && (
            <div className="model-section model-candidate-section">
              <header>
                <strong>可添加</strong>
                <span>{formatModelCount(visibleFetchedCandidates.length, fetchedCandidates.length, hasModelQuery)}</span>
              </header>
              {fetchedCandidates.length === 0 ? (
                <div className="model-empty compact">没有新的模型</div>
              ) : visibleFetchedCandidates.length === 0 ? (
                <div className="model-empty compact">无匹配模型</div>
              ) : (
                <div className="model-list">
                  {visibleFetchedCandidates.map((model) => (
                    <div className="model-list-row" key={model.id}>
                      <ModelIcon svg={selectedModelIconSvg} />
                      <div className="model-candidate-copy">
                        <strong>{model.displayName === model.id ? model.id : model.displayName}</strong>
                        {model.displayName !== model.id && <small>{model.id}</small>}
                      </div>
                      <button
                        type="button"
                        className="model-row-add"
                        onClick={() => void addCatalogModel(model)}
                        disabled={props.saving}
                      >
                        添加
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

      </section>
    </div>
  );
}

function ModelIcon({ svg }: { readonly svg?: string }): React.ReactElement {
  return (
    <span className="model-row-icon" aria-hidden="true">
      {svg === undefined ? <CloudCog size={14} /> : <span dangerouslySetInnerHTML={{ __html: svg }} />}
    </span>
  );
}

function removeRecordKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next: Record<string, T> = { ...record };
  delete next[key];
  return next;
}

type ModelProviderProfileItem = NonNullable<ConfigResponse["profiles"]>[number];
type ModelProviderModelItem = ModelProviderModelCatalog["models"][number];

function filterModelCatalogItems(
  models: readonly ModelProviderModelItem[],
  normalizedQuery: string
): readonly ModelProviderModelItem[] {
  if (normalizedQuery.length === 0) return models;
  return models.filter((model) => [model.displayName, model.id, model.owner ?? ""].some((value) => value.toLowerCase().includes(normalizedQuery)));
}

function formatModelCount(visible: number, total: number, filtered: boolean): string {
  return filtered ? `${visible}/${total}` : String(total);
}

type ModelProviderListItem = {
  readonly key: string;
  readonly title: string;
  readonly vendor?: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly protocolKind: string;
  readonly profileId?: string;
  readonly profile?: ModelProviderProfileItem;
  readonly presetId?: string;
  readonly preset?: ModelProviderPreset;
};

function modelProviderItems(
  config: ConfigResponse | undefined
): readonly ModelProviderListItem[] {
  const profiles = (config?.profiles ?? []).filter(isOpenAIFormatProfile);
  const presets = (config?.modelProviderMarket?.presets ?? []).filter(isOpenAIFormatPreset);
  const activeProfileId = config?.config?.profileId;
  const profileBindings = profiles.map((profile) => ({
    profile,
    identity: resolveModelProviderIdentity({
      profileId: profile.profileId,
      title: profile.label,
      baseUrl: profile.baseUrl,
      model: profile.model,
    }),
  }));
  const boundProfileIds = new Set<string>();
  const presetItems = presets.map((preset) => {
    const presetIdentity = resolveModelProviderIdentity(preset);
    const bindings = profileBindings.filter((item) => {
      if (item.profile.profileId === preset.presetId) return true;
      return presetIdentity !== "unknown" && item.identity === presetIdentity;
    });
    for (const item of bindings) {
      if (item.profile.profileId !== undefined) {
        boundProfileIds.add(item.profile.profileId);
      }
    }
    const binding =
      bindings.find((item) => item.profile.profileId === activeProfileId) ??
      bindings.find((item) => item.profile.profileId === preset.presetId) ??
      bindings[0];
    if (binding?.profile.profileId !== undefined) {
      boundProfileIds.add(binding.profile.profileId);
    }
    const profile = binding?.profile;
    const configuredModel = profile?.model ?? preset.defaultModel ?? "";
    return {
      key: profile?.profileId === undefined ? `preset:${preset.presetId}` : `profile:${profile.profileId}`,
      title: presetIdentity === "unknown" ? preset.label : modelProviderDisplayName(presetIdentity),
      vendor: preset.vendor,
      model: configuredModel,
      baseUrl: profile === undefined ? preset.baseUrl : visibleProfileBaseUrl(profile),
      protocolKind: profile?.protocolKind ?? preset.protocolKind,
      profileId: profile?.profileId,
      profile,
      presetId: preset.presetId,
      preset,
    } satisfies ModelProviderListItem;
  });
  const customItems = profileBindings
    .filter((item) => item.profile.profileId === undefined || !boundProfileIds.has(item.profile.profileId))
    .map(({ profile, identity }) => {
      const configuredModel = profile.model ?? "";
      return {
        key: `profile:${profile.profileId ?? profile.label ?? profile.baseUrl ?? profile.model ?? "custom"}`,
        title: friendlyProfileTitle(profile, identity),
        model: configuredModel,
        baseUrl: visibleProfileBaseUrl(profile),
        protocolKind: profile.protocolKind ?? "openai_compatible_chat_completions",
        profileId: profile.profileId,
        profile,
      } satisfies ModelProviderListItem;
    });
  return [...presetItems, ...customItems]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rankDelta = modelProviderSortRank(left.item) - modelProviderSortRank(right.item);
      return rankDelta === 0 ? left.index - right.index : rankDelta;
    })
    .map(({ item }) => item);
}

function isOpenAIFormatPreset(preset: ModelProviderPreset): boolean {
  return preset.providerKind === "openai_compatible" &&
    (preset.protocolKind === "openai_responses" || preset.protocolKind === "openai_compatible_chat_completions");
}

function modelCatalogItemsWithConfiguredModel(
  models: readonly ModelProviderModelItem[],
  configuredModel: string | undefined,
  owner: string
): readonly ModelProviderModelItem[] {
  const modelId = configuredModel?.trim();
  if (modelId === undefined || modelId.length === 0 || models.some((model) => model.id === modelId)) {
    return models;
  }
  return [
    {
      id: modelId,
      displayName: modelId,
      owner,
    },
    ...models,
  ];
}

function isOpenAIFormatProfile(profile: ModelProviderProfileItem): boolean {
  return profile.providerKind === "openai_compatible" &&
    (profile.protocolKind === "openai_responses" || profile.protocolKind === "openai_compatible_chat_completions");
}

function modelProviderFormId(item: ModelProviderListItem): string {
  return item.profileId ?? item.presetId ?? item.key;
}

function modelFormFromProviderItem(item: ModelProviderListItem): ModelForm {
  return {
    profileId: modelProviderFormId(item),
    label: item.title,
    baseUrl: item.baseUrl,
    protocolKind: item.protocolKind,
    model: item.model,
    apiKey: "",
    apiKeyCleared: false,
  };
}

function requestPathOptionsForProvider(item: ModelProviderListItem): readonly { readonly value: string; readonly label: string }[] {
  const providerKind = item.profile?.providerKind ?? item.preset?.providerKind;
  if (providerKind === "anthropic") {
    return [{ value: "anthropic_messages", label: "/v1/messages" }];
  }
  if (providerKind === "gemini") {
    return [{ value: "gemini_generate_content", label: "/generateContent" }];
  }
  if (providerKind === "ollama") {
    return [{ value: "ollama_generate", label: "/api/generate" }];
  }
  return [
    { value: "openai_responses", label: "/responses" },
    { value: "openai_compatible_chat_completions", label: "/chat/completions" },
  ];
}

function friendlyProfileTitle(profile: ModelProviderProfileItem, identity: ModelProviderIdentity): string {
  const raw = profile.label ?? profile.profileId ?? "";
  if (identity !== "unknown") return modelProviderDisplayName(identity);
  if (raw.trim().length === 0) return "自定义厂商";
  if (raw.toLowerCase() === "default") return "OpenAI";
  if (raw.toLowerCase() === "custom") return "自定义厂商";
  return raw;
}

function visibleProfileBaseUrl(profile: ModelProviderProfileItem): string {
  const baseUrl = profile.baseUrl ?? "";
  if (profile.profileId === "default" && (baseUrl.length === 0 || baseUrl === "https://api.openai.com")) {
    return "https://api.openai.com/v1";
  }
  return baseUrl;
}

function ProviderLogo({ item, large = false }: { readonly item: ModelProviderListItem; readonly large?: boolean }): React.ReactElement {
  const logo = resolveModelProviderLogo(item);
  return (
    <span className={`provider-logo ${logo.tone} ${large ? "large" : ""}`}>
      <span className={`provider-logo-svg ${logo.tone}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo.svg }} />
    </span>
  );
}

function GeneralSettings({ config }: { readonly config?: ConfigResponse }): React.ReactElement {
  return (
    <section className="settings-card">
      <h3>常规</h3>
      <SettingRow label="当前厂商"><span className="settings-value">{visibleConfigProviderTitle(config)}</span></SettingRow>
      <SettingRow label="工具调用"><span className="settings-value">{config?.capabilities?.modelCapabilities?.supportsToolCalling === false ? "当前模型未声明支持" : "按模型能力"}</span></SettingRow>
    </section>
  );
}

function visibleConfigProviderTitle(config: ConfigResponse | undefined): string {
  const activeModel = config?.capabilities?.activeModel;
  const modelConfig = config?.config;
  const identity = resolveModelProviderIdentity({
    title: activeModel?.label ?? modelConfig?.label,
    profileId: modelConfig?.profileId,
    baseUrl: modelConfig?.baseUrl,
    model: modelConfig?.model ?? activeModel?.model,
  });
  return identity === "unknown" ? activeModel?.label ?? modelConfig?.label ?? "未配置" : modelProviderDisplayName(identity);
}

function WorkspaceSettings(props: {
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSave: (workspaceDirectory?: string) => void;
}): React.ReactElement {
  const saveTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function scheduleWorkspaceSave(nextWorkspaceDirectory: string): void {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      props.onSave(nextWorkspaceDirectory);
    }, 700);
  }

  return (
    <section className="settings-card">
      <h3>工作目录</h3>
      <SettingRow label="文件夹">
        <input
          value={props.workspaceDirectory}
          onChange={(event) => {
            const nextWorkspaceDirectory = event.target.value;
            props.setWorkspaceDirectory(nextWorkspaceDirectory);
            scheduleWorkspaceSave(nextWorkspaceDirectory);
          }}
        />
      </SettingRow>
      <p>助手只能在授权工作区边界内读取和写入。涉及命令执行或删除文件时仍会请求确认。</p>
    </section>
  );
}

function ConfirmationSettings(): React.ReactElement {
  return (
    <section className="settings-card">
      <h3>确认</h3>
      <SettingRow label="命令执行"><span className="settings-value">需要确认</span></SettingRow>
      <SettingRow label="删除文件"><span className="settings-value">需要确认</span></SettingRow>
      <SettingRow label="创建和编辑文件"><span className="settings-value">工作区内直接执行</span></SettingRow>
    </section>
  );
}

function AppearanceSettings(): React.ReactElement {
  return (
    <section className="settings-card">
      <h3>界面</h3>
      <SettingRow label="密度"><span className="settings-value">标准</span></SettingRow>
      <SettingRow label="动效"><span className="settings-value">跟随系统</span></SettingRow>
    </section>
  );
}

function SettingRow(props: { readonly label: string; readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div className="settings-row">
      <span>{props.label}</span>
      <div>{props.children}</div>
    </div>
  );
}

function IconTile({ icon }: { readonly icon: React.ReactNode }): React.ReactElement {
  return <div className="icon-tile">{icon}</div>;
}

function Toggle(props: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly label: string }): React.ReactElement {
  return (
    <button type="button" className={`toggle ${props.checked ? "checked" : ""}`} aria-label={props.label} aria-pressed={props.checked} onClick={() => props.onChange(!props.checked)}>
      <span />
    </button>
  );
}

function Pill(props: { readonly tone: "success" | "neutral" | "warning"; readonly children: React.ReactNode }): React.ReactElement {
  return <span className={`pill ${props.tone}`}>{props.children}</span>;
}

function filterTools(catalog: readonly ToolCatalogItem[], tab: (typeof TOOL_TABS)[number]): readonly ToolCatalogItem[] {
  if (tab === "已启用") return catalog.filter((tool) => tool.enabled && tool.available !== false);
  if (tab === "本地") return catalog.filter((tool) => tool.category === "filesystem" || tool.category === "terminal" || tool.category === "workspace");
  if (tab === "需要确认") return catalog.filter((tool) => tool.requiresConfirmation === true || tool.riskLevel === "high");
  return catalog;
}

function toolCopy(tool: ToolCatalogItem): { readonly title: string; readonly description: string } {
  return {
    title: tool.displayName ?? fallbackToolName(tool.name),
    description: tool.displayDescription ?? tool.description ?? "可供助手在授权边界内调用的能力。",
  };
}

function toolMeta(tool: ToolCatalogItem): string {
  if (tool.requiresConfirmation === true || tool.riskLevel === "high") return tool.confirmationLabel ?? "需确认";
  return [tool.categoryLabel, tool.operationLabel].filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ") || "工具能力";
}

function toolIcon(tool: ToolCatalogItem): React.ReactNode {
  if (tool.category === "filesystem" || tool.name.includes("file")) return <FileSearch size={17} />;
  if (tool.category === "terminal" || tool.name.includes("command")) return <Wrench size={17} />;
  if (tool.category === "web" || tool.name.includes("search") || tool.name.includes("browser")) return <Globe2 size={17} />;
  return <Wrench size={17} />;
}

function fallbackToolName(name: string): string {
  if (name.includes("read_file")) return "读取文件";
  if (name.includes("create_file")) return "创建文件";
  if (name.includes("edit_file")) return "编辑文件";
  if (name.includes("delete_file")) return "删除文件";
  if (name.includes("shell") || name.includes("command")) return "命令执行";
  if (name.includes("search")) return "网页搜索";
  if (name.includes("browser")) return "网页摘要";
  return "工具能力";
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

function providerName(value: string): string {
  if (value === "tavily") return "Tavily";
  if (value === "none") return "未启用";
  return value;
}

const SETTINGS_GROUPS: readonly { readonly id: SettingsGroup; readonly label: string; readonly icon: React.ReactNode }[] = [
  { id: "general", label: "常规", icon: <SlidersHorizontal size={15} /> },
  { id: "models", label: "模型服务", icon: <CloudCog size={15} /> },
  { id: "confirmation", label: "确认", icon: <LockKeyhole size={15} /> },
  { id: "workspace", label: "数据", icon: <Database size={15} /> },
  { id: "appearance", label: "界面", icon: <LayoutList size={15} /> },
];
