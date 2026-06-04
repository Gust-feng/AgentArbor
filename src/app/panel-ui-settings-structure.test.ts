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
    workspaceSettings,
    confirmationSettings,
    modelSettings,
    modelCatalogPanel,
    modelProviderForm,
    modelProviderList,
    modelSettingsIcons,
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
  ] = await Promise.all([
    readPanelUiSource(path.join("components", "settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "settings-types.ts")),
    readPanelUiSource(path.join("components", "settings-tool-copy.ts")),
    readPanelUiSource(path.join("components", "capability-settings.tsx")),
    readPanelUiSource(path.join("components", "workspace-settings.tsx")),
    readPanelUiSource(path.join("components", "confirmation-settings.tsx")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
    readPanelUiSource(path.join("components", "model-catalog-panel.tsx")),
    readPanelUiSource(path.join("components", "model-provider-form.tsx")),
    readPanelUiSource(path.join("components", "model-provider-list.tsx")),
    readPanelUiSource(path.join("components", "model-settings-icons.tsx")),
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
  ]);

  assert.equal(settingsDialog.includes('from "./skills-page"'), false);
  assert.equal(settingsDialog.includes('from "./tools-page"'), false);
  assert.equal(settingsDialog.includes('from "./capability-settings"'), true);
  assert.equal(settingsDialog.includes('from "./confirmation-settings"'), true);
  assert.equal(settingsDialog.includes('from "./model-settings"'), true);
  assert.equal(settingsDialog.includes('from "./settings-types"'), true);
  assert.equal(settingsDialog.includes('from "./workspace-settings"'), true);
  assert.equal(settingsDialog.includes('export type { ModelForm, SettingsGroup, ToolForm } from "./settings-types"'), true);
  assert.equal(settingsDialog.includes("export function SettingsDialog"), true);
  assert.equal(settingsDialog.includes("initialGroup?: SettingsGroup"), true);
  assert.equal(settingsDialog.includes('useState<SettingsGroup>("models")'), true);
  assert.equal(settingsDialog.includes('props.initialGroup ?? "models"'), true);
  assert.equal(settingsDialog.includes('label: "模型服务"'), true);
  assert.equal(settingsDialog.includes('label: "能力与服务"'), true);
  assert.equal(settingsDialog.includes('label: "工作区"'), true);
  assert.equal(settingsDialog.includes('label: "确认边界"'), true);
  assert.equal(settingsDialog.includes("<CapabilitiesSettings"), true);
  assert.equal(settingsDialog.includes("<WorkspaceSettings"), true);
  assert.equal(settingsDialog.includes("<ConfirmationSettings"), true);
  assert.equal(settingsDialog.includes("function Capability"), false);
  assert.equal(settingsDialog.includes("function WorkspaceSettings"), false);
  assert.equal(settingsDialog.includes("function ConfirmationSettings"), false);
  assert.equal(settingsDialog.includes("function ModelSettings"), false);
  assert.equal(settingsDialog.includes("function ModelIcon"), false);
  assert.equal(settingsDialog.includes("function modelProviderItems"), false);
  assert.equal(settingsDialog.includes("resolveModelProviderLogo"), false);
  assert.equal(settingsDialog.includes("provider-base-url-field"), false);
  assert.equal(settingsDialog.includes("网页查证"), false);
  assert.equal(settingsDialog.includes("工作方法"), false);
  assert.equal(settingsDialog.includes("由模型按任务判断"), false);
  assert.equal(settingsDialog.includes("接入工具"), false);
  assert.equal(settingsDialog.includes("管理助手可调用"), false);
  assert.equal(settingsDialog.includes('label: "助手能力"'), false);
  assert.equal(settingsDialog.includes('label: "能力"'), false);
  assert.equal(settingsDialog.includes('label: "常规"'), false);
  assert.equal(settingsDialog.includes('label: "界面"'), false);
  assert.equal(settingsDialog.includes("function GeneralSettings"), false);
  assert.equal(settingsDialog.includes("function AppearanceSettings"), false);
  assert.equal(settingsDialog.includes("onStartSkill"), false);
  assert.equal(settingsTypes.includes('export type { ModelForm } from "./model-settings"'), true);
  assert.equal(settingsTypes.includes("export type ToolForm"), true);
  assert.equal(settingsTypes.includes('export type SettingsGroup = "models" | "capabilities" | "workspace" | "confirmation";'), true);
  assert.equal(settingsToolCopy.includes("export function toolTitle"), true);
  assert.equal(settingsToolCopy.includes("export function toolDescription"), true);
  assert.equal(settingsToolCopy.includes("export function toolMeta"), true);
  assert.equal(settingsToolCopy.includes("export function confirmationRuleLabel"), true);
  assert.equal(settingsToolCopy.includes("export function providerName"), true);
  assert.equal(capabilitySettings.includes("export function CapabilitiesSettings"), true);
  assert.equal(capabilitySettings.includes("function WebSearchSettings"), true);
  assert.equal(capabilitySettings.includes("function ToolCatalogSettings"), true);
  assert.equal(capabilitySettings.includes("function SkillContextSettings"), true);
  assert.equal(capabilitySettings.includes("function CapabilityRow"), true);
  assert.equal(capabilitySettings.includes("这里配置可用服务和安全边界"), true);
  assert.equal(capabilitySettings.includes("工作方法"), true);
  assert.equal(capabilitySettings.includes("网页查证"), true);
  assert.equal(capabilitySettings.includes("由模型按任务判断"), true);
  assert.equal(capabilitySettings.includes("接入工具"), false);
  assert.equal(capabilitySettings.includes("管理助手可调用"), false);
  assert.equal(workspaceSettings.includes("export function WorkspaceSettings"), true);
  assert.equal(workspaceSettings.includes("这是助手可使用的本地上下文边界"), true);
  assert.equal(confirmationSettings.includes("export function ConfirmationSettings"), true);
  assert.equal(confirmationSettings.includes("确认门只处理高影响动作的授权"), true);
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
  assert.equal(modelSettings.includes('from "./model-catalog-state"'), true);
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
  assert.equal(modelCatalogPanel.includes("className=\"model-list-panel\""), true);
  assert.equal(modelCatalogPanel.includes("formatModelCount"), true);
  assert.equal(modelProviderForm.includes("export function ModelProviderForm"), true);
  assert.equal(modelProviderForm.includes("requestPathOptionsForProvider"), true);
  assert.equal(modelProviderForm.includes("className=\"provider-form\""), true);
  assert.equal(modelProviderList.includes("export function ModelProviderList"), true);
  assert.equal(modelProviderList.includes("className=\"provider-list-pane\""), true);
  assert.equal(modelSettingsIcons.includes("export function ModelIcon"), true);
  assert.equal(modelSettingsIcons.includes("export function ProviderLogo"), true);
  assert.equal(modelCatalogState.includes("export function useModelCatalogState"), true);
  assert.equal(modelCatalogState.includes("modelCatalogItemsWithConfiguredModel"), true);
  assert.equal(modelCatalogState.includes("filterModelCatalogItems"), true);
  assert.equal(modelCatalogState.includes("export function removeRecordKey"), true);
  assert.equal(modelSettingsProjection.includes("export type ModelForm"), true);
  assert.equal(modelSettingsProjection.includes("export function modelProviderItems"), true);
  assert.equal(modelSettingsProjection.includes("export function filterModelCatalogItems"), true);
  assert.equal(modelSettingsProjection.includes("export function requestPathOptionsForProvider"), true);
  assert.equal(modelSettingsProjection.includes("/chat/completions"), true);
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
  assert.equal(modelProviderLogos.includes('from "./assets/providers/anthropic.svg?raw"'), true);
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
  assert.equal(settingsShellStyles.includes(".settings-dialog"), true);
  assert.equal(settingsShellStyles.includes(".settings-provider-manager"), false);
  assert.equal(settingsProviderStyles.includes(".settings-provider-manager"), true);
  assert.equal(settingsProviderStyles.includes(".provider-list-pane"), true);
  assert.equal(settingsProviderStyles.includes(".model-list-panel"), false);
  assert.equal(settingsModelListStyles.includes(".model-list-panel"), true);
  assert.equal(settingsModelListStyles.includes(".model-row-icon"), true);
  assert.equal(settingsModelListStyles.includes(".settings-row"), false);
  assert.equal(settingsFormStyles.includes(".settings-row"), true);
  assert.equal(settingsFormStyles.includes(".model-catalog-grid"), true);
});
