import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("panel UI settings and model modules stay split", async () => {
  const [
    settingsDialog,
    settingsTypes,
    settingsToolCopy,
    capabilitySettings,
    skillSettings,
    workspaceSettings,
    commandShellSelection,
    runtimeEnvironmentSettings,
    runtimeToolIcons,
    pythonRuntimeIcon,
    appearanceSettings,
    usageStatisticsSettings,
    modelSettings,
    modelCatalogPanel,
    modelProviderForm,
    modelProviderList,
    modelSettingsIcons,
    modelSettingsListEquality,
    modelCatalogState,
    modelSettingsProjection,
    workspaceCommon,
    modelProviderLogos,
    modelIcons,
    styleEntry,
    settingsShellStyles,
    settingsProviderStyles,
    settingsModelListStyles,
    settingsFormStyles,
    settingsUsageStyles,
    workspaceStyles,
    glassStyle,
  ] = await Promise.all([
    readPanelUiSource(path.join("components", "settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "settings-types.ts")),
    readPanelUiSource(path.join("components", "settings-tool-copy.ts")),
    readPanelUiSource(path.join("components", "capability-settings.tsx")),
    readPanelUiSource(path.join("components", "skill-settings.tsx")),
    readPanelUiSource(path.join("components", "workspace-settings.tsx")),
    readPanelUiSource(path.join("components", "command-shell-selection.tsx")),
    readPanelUiSource(path.join("components", "runtime-environment-settings.tsx")),
    readPanelUiSource("runtime-tool-icons.ts"),
    readPanelUiSource(path.join("runtime-tool-icon-assets", "python.svg")),
    readPanelUiSource(path.join("components", "appearance-settings.tsx")),
    readPanelUiSource(path.join("components", "usage-statistics-settings.tsx")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
    readPanelUiSource(path.join("components", "model-catalog-panel.tsx")),
    readPanelUiSource(path.join("components", "model-provider-form.tsx")),
    readPanelUiSource(path.join("components", "model-provider-list.tsx")),
    readPanelUiSource(path.join("components", "model-settings-icons.tsx")),
    readPanelUiSource(path.join("components", "model-settings-list-equality.ts")),
    readPanelUiSource(path.join("components", "model-catalog-state.ts")),
    readPanelUiSource(path.join("components", "model-settings-projection.ts")),
    readPanelUiSource(path.join("components", "workspace-common.tsx")),
    readPanelUiSource("model-provider-logos.ts"),
    readPanelUiSource("model-icons.ts"),
    readPanelUiSource("styles.css"),
    readPanelUiStyle("settings.css"),
    readPanelUiStyle("settings-provider.css"),
    readPanelUiStyle("settings-model-list.css"),
    readPanelUiStyle("settings-forms.css"),
    readPanelUiStyle("settings-usage.css"),
    readPanelUiStyle("workspace.css"),
    readPanelUiStyle("style-glass.css"),
  ]);

  assert.equal(settingsDialog.includes('from "./skills-page"'), false);
  assert.equal(settingsDialog.includes('from "./tools-page"'), false);
  assert.equal(settingsDialog.includes('from "./capability-settings"'), true);
  assert.equal(settingsDialog.includes('from "./skill-settings"'), true);
  assert.equal(settingsDialog.includes('from "./confirmation-settings"'), false);
  assert.equal(settingsDialog.includes('from "./model-settings"'), true);
  assert.equal(settingsDialog.includes('from "./settings-types"'), true);
  assert.equal(settingsDialog.includes('from "./workspace-settings"'), true);
  assert.equal(settingsDialog.includes('from "./appearance-settings"'), true);
  assert.equal(settingsDialog.includes('from "./usage-statistics-settings"'), true);
  assert.equal(settingsDialog.includes("React.lazy"), false);
  assert.equal(settingsDialog.includes("React.Suspense"), false);
  assert.equal(settingsDialog.includes('import("./model-settings")'), false);
  assert.equal(settingsDialog.includes('import("./capability-settings")'), false);
  assert.equal(settingsDialog.includes('import("./skill-settings")'), false);
  assert.equal(settingsDialog.includes('import("./workspace-settings")'), false);
  assert.equal(settingsDialog.includes('import("./appearance-settings")'), false);
  assert.equal(settingsDialog.includes('export type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./settings-types"'), true);
  assert.equal(settingsDialog.includes("preloadCommandShellSelection"), false);
  assert.equal(settingsDialog.includes("warmSettingsGroup"), false);
  assert.equal(settingsDialog.includes("export function SettingsDialog"), true);
  assert.equal(settingsDialog.includes("initialGroup?: SettingsGroup"), true);
  assert.equal(settingsDialog.includes('useState<SettingsGroup>("models")'), true);
  assert.equal(settingsDialog.includes('props.initialGroup ?? "models"'), true);
  assert.equal(settingsDialog.includes('label: "模型服务"'), true);
  assert.equal(settingsDialog.includes('label: "基础能力"'), true);
  assert.equal(settingsDialog.includes('label: "MCP 服务"'), true);
  assert.equal(settingsDialog.includes('label: "技能"'), true);
  assert.equal(settingsDialog.includes('label: "工作区"'), true);
  assert.equal(settingsDialog.includes('label: "命令确认"'), false);
  assert.equal(settingsDialog.includes('label: "外观"'), true);
  assert.equal(settingsDialog.includes('label: "使用统计"'), true);
  assert.equal(settingsDialog.includes('label: "关于"'), true);
  assert.equal(settingsDialog.indexOf('label: "外观"') < settingsDialog.indexOf('label: "使用统计"'), true);
  assert.equal(settingsDialog.indexOf('label: "使用统计"') < settingsDialog.indexOf('label: "关于"'), true);
  assert.equal(settingsDialog.includes('label: "确认边界"'), false);
  assert.equal(settingsDialog.includes("<ModelSettings"), true);
  assert.equal(settingsDialog.includes("<BasicCapabilitiesSettings"), true);
  assert.equal(settingsDialog.includes("<McpServiceSettings"), true);
  assert.equal(settingsDialog.includes("<SkillSettings"), true);
  assert.equal(settingsDialog.includes("<WorkspaceSettings"), true);
  assert.equal(settingsDialog.includes("<LazyModelSettings"), false);
  assert.equal(settingsDialog.includes("<LazyBasicCapabilitiesSettings"), false);
  assert.equal(settingsDialog.includes("<LazyMcpServiceSettings"), false);
  assert.equal(settingsDialog.includes("<LazySkillSettings"), false);
  assert.equal(settingsDialog.includes("<LazyWorkspaceSettings"), false);
  assert.equal(settingsDialog.includes("<ConfirmationSettings"), false);
  assert.equal(settingsDialog.includes("<UsageStatisticsSettings"), true);
  assert.equal(settingsDialog.includes("function Capability"), false);
  assert.equal(settingsDialog.includes("function WorkspaceSettings"), false);
  assert.equal(settingsDialog.includes("function ConfirmationSettings"), false);
  assert.equal(settingsDialog.includes("function AppearanceSettings"), false);
  assert.equal(settingsDialog.includes("function AboutSettings"), true);
  assert.equal(settingsDialog.includes("<AppearanceSettings />"), true);
  assert.equal(settingsDialog.includes("<UsageStatisticsSettings />"), true);
  assert.equal(settingsDialog.includes("<LazyAppearanceSettings"), false);
  assert.equal(settingsDialog.includes("<AboutSettings"), true);
  assert.equal(settingsDialog.includes("appUpdate={props.appUpdate}"), true);
  assert.equal(settingsDialog.includes("onCheckAppUpdate={props.onCheckAppUpdate}"), true);
  assert.equal(settingsDialog.includes("onInstallAppUpdate={props.onInstallAppUpdate}"), true);
  assert.equal(settingsDialog.includes("useBrowserAppearanceSnapshot"), false);
  assert.equal(settingsDialog.includes("<ThemeSwitcher"), false);
  assert.equal(settingsDialog.includes("未配置独立主题"), false);
  assert.equal(settingsDialog.includes("只读：当前没有外观配置入口"), false);
  assert.equal(settingsDialog.includes("product?.version"), true);
  assert.equal(settingsDialog.includes("product?.configDirectory"), true);
  assert.equal(settingsDialog.includes("product?.runtimeDirectory"), true);
  assert.equal(settingsDialog.includes("AGENTARBOR_GITHUB_REPOSITORY_URL"), true);
  assert.equal(settingsDialog.includes("https://github.com/Gust-feng/AgentArbor"), true);
  assert.equal(settingsDialog.includes("about-product-github-link"), true);
  assert.equal(settingsDialog.includes("about-update-card"), true);
  assert.equal(settingsDialog.includes("检查更新"), true);
  assert.equal(settingsDialog.includes("重启安装"), true);
  assert.equal(settingsDialog.includes("about-update-progress"), true);
  assert.equal(settingsDialog.includes("不支持自动更新"), true);
  assert.equal(settingsDialog.includes("正在后台下载更新"), true);
  assert.equal(settingsDialog.includes("已下载，重启后安装"), true);
  assert.equal(settingsDialog.includes("appUpdateStatusLabel"), true);
  assert.equal(settingsDialog.includes("appUpdateActionUrl"), true);
  assert.equal(settingsDialog.includes("onSaveSkillTriggerMode"), true);
  assert.equal(settingsDialog.includes("modelUsageDisplayEnabled"), true);
  assert.equal(settingsDialog.includes("onModelUsageDisplayChange"), true);
  assert.equal(settingsDialog.includes("agentClusterEnabled"), true);
  assert.equal(settingsDialog.includes("onAgentClusterEnabledChange"), true);
  assert.equal(settingsDialog.includes("about-agent-cluster-card"), true);
  assert.equal(settingsDialog.includes("当前版本仍处于测试阶段"), true);
  assert.equal(settingsDialog.includes("暖色工作台"), false);
  assert.equal(settingsDialog.includes("基础 Agent"), false);
  assert.equal(settingsDialog.includes("function ModelSettings"), false);
  assert.equal(settingsDialog.includes("function ModelIcon"), false);
  assert.equal(settingsDialog.includes("function modelProviderItems"), false);
  assert.equal(settingsDialog.includes("resolveModelProviderLogo"), false);
  assert.equal(settingsDialog.includes("provider-base-url-field"), false);
  assert.equal(settingsDialog.includes("网页查证"), false);
  assert.equal(settingsDialog.includes('label: "MCP 服务"'), true);
  assert.equal(settingsDialog.includes("工作方法"), false);
  assert.equal(settingsDialog.includes("由模型按任务判断"), false);
  assert.equal(settingsDialog.includes("接入工具"), false);
  assert.equal(settingsDialog.includes("管理助手可调用"), false);
  assert.equal(settingsDialog.includes('label: "助手能力"'), false);
  assert.equal(settingsDialog.includes('label: "能力"'), false);
  assert.equal(settingsDialog.includes('label: "常规"'), false);
  assert.equal(settingsDialog.includes('label: "界面"'), false);
  assert.equal(settingsDialog.includes("function GeneralSettings"), false);
  assert.equal(settingsDialog.includes("onStartSkill"), false);
  assert.equal(settingsTypes.includes('export type { ModelForm } from "./model-settings"'), true);
  assert.equal(settingsTypes.includes("export type ToolForm"), true);
  assert.equal(settingsTypes.includes("export type McpServerForm"), true);
  assert.equal(settingsTypes.includes('"appearance"'), true);
  assert.equal(settingsTypes.includes('"statistics"'), true);
  assert.equal(settingsTypes.indexOf('"appearance"') < settingsTypes.indexOf('"statistics"'), true);
  assert.equal(settingsTypes.indexOf('"statistics"') < settingsTypes.indexOf('"about"'), true);
  assert.equal(settingsToolCopy.includes("export function toolTitle"), false);
  assert.equal(settingsToolCopy.includes("export function toolDescription"), false);
  assert.equal(settingsToolCopy.includes("export function toolMeta"), false);
  assert.equal(settingsToolCopy.includes("export function confirmationRuleLabel"), true);
  assert.equal(settingsToolCopy.includes("export function providerName"), true);
  assert.equal(capabilitySettings.includes("export function BasicCapabilitiesSettings"), true);
  assert.equal(capabilitySettings.includes("export function McpServiceSettings"), true);
  assert.equal(capabilitySettings.includes("function WebSearchSettings"), true);
  assert.equal(capabilitySettings.includes("function McpServiceBoard"), true);
  assert.equal(capabilitySettings.includes("function ToolCatalogSettings"), false);
  assert.equal(capabilitySettings.includes("function SkillContextSettings"), false);
  assert.equal(capabilitySettings.includes("function CapabilityRow"), false);
  assert.equal(capabilitySettings.includes('from "../app-config-actions"'), false);
  assert.equal(capabilitySettings.includes("function ModelInformationSettings"), true);
  assert.equal(capabilitySettings.includes("modelCapabilityTargets"), true);
  assert.equal(capabilitySettings.includes("onSaveModelCapabilities"), true);
  assert.equal(capabilitySettings.includes("onSaveSkillTriggerMode"), true);
  assert.equal(capabilitySettings.includes("function ModelUsageDisplaySettings"), true);
  assert.equal(capabilitySettings.includes("回答展示"), true);
  assert.equal(capabilitySettings.includes("模型 token 信息"), true);
  assert.equal(capabilitySettings.includes("model-info-card"), true);
  assert.equal(capabilitySettings.includes("模型信息"), true);
  assert.equal(capabilitySettings.includes("模型能力"), false);
  assert.equal(capabilitySettings.includes("function SkillTriggerSettings"), true);
  assert.equal(capabilitySettings.includes("Skills 触发方式"), true);
  assert.equal(capabilitySettings.includes("skill-trigger-mode"), true);
  assert.equal(capabilitySettings.includes("显式/关键词触发"), true);
  assert.equal(capabilitySettings.includes("语义路由"), true);
  assert.equal(capabilitySettings.indexOf("<WebSearchSettings") < capabilitySettings.indexOf("<DesktopAgentPromptSettings"), true);
  assert.equal(capabilitySettings.indexOf("<DesktopAgentPromptSettings") < capabilitySettings.indexOf("<ModelUsageDisplaySettings"), true);
  assert.equal(capabilitySettings.indexOf("<ModelUsageDisplaySettings") < capabilitySettings.indexOf("<SkillTriggerSettings"), true);
  assert.equal(capabilitySettings.indexOf("<SkillTriggerSettings") < capabilitySettings.indexOf("<ModelInformationSettings"), true);
  assert.equal(capabilitySettings.includes("MCP 服务"), true);
  assert.equal(capabilitySettings.includes("运行时工具"), false);
  assert.equal(capabilitySettings.includes("工作方法"), false);
  assert.equal(capabilitySettings.includes("视觉输入"), true);
  assert.equal(capabilitySettings.includes("思考强度"), true);
  assert.equal(capabilitySettings.includes("上下文窗口"), true);
  assert.equal(capabilitySettings.includes("最大输出"), true);
  assert.equal(capabilitySettings.includes("API 风格"), false);
  assert.equal(capabilitySettings.includes("稳定性"), false);
  assert.equal(capabilitySettings.includes("验证日期"), false);
  assert.equal(capabilitySettings.includes("工具调用"), false);
  assert.equal(capabilitySettings.includes("并行工具"), false);
  assert.equal(capabilitySettings.includes("结构化输出"), false);
  assert.equal(capabilitySettings.includes("流式输出"), false);
  assert.equal(capabilitySettings.includes("推理输出"), false);
  assert.equal(capabilitySettings.includes("overrideCapabilities"), true);
  assert.equal(skillSettings.includes("export function SkillSettings"), true);
  assert.equal(skillSettings.includes("按任务触发的工作流说明"), false);
  assert.equal(skillSettings.includes("暂无技能"), true);
  assert.equal(skillSettings.includes('aria-label="技能列表"'), true);
  assert.equal(skillSettings.includes("SKILL.md"), false);
  assert.equal(skillSettings.includes("sourcePath"), false);
  assert.equal(skillSettings.includes("按任务匹配"), false);
  assert.equal(skillSettings.includes("最近使用"), true);
  assert.equal(appearanceSettings.includes("export function AppearanceSettings"), true);
  assert.equal(appearanceSettings.includes("useBrowserAppearanceSnapshot"), false);
  assert.equal(appearanceSettings.includes("<ThemeSwitcher"), true);
  assert.equal(appearanceSettings.includes("当前环境"), false);
  assert.equal(appearanceSettings.includes('className="appearance-toggle-badge"'), true);
  assert.equal(appearanceSettings.includes('<span className="appearance-toggle-badge">beta</span>'), true);
  assert.equal(usageStatisticsSettings.includes("export function UsageStatisticsSettings"), true);
  assert.equal(usageStatisticsSettings.includes("/api/runtime/usage-statistics"), true);
  assert.equal(usageStatisticsSettings.includes("<ThemeSwitcher"), false);
  assert.equal(capabilitySettings.includes("网络搜索"), true);
  assert.equal(capabilitySettings.includes("秘塔搜索"), true);
  assert.equal(capabilitySettings.includes("网页查证"), false);
  assert.equal(capabilitySettings.includes("McpReferencePanel"), true);
  assert.equal(settingsDialog.includes("onSaveModelCapabilities"), true);
  assert.equal(workspaceStyles.includes(".service-settings-card"), true);
  assert.equal(workspaceStyles.includes(".model-info-card"), true);
  assert.equal(workspaceStyles.includes(".model-info-grid"), true);
  assert.equal(workspaceStyles.includes(".model-info-field select"), true);
  assert.equal(workspaceStyles.includes("overflow: visible;"), true);
  assert.equal(workspaceStyles.includes(".settings-select-control.open"), true);
  assert.equal(glassStyle.includes('html[data-style="glass"] .service-settings-card'), true);
  assert.equal(glassStyle.includes("overflow: visible;"), true);
  assert.equal(capabilitySettings.includes("由模型按任务判断"), false);
  assert.equal(capabilitySettings.includes("这里配置可用服务和安全边界"), false);
  assert.equal(capabilitySettings.includes("不替助手决定"), false);
  assert.equal(capabilitySettings.includes("工作方法只作为可注入"), false);
  assert.equal(capabilitySettings.includes("当前没有发现"), false);
  assert.equal(capabilitySettings.includes("接入工具"), false);
  assert.equal(capabilitySettings.includes("管理助手可调用"), false);
  assert.equal(workspaceSettings.includes("export function WorkspaceSettings"), true);
  assert.equal(workspaceSettings.includes('from "./command-shell-selection"'), true);
  assert.equal(workspaceSettings.includes('from "./runtime-environment-settings"'), true);
  assert.equal(workspaceSettings.includes("React.lazy"), false);
  assert.equal(workspaceSettings.includes('import("./command-shell-selection")'), false);
  assert.equal(workspaceSettings.includes("function loadCommandShellSelection"), false);
  assert.equal(workspaceSettings.includes("export function preloadCommandShellSelection"), false);
  assert.equal(workspaceSettings.includes("commandShellSelectionModulePromise"), false);
  assert.equal(workspaceSettings.includes("<CommandShellSelection"), true);
  assert.equal(workspaceSettings.includes("<LazyCommandShellSelection"), false);
  assert.equal(workspaceSettings.includes("CommandShellSelectionFallback"), false);
  assert.equal(workspaceSettings.includes("configuredKind"), false);
  assert.equal(workspaceSettings.includes("settings-runtime-list"), false);
  assert.equal(workspaceSettings.includes("<h3>默认文件夹</h3>"), true);
  assert.equal(workspaceSettings.includes('label="路径"'), true);
  assert.equal(workspaceSettings.includes("FolderOpen"), true);
  assert.equal(workspaceSettings.includes("<span>选择</span>"), true);
  assert.equal(workspaceSettings.includes("RotateCcw"), true);
  assert.equal(workspaceSettings.includes("<span>默认</span>"), true);
  assert.equal(workspaceSettings.includes("工作目录"), false);
  assert.equal(commandShellSelection.includes("export function CommandShellSelection"), true);
  assert.equal(commandShellSelection.includes("configuredKind"), true);
  assert.equal(commandShellSelection.includes("settings-runtime-list"), false);
  assert.equal(commandShellSelection.includes("commandShellPending"), true);
  assert.equal(commandShellSelection.includes("commandShellOptions"), true);
  assert.equal(commandShellSelection.includes("commandShellSummary"), true);
  assert.equal(runtimeEnvironmentSettings.includes("export function RuntimeEnvironmentSettings"), true);
  assert.equal(runtimeEnvironmentSettings.includes("settings-runtime-list"), true);
  assert.equal(runtimeToolIcons.includes('import pythonLogo from "./runtime-tool-icon-assets/python.svg?raw"'), true);
  assert.equal(runtimeToolIcons.includes('["python", "python"]'), true);
  assert.equal(pythonRuntimeIcon.includes('viewBox="0 0 256 255"'), true);
  assert.equal(pythonRuntimeIcon.includes("width="), false);
  assert.equal(pythonRuntimeIcon.includes("height="), false);
  assert.equal(pythonRuntimeIcon.includes('id="pythonBlue"'), true);
  assert.equal(pythonRuntimeIcon.includes('id="pythonYellow"'), true);
  assert.equal(pythonRuntimeIcon.includes("width=\"83.371017pt\""), false);
  assert.equal(pythonRuntimeIcon.includes("sodipodi:"), false);
  assert.equal(workspaceSettings.includes("这是助手可使用的本地上下文边界"), false);
  assert.equal(workspaceCommon.includes("export function PageHeader"), false);
  assert.equal(workspaceCommon.includes("export function SearchBox"), false);
  assert.equal(workspaceCommon.includes("export function TabBar"), false);
  assert.equal(workspaceCommon.includes("export function IconTile"), false);
  assert.equal(workspaceCommon.includes("export function Toggle"), false);
  assert.equal(workspaceCommon.includes("export function Pill"), false);
  assert.equal(workspaceCommon.includes("export function SettingRow"), true);
  assert.equal(modelSettings.includes('from "./model-settings-projection"'), true);
  assert.equal(modelSettings.includes('from "./model-catalog-panel"'), true);
  assert.equal(modelSettings.includes('from "./model-provider-form"'), true);
  assert.equal(modelSettings.includes('from "./model-provider-list"'), true);
  assert.equal(modelSettings.includes('from "./model-settings-icons"'), true);
  assert.equal(modelSettings.includes('from "../model-capability-display"'), false);
  assert.equal(modelSettings.includes("modelCapabilitySummary"), false);
  assert.equal(modelSettings.includes('from "./model-catalog-state"'), true);
  assert.equal(modelSettings.includes('from "./model-settings-list-equality"'), true);
  assert.equal(modelSettings.includes("function sameStringList"), false);
  assert.equal(modelSettings.includes("className=\"provider-list-pane\""), false);
  assert.equal(modelSettings.includes("className=\"provider-form\""), false);
  assert.equal(modelSettings.includes("className=\"model-list-panel\""), false);
  assert.equal(modelSettings.includes("useState<Record<string, ModelProviderModelCatalog>>"), false);
  assert.equal(modelSettings.includes("useState<Record<string, string>>"), false);
  assert.equal(modelSettings.includes("function modelProviderItems"), false);
  assert.equal(modelSettings.includes("function filterModelCatalogItems"), false);
  assert.equal(modelSettings.includes("function formatModelCount"), false);
  assert.equal(modelSettings.includes("function requestPathOptionsForProvider"), false);
  assert.equal(modelSettings.includes("modelProviderSortRank"), false);
  assert.equal(modelCatalogPanel.includes("export function ModelCatalogPanel"), true);
  assert.equal(modelCatalogPanel.includes("function SavedModels"), true);
  assert.equal(modelCatalogPanel.includes("function FetchedModels"), true);
  assert.equal(modelCatalogPanel.includes("modelMeta"), false);
  assert.equal(modelCatalogPanel.includes("modelRowMeta"), false);
  assert.equal(modelCatalogPanel.includes("上下文"), false);
  assert.equal(modelCatalogPanel.includes("输出"), false);
  assert.equal(modelCatalogPanel.includes("className=\"model-list-panel\""), true);
  assert.equal(modelCatalogPanel.includes("formatModelCount"), true);
  assert.equal(modelProviderForm.includes("export function ModelProviderForm"), true);
  assert.equal(modelProviderForm.includes("requestPathOptionsForProvider"), true);
  assert.equal(modelProviderForm.includes("className=\"provider-form\""), true);
  assert.equal(modelProviderList.includes("export function ModelProviderList"), true);
  assert.equal(modelProviderList.includes("className=\"provider-list-pane\""), true);
  assert.equal(modelProviderList.includes('from "./model-settings-list-equality"'), true);
  assert.equal(modelProviderList.includes("function sameStringList"), false);
  assert.equal(modelSettingsIcons.includes("export function ModelIcon"), true);
  assert.equal(modelSettingsIcons.includes("export function ProviderLogo"), true);
  assert.equal(modelSettingsListEquality.includes("export function sameStringList"), true);
  assert.equal(modelSettingsListEquality.includes("left: readonly string[] | undefined"), true);
  assert.equal(modelSettingsListEquality.includes("right: readonly string[] | undefined"), true);
  assert.equal(modelSettingsListEquality.includes("left === right"), true);
  assert.equal(modelSettingsListEquality.includes("left === undefined || right === undefined"), true);
  assert.equal(modelCatalogState.includes("export function useModelCatalogState"), true);
  assert.equal(modelCatalogState.includes("modelCatalogItemsWithConfiguredModel"), true);
  assert.equal(modelCatalogState.includes("filterModelCatalogItems"), true);
  assert.equal(modelCatalogState.includes("export function removeRecordKey"), true);
  assert.equal(modelSettingsProjection.includes("export type ModelForm"), true);
  assert.equal(modelSettingsProjection.includes("export function modelProviderItems"), true);
  assert.equal(modelSettingsProjection.includes("export function filterModelCatalogItems"), true);
  assert.equal(modelSettingsProjection.includes("export function requestPathOptionsForProvider"), true);
  assert.equal(modelSettingsProjection.includes("/chat/completions"), true);
  assert.equal(modelSettingsProjection.includes("anthropic_messages"), false);
  assert.equal(modelSettingsProjection.includes("gemini_generate_content"), false);
  assert.equal(modelSettingsProjection.includes("ollama_generate"), false);
  assert.equal(modelSettingsProjection.includes("modelProviderSortRank"), true);
  assert.equal(modelSettings.includes("可添加"), false);
  assert.equal(modelCatalogPanel.includes("可添加"), true);
  assert.equal(modelSettings.includes("provider-base-url-field"), false);
  assert.equal(modelProviderForm.includes("provider-base-url-field"), true);
  assert.equal(settingsDialog.includes("请求路径"), false);
  assert.equal(modelSettings.includes("高级兼容设置"), false);
  assert.equal(modelProviderForm.includes("高级兼容设置"), true);
  assert.equal(modelSettings.includes("暂无模型服务。请添加一个模型服务。"), true);
  assert.equal(modelSettings.includes("/chat/completions"), false);
  assert.equal(modelSettings.includes("resolveModelProviderLogo"), false);
  assert.equal(modelSettingsIcons.includes("resolveModelProviderLogo"), true);
  assert.equal(modelSettings.includes("providerLogoText"), false);
  assert.equal(settingsDialog.includes("provider-reasoning-panel"), false);
  assert.equal(settingsDialog.includes("思考强度"), false);
  assert.equal(modelProviderLogos.includes('from "./assets/providers/openai.svg?raw"'), true);
  assert.equal(modelProviderLogos.includes('from "./assets/providers/anthropic.svg?raw"'), false);
  assert.equal(modelProviderLogos.includes('from "./assets/providers/deepseek.svg?raw"'), true);
  assert.equal(modelProviderLogos.includes('from "./assets/providers/kimi.svg?raw"'), true);
  assert.equal(modelProviderLogos.includes('from "./assets/providers/zai.svg?raw"'), true);
  assert.equal(modelProviderLogos.includes('from "./assets/providers/minimax.svg?raw"'), true);
  assert.equal(modelIcons.includes('from "./assets/model-icons/chatgpt_gpt_model_icon.svg?raw"'), true);
  assert.equal(modelIcons.includes('from "./assets/model-icons/claude_model_icon.svg?raw"'), true);
  assert.equal(modelIcons.includes('from "./assets/model-icons/deepseek_model_icon.svg?raw"'), true);
  assert.equal(modelIcons.includes('from "./assets/model-icons/kimi_model_icon.svg?raw"'), true);
  assert.equal(modelIcons.includes('from "./assets/model-icons/glm.svg?raw"'), true);
  assert.equal(modelIcons.includes('from "./assets/model-icons/minimax_model_icon.svg?raw"'), true);
  assert.equal(styleEntry.includes('@import "./styles/settings.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/settings-provider.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/settings-model-list.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/settings-forms.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/settings-usage.css"'), true);
  assert.equal(settingsShellStyles.includes(".settings-dialog"), true);
  assert.equal(settingsShellStyles.includes(".settings-provider-manager"), false);
  assert.equal(settingsProviderStyles.includes(".settings-provider-manager"), true);
  assert.equal(settingsProviderStyles.includes(".provider-list-pane"), true);
  assert.equal(settingsProviderStyles.includes(".model-list-panel"), false);
  assert.equal(settingsModelListStyles.includes(".model-list-panel"), true);
  assert.equal(settingsModelListStyles.includes(".model-row-icon"), true);
  assert.equal(settingsModelListStyles.includes(".model-candidate-copy small"), true);
  assert.equal(settingsModelListStyles.includes(".settings-row"), false);
  assert.equal(settingsFormStyles.includes(".settings-row"), true);
  assert.equal(settingsFormStyles.includes(".model-catalog-grid"), true);
  assert.equal(settingsFormStyles.includes(".about-product-github-link"), true);
  assert.equal(settingsFormStyles.includes(".about-update-card"), true);
  assert.equal(settingsFormStyles.includes(".about-update-check-button"), true);
  assert.equal(settingsFormStyles.includes(".about-update-download-link"), true);
  assert.equal(settingsUsageStyles.includes(".usage-stat-grid"), true);
  assert.equal(settingsUsageStyles.includes(".usage-heatmap-grid"), true);
});
