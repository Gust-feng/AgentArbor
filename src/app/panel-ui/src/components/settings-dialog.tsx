import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChartColumn,
  CircleAlert,
  CloudCog,
  Code2,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Github,
  HardDrive,
  Info,
  Monitor,
  Palette,
  RefreshCw,
  Server,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  ConfigResponse,
  ModelCapabilities,
  ModelProviderModelCatalog,
  SkillTriggerMode,
} from "../contracts/config";
import type { ConversationFollowUpMode } from "../contracts/composer";
import type { AppUpdateInfo, AppUpdateStatus } from "../contracts/app-update";
import { MULTI_AGENT_ENTRY_AVAILABLE } from "../app-multi-agent-availability";
import type { SkillDefinition } from "../contracts/skills";
import type { SubAgentDefinition } from "../contracts/sub-agents";
import type { McpEnvironmentCheckResponse, McpReferenceResponse, ToolsResponse } from "../contracts/tools";
import { AppearanceSettings } from "./appearance-settings";
import { BasicCapabilitiesSettings, DesktopAgentPromptSettings, McpServiceSettings } from "./capability-settings";
import { ModelSettings } from "./model-settings";
import type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./settings-types";
import { SkillSettings } from "./skill-settings";
import { SubAgentSettings } from "./sub-agent-settings";
import { DeveloperToolStatistics, UsageStatisticsSettings, preloadUsageStatistics } from "./usage-statistics-settings";
import { ResponsivenessDiagnostics } from "./responsiveness-diagnostics";
import { RuntimeSettings } from "./runtime-settings";
import { ReleaseNotes } from "./release-notes";

export type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./settings-types";

