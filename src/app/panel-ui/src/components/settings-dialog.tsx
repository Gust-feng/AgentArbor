import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChartColumn,
  CloudCog,
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
import type { AppUpdateInfo, AppUpdateStatus } from "../contracts/app-update";
import type { SkillDefinition } from "../contracts/skills";
import type { McpEnvironmentCheckResponse, McpReferenceResponse, ToolsResponse } from "../contracts/tools";
import { AppearanceSettings } from "./appearance-settings";
import { BasicCapabilitiesSettings, McpServiceSettings } from "./capability-settings";
import { ModelSettings } from "./model-settings";
import type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./settings-types";
import { SkillSettings } from "./skill-settings";
import { UsageStatisticsSettings, preloadUsageStatistics } from "./usage-statistics-settings";
import { WorkspaceSettings } from "./workspace-settings";

export type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./settings-types";

export function SettingsDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGroup?: SettingsGroup;
  readonly config?: ConfigResponse;
  readonly appUpdate?: AppUpdateInfo;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly desktopAgentSystemPrompt: string;
  readonly setDesktopAgentSystemPrompt: (value: string) => void;
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
  readonly onSaveWorkspace: (workspaceDirectory?: string) => void;
  readonly onSelectWorkspaceDirectory: () => void;
  readonly onSaveDesktopAgentSystemPrompt: (systemPrompt: string) => Promise<void>;
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
                onFocus={() => {
                  if (group.id === "statistics") preloadUsageStatistics();
                }}
                onMouseEnter={() => {
                  if (group.id === "statistics") preloadUsageStatistics();
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
          <div className={`settings-content ${activeGroup === "models" ? "model-settings-content" : ""}`}>
            {activeGroup === "models" && (
              <ModelSettings
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
            )}
            {activeGroup === "basicCapabilities" && (
              <BasicCapabilitiesSettings
                config={props.config}
                modelCatalogs={props.modelCatalogs}
                savingModel={props.savingModel}
                onSaveModelCapabilities={props.onSaveModelCapabilities}
                desktopAgentSystemPrompt={props.desktopAgentSystemPrompt}
                setDesktopAgentSystemPrompt={props.setDesktopAgentSystemPrompt}
                savingDesktopAgent={props.savingDesktopAgent}
                onSaveDesktopAgentSystemPrompt={props.onSaveDesktopAgentSystemPrompt}
                onResetDesktopAgentSystemPrompt={props.onResetDesktopAgentSystemPrompt}
                tools={props.tools}
                toolForm={props.toolForm}
                setToolForm={props.setToolForm}
                savingTools={props.savingTools}
                onSaveTools={props.onSaveTools}
                onSaveSkillTriggerMode={props.onSaveSkillTriggerMode}
              />
            )}
            {activeGroup === "mcp" && (
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
            {activeGroup === "skills" && (
              <SkillSettings
                skills={props.skills}
                saving={props.savingTools}
                onRefreshSkills={props.onRefreshSkills}
                onUpdateSkill={props.onUpdateSkill}
              />
            )}
            {activeGroup === "workspace" && (
              <WorkspaceSettings
                commandShell={props.config?.commandShell}
                workspaceDirectory={props.workspaceDirectory}
                setWorkspaceDirectory={props.setWorkspaceDirectory}
                onSave={props.onSaveWorkspace}
                onSelectDirectory={props.onSelectWorkspaceDirectory}
                savingCommandShell={props.savingWorkspace}
                onSaveCommandShell={props.onSaveCommandShell}
              />
            )}
            {activeGroup === "appearance" && <AppearanceSettings />}
            {activeGroup === "statistics" && <UsageStatisticsSettings />}
            {activeGroup === "about" && (
              <AboutSettings
                config={props.config}
                appUpdate={props.appUpdate}
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
  { id: "workspace", label: "工作区", icon: <Database size={15} /> },
  { id: "appearance", label: "外观", icon: <Palette size={15} /> },
  { id: "statistics", label: "使用统计", icon: <ChartColumn size={15} /> },
  { id: "about", label: "关于", icon: <Info size={15} /> },
];

const AGENTARBOR_GITHUB_REPOSITORY_URL = "https://github.com/Gust-feng/AgentArbor";

function AboutSettings(props: {
  readonly config?: ConfigResponse;
  readonly appUpdate?: AppUpdateInfo;
  readonly onCheckAppUpdate: () => Promise<void> | void;
  readonly onInstallAppUpdate: () => Promise<void> | void;
}): React.ReactElement {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const product = props.config?.product;
  const productName = product?.name ?? "AgentArbor";
  const version = product?.version ?? "未提供";
  const defaultEntry = product?.defaultEntry ?? "Desktop Shell / Panel";
  const configDirectory = product?.configDirectory ?? "未提供";
  const runtimeDirectory = product?.runtimeDirectory ?? "未提供";
  const updateStatus = checkingUpdate ? "checking" : props.appUpdate?.status ?? "idle";
  const updateLink = appUpdateActionUrl(props.appUpdate);
  const canCheckUpdate = props.appUpdate?.canCheck !== false && updateStatus !== "downloading" && updateStatus !== "installing";
  const canInstallUpdate = props.appUpdate?.canInstall === true && updateStatus === "downloaded";

  const checkUpdate = async (): Promise<void> => {
    if (checkingUpdate || !canCheckUpdate) return;
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
        <div className="about-product-main">
          <span className="about-product-mark" aria-hidden="true">
            <img src="/favicon.svg" alt="" />
          </span>
          <div>
            <h3>{productName}</h3>
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
      </section>

      <section className="about-fact-grid" aria-label="产品运行信息">
        <AboutFact icon={<CheckCircle2 size={16} />} label="版本" value={version} />
        <AboutFact icon={<Monitor size={16} />} label="默认入口" value={defaultEntry} />
      </section>

      <section className="settings-card about-update-card">
        <div className="settings-card-title-row">
          <h3>更新</h3>
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
        <div className="about-update-status-row">
          <span className={`about-update-pill ${appUpdateStatusTone(updateStatus)}`}>
            {appUpdateStatusLabel(updateStatus)}
          </span>
          <span>{appUpdateSummary(props.appUpdate, checkingUpdate)}</span>
        </div>
        {props.appUpdate?.progress !== undefined && updateStatus === "downloading" && (
          <div className="about-update-progress" aria-label="更新下载进度">
            <span style={{ width: `${Math.min(100, Math.max(0, props.appUpdate.progress.percent))}%` }} />
          </div>
        )}
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
        {props.appUpdate?.checkedAt !== undefined && (
          <p className="about-update-checked-at">上次检查：{formatCheckedAt(props.appUpdate.checkedAt)}</p>
        )}
      </section>

      <section className="settings-card about-path-card">
        <div className="settings-card-title-row">
          <h3>本机数据</h3>
          <span>仅此设备</span>
        </div>
        <div className="about-path-list" aria-label="本机数据目录">
          <AboutPath icon={<Folder size={16} />} label="配置目录" value={configDirectory} />
          <AboutPath icon={<HardDrive size={16} />} label="运行数据目录" value={runtimeDirectory} />
        </div>
      </section>
    </div>
  );
}

function appUpdateStatusLabel(status: AppUpdateStatus): string {
  switch (status) {
    case "unsupported":
      return "不支持自动更新";
    case "available":
      return "有新版本";
    case "downloading":
      return "正在下载";
    case "downloaded":
      return "已下载";
    case "installing":
      return "正在安装";
    case "up_to_date":
      return "已是最新";
    case "no_release":
      return "暂无发布";
    case "checking":
      return "正在检查";
    case "failed":
      return "检查失败";
    case "unconfigured":
      return "未配置发布源";
    case "idle":
      return "未检查";
  }
}

function appUpdateStatusTone(status: AppUpdateStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "available") return "warning";
  if (status === "up_to_date" || status === "downloaded") return "success";
  if (status === "unconfigured" || status === "unsupported" || status === "no_release" || status === "idle" || status === "checking" || status === "downloading" || status === "installing") return "neutral";
  if (status === "failed") return "danger";
  return "neutral";
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
