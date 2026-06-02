import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("panel UI settings and model modules stay split", async () => {
  const [
    workspacePages,
    modelSettings,
    modelCatalogPanel,
    modelProviderForm,
    modelProviderList,
    modelSettingsIcons,
    modelCatalogState,
    modelSettingsProjection,
    skillsPage,
    toolsPage,
    workspaceCommon,
    modelProviderLogos,
    modelIcons,
    styleEntry,
    settingsShellStyles,
    settingsProviderStyles,
    settingsModelListStyles,
    settingsFormStyles,
  ] = await Promise.all([
    readPanelUiSource(path.join("components", "workspace-pages.tsx")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
    readPanelUiSource(path.join("components", "model-catalog-panel.tsx")),
    readPanelUiSource(path.join("components", "model-provider-form.tsx")),
    readPanelUiSource(path.join("components", "model-provider-list.tsx")),
    readPanelUiSource(path.join("components", "model-settings-icons.tsx")),
    readPanelUiSource(path.join("components", "model-catalog-state.ts")),
    readPanelUiSource(path.join("components", "model-settings-projection.ts")),
    readPanelUiSource(path.join("components", "skills-page.tsx")),
    readPanelUiSource(path.join("components", "tools-page.tsx")),
    readPanelUiSource(path.join("components", "workspace-common.tsx")),
    readPanelUiSource("model-provider-logos.ts"),
    readPanelUiSource("model-icons.ts"),
    readPanelUiSource("styles.css"),
    readPanelUiStyle("settings.css"),
    readPanelUiStyle("settings-provider.css"),
    readPanelUiStyle("settings-model-list.css"),
    readPanelUiStyle("settings-forms.css"),
  ]);

  assert.equal(workspacePages.includes('export { SkillsPage } from "./skills-page"'), true);
  assert.equal(workspacePages.includes('export { ToolsPage, type ToolForm } from "./tools-page"'), true);
  assert.equal(workspacePages.includes("function SkillCard"), false);
  assert.equal(workspacePages.includes("function ToolRow"), false);
  assert.equal(skillsPage.includes("export function SkillsPage"), true);
  assert.equal(skillsPage.includes("function SkillCard"), true);
  assert.equal(toolsPage.includes("export function ToolsPage"), true);
  assert.equal(toolsPage.includes("function ToolRow"), true);
  assert.equal(workspaceCommon.includes("export function PageHeader"), true);
  assert.equal(workspaceCommon.includes("export function SettingRow"), true);
  assert.equal(workspacePages.includes("export function SettingsDialog"), true);
  assert.equal(workspacePages.includes("initialGroup?: SettingsGroup"), true);
  assert.equal(workspacePages.includes("function ModelSettings"), false);
  assert.equal(workspacePages.includes("function ModelIcon"), false);
  assert.equal(workspacePages.includes("function modelProviderItems"), false);
  assert.equal(workspacePages.includes("resolveModelProviderLogo"), false);
  assert.equal(workspacePages.includes("provider-base-url-field"), false);
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
  assert.equal(workspacePages.includes("请求路径"), false);
  assert.equal(modelSettings.includes("高级兼容设置"), false);
  assert.equal(modelProviderForm.includes("高级兼容设置"), true);
  assert.equal(modelSettings.includes("暂无模型服务。请添加一个模型服务。"), true);
  assert.equal(modelSettings.includes("/chat/completions"), false);
  assert.equal(modelSettings.includes("resolveModelProviderLogo"), false);
  assert.equal(modelSettingsIcons.includes("resolveModelProviderLogo"), true);
  assert.equal(modelSettings.includes("providerLogoText"), false);
  assert.equal(workspacePages.includes("provider-reasoning-panel"), false);
  assert.equal(workspacePages.includes("思考强度"), false);
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