export function SettingsDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGroup?: SettingsGroup;
  readonly config?: ConfigResponse;
  readonly appUpdate?: AppUpdateInfo;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly desktopAgentSystemPrompt: string;
  readonly setDesktopAgentSystemPrompt: (value: string) => void;
  readonly modelUsageDisplayEnabled: boolean;
  readonly onModelUsageDisplayChange: (enabled: boolean) => void;
  readonly conversationFollowUpMode?: ConversationFollowUpMode;
  readonly onConversationFollowUpModeChange?: (mode: ConversationFollowUpMode) => void;
  readonly agentClusterEnabled: boolean;
  readonly onAgentClusterEnabledChange: (enabled: boolean) => void;
  readonly developerModeEnabled: boolean;
  readonly onDeveloperModeChange: (enabled: boolean) => void;
  readonly onSaveCommandShell: (kind: "auto" | "cmd" | "powershell" | "pwsh" | "bash" | "sh") => Promise<void> | void;
  readonly savingModel?: boolean;
  readonly savingWorkspace?: boolean;
  readonly savingDesktopAgent?: boolean;
  readonly onSaveModel: (form?: ModelForm) => Promise<void>;
  readonly onCreateCustomProfile: (form?: ModelForm) => Promise<void>;
  readonly onReorderModelProviders: (order: readonly string[]) => Promise<void>;
  readonly onDeleteModelProvider: (profileId: string, fallbackProfileId?: string) => Promise<void>;
  readonly onFetchModels: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly onSaveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly onSaveModelCapabilities: (form: {
    readonly profileId: string;
    readonly providerKind?: string;
    readonly model: string;
    readonly capabilities: ModelCapabilities;
  }) => Promise<void>;
  readonly onRevealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
  readonly skills: readonly SkillDefinition[];
  readonly subAgents: readonly SubAgentDefinition[];
  readonly onSaveDesktopAgentSystemPrompt: (systemPrompt: string) => Promise<void>;
  readonly onSaveDesktopAgentSystemPromptVariant: (variant: string) => Promise<void>;
  readonly onResetDesktopAgentSystemPrompt: () => Promise<void>;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly mcpServerForm: McpServerForm;
  readonly setMcpServerForm: (form: McpServerForm) => void;
  readonly savingTools?: boolean;
  readonly onSaveTools: (form: ToolForm) => void;
  readonly onSaveSkillTriggerMode: (mode: SkillTriggerMode) => void;
  readonly onSaveMcpServer: (form?: McpServerForm) => Promise<void>;
  readonly onLoadMcpReferences: (serverId: string) => Promise<McpReferenceResponse>;
  readonly onImportMcpConfig: (config: string) => void;
  readonly onTestMcpServer: (serverId: string) => void;
  readonly onCheckMcpEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onInstallMcpEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onDeleteMcpServer: (serverId: string) => void;
  readonly onUpdateMcpTool: (serverId: string, toolName: string, enabled: boolean, autoApproved?: boolean) => void;
  readonly onCheckAppUpdate: () => Promise<void> | void;
  readonly onInstallAppUpdate: () => Promise<void> | void;
  readonly onRefreshSkills: () => void;
  readonly onRefreshSubAgents: () => void;
  readonly onUpdateSkill: (skill: Pick<SkillDefinition, "id" | "stateKey">, enabled: boolean) => void;
}): React.ReactElement | null {
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("models");
  useEffect(() => {
    if (props.open) {
      setActiveGroup(props.initialGroup ?? "models");
      preloadUsageStatistics();
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

  useEffect(() => {
    if (!props.developerModeEnabled && DEVELOPER_SETTINGS_GROUPS.has(activeGroup)) {
      setActiveGroup("about");
    }
  }, [activeGroup, props.developerModeEnabled]);

  if (!props.open) return null;

  const visibleGroups = settingsGroupsForDeveloperMode(props.developerModeEnabled);
  const visibleActiveGroup = visibleGroups.some((group) => group.id === activeGroup)
    ? activeGroup
    : visibleGroups[0]?.id ?? "models";
  const activeInfo = visibleGroups.find((group) => group.id === visibleActiveGroup) ?? visibleGroups[0]!;
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <button type="button" className="settings-backdrop" aria-label="关闭设置" onClick={props.onClose} />
      <section className="settings-dialog">
        <aside className="settings-sidebar">
          <button type="button" className="settings-close-button" onClick={props.onClose} aria-label="关闭">
            <X size={16} />
          </button>
          <nav aria-label="设置分组">
            {visibleGroups.map((group) => (
              <button
                type="button"
                key={group.id}
                className={group.id === visibleActiveGroup ? "active" : ""}
                onClick={() => setActiveGroup(group.id)}
                onFocus={() => {
                  if (group.id === "statistics" || group.id === "developer") preloadUsageStatistics();
                }}
                onMouseEnter={() => {
                  if (group.id === "statistics" || group.id === "developer") preloadUsageStatistics();
                }}
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
          <div className={`settings-content ${visibleActiveGroup === "models" ? "model-settings-content" : ""}`}>
            <div
              className="settings-panel-slot model-settings-slot"
              hidden={visibleActiveGroup !== "models"}
              aria-hidden={visibleActiveGroup !== "models"}
            >
              <ModelSettings
                active={visibleActiveGroup === "models"}
                config={props.config}
                modelForm={props.modelForm}
                setModelForm={props.setModelForm}
                saving={props.savingModel}
                onSave={props.onSaveModel}
                onCreateCustomProfile={props.onCreateCustomProfile}
                onReorderModelProviders={props.onReorderModelProviders}
                onDeleteModelProvider={props.onDeleteModelProvider}
                onFetchModels={props.onFetchModels}
                onSaveModelCatalog={props.onSaveModelCatalog}
                onRevealModelApiKey={props.onRevealModelApiKey}
                modelCatalogs={props.modelCatalogs}
              />
            </div>
            {visibleActiveGroup === "basicCapabilities" && (
              <BasicCapabilitiesSettings
                config={props.config}
                modelCatalogs={props.modelCatalogs}
                savingModel={props.savingModel}
                onSaveModelCapabilities={props.onSaveModelCapabilities}
                modelUsageDisplayEnabled={props.modelUsageDisplayEnabled}
                onModelUsageDisplayChange={props.onModelUsageDisplayChange}
                conversationFollowUpMode={props.conversationFollowUpMode ?? "queue"}
                onConversationFollowUpModeChange={props.onConversationFollowUpModeChange ?? (() => undefined)}
                tools={props.tools}
                toolForm={props.toolForm}
                setToolForm={props.setToolForm}
                savingTools={props.savingTools}
                onSaveTools={props.onSaveTools}
                onSaveSkillTriggerMode={props.onSaveSkillTriggerMode}
                savingDesktopAgent={props.savingDesktopAgent}
                onSaveDesktopAgentSystemPromptVariant={props.onSaveDesktopAgentSystemPromptVariant}
              />
            )}
            {visibleActiveGroup === "mcp" && (
              <McpServiceSettings
                tools={props.tools}
                mcpServerForm={props.mcpServerForm}
                setMcpServerForm={props.setMcpServerForm}
                savingTools={props.savingTools}
                onSaveMcpServer={props.onSaveMcpServer}
                onLoadMcpReferences={props.onLoadMcpReferences}
                onImportMcpConfig={props.onImportMcpConfig}
                onTestMcpServer={props.onTestMcpServer}
                onCheckMcpEnvironment={props.onCheckMcpEnvironment}
                onInstallMcpEnvironment={props.onInstallMcpEnvironment}
                onDeleteMcpServer={props.onDeleteMcpServer}
                onUpdateMcpTool={props.onUpdateMcpTool}
              />
            )}
            {visibleActiveGroup === "skills" && (
              <SkillSettings
                skills={props.skills}
                saving={props.savingTools}
                onRefreshSkills={props.onRefreshSkills}
                onUpdateSkill={props.onUpdateSkill}
              />
            )}
            {visibleActiveGroup === "subAgents" && (
              <SubAgentSettings
                subAgents={props.subAgents}
                refreshing={props.savingTools}
                onRefresh={props.onRefreshSubAgents}
              />
            )}
            {visibleActiveGroup === "workspace" && (
              <RuntimeSettings
                commandShell={props.config?.commandShell}
                savingCommandShell={props.savingWorkspace}
                onSaveCommandShell={props.onSaveCommandShell}
              />
            )}
            {visibleActiveGroup === "appearance" && <AppearanceSettings />}
            {visibleActiveGroup === "statistics" && <UsageStatisticsSettings />}
            {visibleActiveGroup === "developer" && (
              <>
                <div className="basic-capabilities-settings developer-prompt-settings">
                  <DesktopAgentPromptSettings
                    config={props.config}
                    systemPrompt={props.desktopAgentSystemPrompt}
                    setSystemPrompt={props.setDesktopAgentSystemPrompt}
                    saving={props.savingDesktopAgent}
                    onSave={props.onSaveDesktopAgentSystemPrompt}
                    onReset={props.onResetDesktopAgentSystemPrompt}
                  />
                </div>
                <ResponsivenessDiagnostics />
                <DeveloperToolStatistics />
              </>
            )}
            {visibleActiveGroup === "about" && (
              <AboutSettings
                config={props.config}
                appUpdate={props.appUpdate}
                agentClusterEnabled={props.agentClusterEnabled}
                onAgentClusterEnabledChange={props.onAgentClusterEnabledChange}
                developerModeEnabled={props.developerModeEnabled}
                onDeveloperModeChange={props.onDeveloperModeChange}
                onCheckAppUpdate={props.onCheckAppUpdate}
                onInstallAppUpdate={props.onInstallAppUpdate}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

const SETTINGS_GROUPS: readonly { readonly id: SettingsGroup; readonly label: string; readonly icon: React.ReactNode }[] = [
  { id: "models", label: "模型服务", icon: <CloudCog size={15} /> },
  { id: "basicCapabilities", label: "基础能力", icon: <SlidersHorizontal size={15} /> },
  { id: "mcp", label: "MCP 服务", icon: <Server size={15} /> },
  { id: "skills", label: "技能", icon: <FileText size={15} /> },
  { id: "subAgents", label: "Sub Agent", icon: <Bot size={15} /> },
  { id: "workspace", label: "运行环境", icon: <Database size={15} /> },
  { id: "appearance", label: "外观", icon: <Palette size={15} /> },
  { id: "statistics", label: "使用统计", icon: <ChartColumn size={15} /> },
  { id: "developer", label: "开发者选项", icon: <Code2 size={15} /> },
  { id: "about", label: "关于", icon: <Info size={15} /> },
];

const DEVELOPER_SETTINGS_GROUPS: ReadonlySet<SettingsGroup> = new Set(["developer"]);
// The migrated PersonalWorkbench does not consume the legacy theme layer yet.
// Keep the implementation available for the later adaptation, but do not expose
// a setting that currently cannot affect the production surface.
const TEMPORARILY_HIDDEN_SETTINGS_GROUPS: ReadonlySet<SettingsGroup> = new Set(["appearance"]);

export function settingsGroupsForDeveloperMode(enabled: boolean): typeof SETTINGS_GROUPS {
  return SETTINGS_GROUPS.filter((group) =>
    !TEMPORARILY_HIDDEN_SETTINGS_GROUPS.has(group.id)
    && (enabled || !DEVELOPER_SETTINGS_GROUPS.has(group.id)));
}

const AGENTARBOR_GITHUB_REPOSITORY_URL = "https://github.com/Gust-feng/AgentArbor";
const DEVELOPER_MODE_GESTURE_CLICKS = 7;
const DEVELOPER_MODE_GESTURE_WINDOW_MS = 2_000;

export function AboutSettings(props: {
  readonly config?: ConfigResponse;
  readonly appUpdate?: AppUpdateInfo;
  readonly agentClusterEnabled: boolean;
  readonly onAgentClusterEnabledChange: (enabled: boolean) => void;
  readonly developerModeEnabled: boolean;
  readonly onDeveloperModeChange: (enabled: boolean) => void;
  readonly onCheckAppUpdate: () => Promise<void> | void;
  readonly onInstallAppUpdate: () => Promise<void> | void;
}): React.ReactElement {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const product = props.config?.product;
  const productName = product?.name ?? "AgentArbor";
  const version = product?.version ?? "未提供";
  const defaultEntry = product?.defaultEntry ?? "Desktop Shell / Panel";
  const runtimeModeLabel = product?.runtimeModeLabel?.trim();
  const configDirectory = product?.configDirectory ?? "未提供";
  const runtimeDirectory = product?.runtimeDirectory ?? "未提供";
  const updateStatus = checkingUpdate ? "checking" : props.appUpdate?.status ?? "idle";
  const updateLink = appUpdateActionUrl(props.appUpdate);
  const releaseNotes = appUpdateHasNewVersion(updateStatus)
    ? nonEmptyUpdateNotes(props.appUpdate?.latest?.notes)
    : undefined;
  const canCheckUpdate = props.appUpdate?.canCheck !== false && updateStatus !== "downloading" && updateStatus !== "installing";
  const canInstallUpdate = props.appUpdate?.canInstall === true && updateStatus === "downloaded";
  const developerModeGesture = useRef({ count: 0, startedAt: 0 });

  const handleDeveloperModeGesture = (): void => {
    const now = Date.now();
    const previous = developerModeGesture.current;
    const continuesGesture = previous.count > 0 && now - previous.startedAt <= DEVELOPER_MODE_GESTURE_WINDOW_MS;
    const count = continuesGesture ? previous.count + 1 : 1;
    developerModeGesture.current = { count, startedAt: continuesGesture ? previous.startedAt : now };
    if (count < DEVELOPER_MODE_GESTURE_CLICKS) return;
    developerModeGesture.current = { count: 0, startedAt: 0 };
    props.onDeveloperModeChange(!props.developerModeEnabled);
  };

  const checkUpdate = async (): Promise<void> => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      await props.onCheckAppUpdate();
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async (): Promise<void> => {
    if (installingUpdate || !canInstallUpdate) return;
    setInstallingUpdate(true);
    try {
      await props.onInstallAppUpdate();
    } finally {
      setInstallingUpdate(false);
    }
  };

  return (
    <div className="about-settings">
      <section className="settings-card about-product-card">
        <div className="about-product-header">
          <div className="about-product-main">
            <span className="about-product-mark" aria-hidden="true">
              <img src="/favicon.svg" alt="" />
            </span>
            <div>
              <h3>{productName}</h3>
              <div className="about-product-tags">
                <button
                  type="button"
                  className="about-product-version"
                  aria-label={`版本 ${version}`}
                  onClick={handleDeveloperModeGesture}
                >
                  v{version}
                </button>
                {props.developerModeEnabled && runtimeModeLabel !== undefined && runtimeModeLabel.length > 0 && (
                  <span className="about-product-runtime">{runtimeModeLabel}</span>
                )}
              </div>
            </div>
          </div>
          <a
            className="about-product-github-link"
            href={AGENTARBOR_GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="打开 GitHub 仓库：Gust-feng/AgentArbor"
          >
            <Github size={20} strokeWidth={2.1} />
          </a>
        </div>
        <div className="about-update-panel">
          <div className="about-update-status-row">
            <span className={`about-update-symbol ${appUpdateStatusTone(updateStatus)}`} aria-hidden="true">
              {appUpdateStatusIcon(updateStatus)}
            </span>
            <div className="about-update-copy" aria-live="polite">
              <strong>软件更新</strong>
              <span>{appUpdateSummary(props.appUpdate, checkingUpdate)}</span>
            </div>
            <button
              type="button"
              className="about-update-check-button"
              disabled={checkingUpdate || !canCheckUpdate}
              onClick={() => void checkUpdate()}
            >
              <RefreshCw size={14} />
              <span>{checkingUpdate ? "检查中" : "检查更新"}</span>
            </button>
          </div>
          {releaseNotes !== undefined && (
            <div className="about-update-notes" aria-label="更新说明">
              <div className="about-update-notes-header">
                <strong>更新说明</strong>
                {props.appUpdate?.latest?.version !== undefined && (
                  <span>v{props.appUpdate.latest.version}</span>
                )}
              </div>
              <ReleaseNotes text={releaseNotes} />
            </div>
          )}
          {props.appUpdate?.progress !== undefined && updateStatus === "downloading" && (
            <div className="about-update-progress" aria-label="更新下载进度">
              <span style={{ width: `${Math.min(100, Math.max(0, props.appUpdate.progress.percent))}%` }} />
            </div>
          )}
          {(canInstallUpdate || updateLink !== undefined) && (
            <div className="about-update-actions">
              {canInstallUpdate && (
                <button
                  type="button"
                  className="about-update-install-button"
                  disabled={installingUpdate}
                  onClick={() => void installUpdate()}
                >
                  <Download size={14} />
                  <span>{installingUpdate ? "正在重启" : "重启安装"}</span>
                </button>
              )}
              {updateLink !== undefined && (
                <a className="about-update-download-link" href={updateLink} target="_blank" rel="noreferrer">
                  <Download size={14} />
                  <span>打开下载页</span>
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          )}
          {props.appUpdate?.checkedAt !== undefined && (
            <p className="about-update-checked-at">上次检查：{formatCheckedAt(props.appUpdate.checkedAt)}</p>
          )}
        </div>
      </section>

      {props.developerModeEnabled && (
        <section className="about-fact-grid" aria-label="产品运行信息">
          <AboutFact icon={<Monitor size={16} />} label="默认入口" value={defaultEntry} />
          {runtimeModeLabel !== undefined && runtimeModeLabel.length > 0 ? (
            <AboutFact icon={<Cpu size={16} />} label="运行模式" value={runtimeModeLabel} />
          ) : (
            <AboutFact icon={<CheckCircle2 size={16} />} label="版本" value={version} />
          )}
        </section>
      )}

      {MULTI_AGENT_ENTRY_AVAILABLE && (
        <section className="settings-card about-agent-cluster-card">
          <div className="settings-card-title-row">
            <h3>Agent 集群</h3>
            <span>beta</span>
          </div>
          <div className="about-agent-cluster-row">
            <div className="about-agent-cluster-copy">
              <strong>启用 Agent 集群</strong>
              <span>当前版本仍处于测试阶段，可能出现运行中断、结果不稳定、状态恢复异常等意外情况；开启后仅在“新任务”下方显示入口，默认启动仍进入桌面 Agent。</span>
            </div>
            <button
              type="button"
              className="appearance-toggle-switch about-agent-cluster-switch"
              role="switch"
              aria-checked={props.agentClusterEnabled}
              aria-label="启用 Agent 集群 beta"
              onClick={() => props.onAgentClusterEnabledChange(!props.agentClusterEnabled)}
            >
              <span />
            </button>
          </div>
        </section>
      )}

      {props.developerModeEnabled && <section className="settings-card about-path-card">
        <div className="settings-card-title-row">
          <h3>本机数据</h3>
          <span>仅此设备</span>
        </div>
        <div className="about-path-list" aria-label="本机数据目录">
          <AboutPath icon={<Folder size={16} />} label="配置目录" value={configDirectory} />
          <AboutPath icon={<HardDrive size={16} />} label="运行数据目录" value={runtimeDirectory} />
        </div>
      </section>}
    </div>
  );
}

function appUpdateStatusTone(status: AppUpdateStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "available") return "warning";
  if (status === "up_to_date" || status === "downloaded") return "success";
  if (status === "unconfigured" || status === "unsupported" || status === "no_release" || status === "idle" || status === "checking" || status === "downloading" || status === "installing") return "neutral";
  if (status === "failed") return "danger";
  return "neutral";
}

function appUpdateStatusIcon(status: AppUpdateStatus): React.ReactNode {
  if (status === "up_to_date") return <CheckCircle2 size={17} />;
  if (status === "available" || status === "downloading" || status === "downloaded") return <Download size={17} />;
  if (status === "failed") return <CircleAlert size={17} />;
  return <RefreshCw size={17} />;
}

function appUpdateSummary(update: AppUpdateInfo | undefined, checking: boolean): string {
  if (checking) return "正在读取更新清单...";
  if (update === undefined) return "尚未检查更新。";
  switch (update.status) {
    case "unsupported":
      return update.errorSummary ?? "当前运行方式不支持自动更新。";
    case "available":
      return update.latest?.version === undefined ? "发现可用更新。" : `可更新到 ${update.latest.version}`;
    case "downloading":
      return update.progress === undefined
        ? "正在后台下载更新..."
        : `正在后台下载更新 ${Math.round(update.progress.percent)}%`;
    case "downloaded":
      return update.latest?.version === undefined ? "新版本已下载，重启后安装。" : `版本 ${update.latest.version} 已下载，重启后安装。`;
    case "installing":
      return "正在重启并安装更新。";
    case "up_to_date":
      return "当前版本已是最新。";
    case "no_release":
      return "GitHub 当前还没有发布版本。";
    case "failed":
      return update.errorSummary ?? "更新检查失败。";
    case "unconfigured":
      return "当前构建未配置更新清单。";
    case "checking":
      return "正在读取更新清单...";
    case "idle":
      return "尚未检查更新。";
  }
}

function appUpdateActionUrl(update: AppUpdateInfo | undefined): string | undefined {
  if (update?.status !== "available") return undefined;
  return update.latest?.releasePageUrl ?? update.latest?.downloadUrl;
}

function appUpdateHasNewVersion(status: AppUpdateStatus): boolean {
  return status === "available"
    || status === "downloading"
    || status === "downloaded"
    || status === "installing";
}

function nonEmptyUpdateNotes(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function AboutFact(props: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="about-fact">
      <span className="about-fact-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="about-fact-label">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function AboutPath(props: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="about-path-row">
      <span className="about-path-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="about-path-label">{props.label}</span>
      <code>{props.value}</code>
    </div>
  );
}
