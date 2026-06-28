import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChartColumn,
  CloudCog,
  Database,
  FileText,
  Folder,
  HardDrive,
  Info,
  Monitor,
  Palette,
  Server,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  ConfigResponse,
  ModelProviderModelCatalog,
} from "../contracts/config";
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
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSaveCommandShell: (kind: "auto" | "cmd" | "powershell" | "pwsh" | "bash" | "sh") => Promise<void> | void;
  readonly savingModel?: boolean;
  readonly savingWorkspace?: boolean;
  readonly onSaveModel: (form?: ModelForm) => Promise<void>;
  readonly onCreateCustomProfile: (form?: ModelForm) => Promise<void>;
  readonly onReorderModelProviders: (order: readonly string[]) => Promise<void>;
  readonly onDeleteModelProvider: (profileId: string, fallbackProfileId?: string) => Promise<void>;
  readonly onFetchModels: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly onSaveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly onRevealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
  readonly skills: readonly SkillDefinition[];
  readonly onSaveWorkspace: (workspaceDirectory?: string) => void;
  readonly onSelectWorkspaceDirectory: () => void;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly mcpServerForm: McpServerForm;
  readonly setMcpServerForm: (form: McpServerForm) => void;
  readonly savingTools?: boolean;
  readonly onSaveTools: (form: ToolForm) => void;
  readonly onSaveMcpServer: (form?: McpServerForm) => Promise<void>;
  readonly onLoadMcpReferences: (serverId: string) => Promise<McpReferenceResponse>;
  readonly onImportMcpConfig: (config: string) => void;
  readonly onTestMcpServer: (serverId: string) => void;
  readonly onCheckMcpEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onInstallMcpEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onDeleteMcpServer: (serverId: string) => void;
  readonly onUpdateMcpTool: (serverId: string, toolName: string, enabled: boolean, autoApproved?: boolean) => void;
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
                tools={props.tools}
                toolForm={props.toolForm}
                setToolForm={props.setToolForm}
                savingTools={props.savingTools}
                onSaveTools={props.onSaveTools}
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
            {activeGroup === "about" && <AboutSettings config={props.config} />}
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

function AboutSettings(props: { readonly config?: ConfigResponse }): React.ReactElement {
  const product = props.config?.product;
  const productName = product?.name ?? "AgentArbor";
  const version = product?.version ?? "未提供";
  const defaultEntry = product?.defaultEntry ?? "Desktop Shell / Panel";
  const configDirectory = product?.configDirectory ?? "未提供";
  const runtimeDirectory = product?.runtimeDirectory ?? "未提供";

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
      </section>

      <section className="about-fact-grid" aria-label="产品运行信息">
        <AboutFact icon={<CheckCircle2 size={16} />} label="版本" value={version} />
        <AboutFact icon={<Monitor size={16} />} label="默认入口" value={defaultEntry} />
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
