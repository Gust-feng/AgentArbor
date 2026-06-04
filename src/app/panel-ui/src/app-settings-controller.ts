import type React from "react";
import {
  catalogRecordFromList,
  createCustomModelProviderProfile,
  fetchModelProviderCatalog,
  mergeCatalogsIntoConfig,
  revealModelProviderApiKey,
  saveModelProviderCatalog,
  saveModelProviderConfig,
  saveToolSettings,
  saveWorkspaceDirectory,
  selectModelProviderModel,
  updateSkillState,
  updateToolState,
} from "./app-config-actions";
import { mergeConfigResponse, type VisibleAiMode } from "./app-config-projection";
import type { AppState } from "./app-state";
import type { ModelForm, ToolForm } from "./components/settings-types";
import type { ModelProviderModelCatalog } from "./contracts/config";

export type AppSettingsController = {
  readonly saveModelConfig: (nextModelForm?: ModelForm) => Promise<void>;
  readonly createCustomModelProfile: () => Promise<void>;
  readonly revealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly selectComposerModel: (modelOptionId: string) => Promise<void>;
  readonly fetchModelsForProfile: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly saveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly saveWorkspace: (nextWorkspaceDirectory?: string) => Promise<void>;
  readonly saveTools: () => Promise<void>;
  readonly updateTool: (toolName: string, enabled: boolean) => Promise<void>;
  readonly updateSkill: (skillId: string, enabled: boolean) => Promise<void>;
};

export type AppSettingsControllerOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly aiMode: VisibleAiMode;
  readonly modelForm: ModelForm;
  readonly setModelForm: React.Dispatch<React.SetStateAction<ModelForm>>;
  readonly setModelCatalogs: React.Dispatch<React.SetStateAction<Record<string, ModelProviderModelCatalog>>>;
  readonly workspaceDirectory: string;
  readonly toolForm: ToolForm;
  readonly setToolForm: React.Dispatch<React.SetStateAction<ToolForm>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly modelSaveQueueRef: React.MutableRefObject<Promise<void>>;
  readonly setSavingModel: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setSavingWorkspace: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setSavingTools: React.Dispatch<React.SetStateAction<boolean>>;
};

export function createAppSettingsController(options: AppSettingsControllerOptions): AppSettingsController {
  async function saveModelConfig(nextModelForm: ModelForm = options.modelForm): Promise<void> {
    const save = options.modelSaveQueueRef.current
      .catch(() => undefined)
      .then(() => persistModelConfig(nextModelForm));
    options.modelSaveQueueRef.current = save.catch(() => undefined);
    await save;
  }

  async function persistModelConfig(nextModelForm: ModelForm): Promise<void> {
    options.setSavingModel(true);
    try {
      const response = await saveModelProviderConfig({
        config: options.app.config,
        form: nextModelForm,
        aiMode: options.aiMode,
      });
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, response) }));
        options.setModelForm((previous) => ({
          ...previous,
          apiKey: nextModelForm.apiKeyCleared ? "" : previous.apiKey,
          apiKeyCleared: false,
        }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "模型服务保存失败。"}`,
        }));
      }
      throw error;
    } finally {
      if (options.mountedRef.current) options.setSavingModel(false);
    }
  }

  async function createCustomModelProfile(): Promise<void> {
    options.setSavingModel(true);
    try {
      const activated = await createCustomModelProviderProfile({
        form: options.modelForm,
        aiMode: options.aiMode,
      });
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, activated) }));
        options.setModelForm((previous) => ({ ...previous, apiKey: "", apiKeyCleared: false }));
      }
    } finally {
      if (options.mountedRef.current) options.setSavingModel(false);
    }
  }

  async function revealModelApiKey(profileId: string): Promise<string | undefined> {
    try {
      return await revealModelProviderApiKey(profileId);
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "API Key 读取失败。"}`,
        }));
      }
      throw error;
    }
  }

  async function selectComposerModel(modelOptionId: string): Promise<void> {
    options.setSavingModel(true);
    try {
      const selected = await selectModelProviderModel({
        config: options.app.config,
        modelOptionId,
        aiMode: options.aiMode,
      });
      if (options.mountedRef.current && selected.config !== undefined) {
        options.setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, selected.config!) }));
        if (selected.form !== undefined) {
          options.setModelForm(selected.form);
        }
      }
    } finally {
      if (options.mountedRef.current) options.setSavingModel(false);
    }
  }

  async function fetchModelsForProfile(
    profileId = options.app.config?.config?.profileId
  ): Promise<ModelProviderModelCatalog | undefined> {
    if (profileId === undefined) return undefined;
    options.setSavingModel(true);
    try {
      const response = await fetchModelProviderCatalog(profileId);
      if (options.mountedRef.current) {
        const catalogs = response.catalogs ?? options.app.config?.modelCatalogs;
        if (catalogs !== undefined) {
          options.setModelCatalogs(catalogRecordFromList(catalogs));
          options.setApp((previous) => ({
            ...previous,
            config: mergeCatalogsIntoConfig(previous.config, catalogs),
          }));
        }
      }
      return response.catalog;
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "模型列表获取失败。"}`,
        }));
      }
      return undefined;
    } finally {
      if (options.mountedRef.current) options.setSavingModel(false);
    }
  }

  async function saveModelCatalog(profileId: string, catalog: ModelProviderModelCatalog): Promise<void> {
    options.setSavingModel(true);
    try {
      const catalogs = await saveModelProviderCatalog({ profileId, catalog });
      if (options.mountedRef.current) {
        options.setModelCatalogs(catalogRecordFromList(catalogs));
        options.setApp((previous) => ({
          ...previous,
          config: mergeCatalogsIntoConfig(previous.config, catalogs),
        }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "模型保存失败。"}`,
        }));
      }
      throw error;
    } finally {
      if (options.mountedRef.current) options.setSavingModel(false);
    }
  }

  async function saveWorkspace(nextWorkspaceDirectory: string = options.workspaceDirectory): Promise<void> {
    options.setSavingWorkspace(true);
    try {
      const workspace = await saveWorkspaceDirectory(nextWorkspaceDirectory);
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, config: { ...previous.config, workspace } }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "工作目录保存失败。"}`,
        }));
      }
    } finally {
      if (options.mountedRef.current) options.setSavingWorkspace(false);
    }
  }

  async function saveTools(): Promise<void> {
    options.setSavingTools(true);
    try {
      const response = await saveToolSettings(options.toolForm);
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, tools: response }));
        options.setToolForm((previous) => ({ ...previous, tavilyApiKey: "" }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "工具配置保存失败。"}`,
        }));
      }
    } finally {
      if (options.mountedRef.current) options.setSavingTools(false);
    }
  }

  async function updateTool(toolName: string, enabled: boolean): Promise<void> {
    options.setSavingTools(true);
    try {
      const response = await updateToolState(toolName, enabled);
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, tools: response }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "工具状态保存失败。"}`,
        }));
      }
    } finally {
      if (options.mountedRef.current) options.setSavingTools(false);
    }
  }

  async function updateSkill(skillId: string, enabled: boolean): Promise<void> {
    options.setSavingTools(true);
    try {
      const skills = await updateSkillState(skillId, enabled);
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, skills }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "工作方法状态保存失败。"}`,
        }));
      }
    } finally {
      if (options.mountedRef.current) options.setSavingTools(false);
    }
  }

  return {
    saveModelConfig,
    createCustomModelProfile,
    revealModelApiKey,
    selectComposerModel,
    fetchModelsForProfile,
    saveModelCatalog,
    saveWorkspace,
    saveTools,
    updateTool,
    updateSkill,
  };
}
