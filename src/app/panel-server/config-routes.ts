import type { IncomingMessage, ServerResponse } from "node:http";
import type { SanitizedWebSearchConfig } from "../../domain/config/index.js";
import { listBuiltinModelProviderPresets } from "../../domain/config/index.js";
import { fetchModelRuntimeModelCatalog } from "../model-runtime/index.js";
import { CapabilityCenter } from "../capability-center.js";
import {
  ConfigCenter,
  ConfigCenterValidationError,
  WorkspaceDirectoryValidationError,
} from "../config-center.js";
import {
  createDesktopBasicToolRegistry,
  type ToolCatalogSnapshot,
} from "../basic-agent-runtime/index.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import {
  parseConfigUpdate,
  parseCreateModelProfile,
  parseInformationAccessUpdate,
  parseModelCatalogUpdate,
  parseMcpServerUpdate,
  parseToolStateUpdate,
  parseWebSearchUpdate,
  parseWorkspaceUpdate,
} from "./request-parsers.js";
import type { PanelModelCatalogFetch, PanelProviderFetch } from "./types.js";

export type PanelConfigRouteRuntime = {
  readonly configCenter: ConfigCenter;
  readonly capabilityCenter: CapabilityCenter;
  readonly providerFetch?: PanelProviderFetch;
  readonly modelCatalogFetch?: PanelModelCatalogFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
};

type PanelToolsConfig = {
  readonly webSearch: SanitizedWebSearchConfig;
  readonly catalog: ToolCatalogSnapshot;
};

export async function handlePanelConfigRoute(
  runtime: PanelConfigRouteRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/config") {
    const config = await runtime.configCenter.getModelProviderConfig();
    const capabilities = await runtime.capabilityCenter.snapshot();
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      config,
      profiles: await runtime.configCenter.listModelProviderProfiles(),
      modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
      modelProviderMarket: {
        presets: listBuiltinModelProviderPresets(),
      },
      capabilities,
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
      workspace: await runtime.configCenter.getWorkspaceConfig(),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/config/capabilities") {
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      capabilities: await runtime.capabilityCenter.snapshot(),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/config/model-profiles") {
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      profiles: await runtime.configCenter.listModelProviderProfiles(),
      activeProfile: await runtime.configCenter.getModelProviderConfig(),
      modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
      modelProviderMarket: {
        presets: listBuiltinModelProviderPresets(),
      },
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/config/model-provider-market") {
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      presets: listBuiltinModelProviderPresets(),
      profiles: await runtime.configCenter.listModelProviderProfiles(),
      activeProfile: await runtime.configCenter.getModelProviderConfig(),
      modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/config/model-profiles") {
    const body = await readJsonBody(request);
    try {
      const profile = await runtime.configCenter.createModelProviderProfile(parseCreateModelProfile(body));
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        profile,
        profiles: await runtime.configCenter.listModelProviderProfiles(),
        modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
        modelProviderMarket: {
          presets: listBuiltinModelProviderPresets(),
        },
        capabilities: await runtime.capabilityCenter.snapshot(),
      });
      return true;
    } catch (error) {
      throw configCenterHttpError(error);
    }
  }

  const modelProfileMatch = /^\/api\/config\/model-profiles\/([^/]+)$/.exec(url.pathname);
  if (request.method === "POST" && modelProfileMatch !== null) {
    const body = await readJsonBody(request);
    try {
      const profileId = decodeURIComponent(modelProfileMatch[1] ?? "");
      const profile = await runtime.configCenter.updateModelProviderConfig({
        ...parseConfigUpdate(body),
        profileId,
      });
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        profile,
        profiles: await runtime.configCenter.listModelProviderProfiles(),
        modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
        modelProviderMarket: {
          presets: listBuiltinModelProviderPresets(),
        },
        capabilities: await runtime.capabilityCenter.snapshot(),
      });
      return true;
    } catch (error) {
      throw configCenterHttpError(error);
    }
  }

  const modelProfileModelsMatch = /^\/api\/config\/model-profiles\/([^/]+)\/models$/.exec(url.pathname);
  if (request.method === "GET" && modelProfileModelsMatch !== null) {
    try {
      const profileId = decodeURIComponent(modelProfileModelsMatch[1] ?? "");
      const profile = (await runtime.configCenter.listModelProviderProfiles()).find((item) => item.profileId === profileId);
      if (profile === undefined) {
        throw new PanelHttpError(404, "model_profile_not_found", "未找到模型配置。");
      }
      const supportedCatalogProvider =
        (profile.providerKind === "openai_compatible" &&
          (profile.protocolKind === "openai_compatible_chat_completions" || profile.protocolKind === "openai_responses")) ||
        (profile.providerKind === "anthropic" && profile.protocolKind === "anthropic_messages");
      if (!supportedCatalogProvider) {
        throw new PanelHttpError(400, "unsupported_model_provider", "当前厂商暂不支持直接获取模型列表。");
      }
      const apiKey = await runtime.configCenter.getModelProviderApiKey(profile.profileId);
      if (apiKey === undefined) {
        throw new PanelHttpError(400, "missing_model_provider_key", "获取模型列表前需要先保存该厂商的 API Key。");
      }
      const catalog = await fetchModelRuntimeModelCatalog({
        profile,
        apiKey,
        fetch: runtime.modelCatalogFetch,
      });
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        catalog,
        modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
      });
      return true;
    } catch (error) {
      if (error instanceof PanelHttpError) {
        throw error;
      }
      throw new PanelHttpError(502, "model_catalog_failed", "模型列表获取失败，请检查厂商地址、密钥和网络。");
    }
  }

  const modelProfileCatalogMatch = /^\/api\/config\/model-profiles\/([^/]+)\/model-catalog$/.exec(url.pathname);
  if (request.method === "POST" && modelProfileCatalogMatch !== null) {
    const body = await readJsonBody(request);
    try {
      const profileId = decodeURIComponent(modelProfileCatalogMatch[1] ?? "");
      const profile = (await runtime.configCenter.listModelProviderProfiles()).find((item) => item.profileId === profileId);
      if (profile === undefined) {
        throw new PanelHttpError(404, "model_profile_not_found", "未找到模型配置。");
      }
      const input = parseModelCatalogUpdate(body);
      const catalog = await runtime.configCenter.upsertModelProviderModelCatalog({
        profileId,
        label: input.label ?? profile.label,
        baseUrl: input.baseUrl ?? profile.baseUrl,
        modelsPath: input.modelsPath ?? "/models",
        fetchedAt: input.fetchedAt ?? new Date().toISOString(),
        models: input.models,
      });
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        catalog,
        modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
      });
      return true;
    } catch (error) {
      throw configCenterHttpError(error);
    }
  }

  const modelProfileApiKeyMatch = /^\/api\/config\/model-profiles\/([^/]+)\/api-key$/.exec(url.pathname);
  if (request.method === "GET" && modelProfileApiKeyMatch !== null) {
    const profileId = decodeURIComponent(modelProfileApiKeyMatch[1] ?? "");
    const apiKey = await runtime.configCenter.getModelProviderApiKey(profileId);
    if (apiKey === undefined) {
      throw new PanelHttpError(404, "model_provider_key_not_found", "未找到该厂商的 API Key。");
    }
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      profileId,
      apiKey,
    });
    return true;
  }

  const activateProfileMatch = /^\/api\/config\/model-profiles\/([^/]+)\/activate$/.exec(url.pathname);
  if (request.method === "POST" && activateProfileMatch !== null) {
    try {
      const profile = await runtime.configCenter.activateModelProviderProfile(
        decodeURIComponent(activateProfileMatch[1] ?? "")
      );
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        profile,
        config: profile,
        modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
        modelProviderMarket: {
          presets: listBuiltinModelProviderPresets(),
        },
        capabilities: await runtime.capabilityCenter.snapshot(),
      });
      return true;
    } catch (error) {
      throw configCenterHttpError(error);
    }
  }

  const deleteProfileMatch = /^\/api\/config\/model-profiles\/([^/]+)$/.exec(url.pathname);
  if (request.method === "DELETE" && deleteProfileMatch !== null) {
    try {
      const profiles = await runtime.configCenter.deleteModelProviderProfile(
        decodeURIComponent(deleteProfileMatch[1] ?? "")
      );
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        profiles,
        modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
        modelProviderMarket: {
          presets: listBuiltinModelProviderPresets(),
        },
        capabilities: await runtime.capabilityCenter.snapshot(),
      });
      return true;
    } catch (error) {
      throw configCenterHttpError(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/config/tools") {
    const tools: PanelToolsConfig = {
      webSearch: await runtime.configCenter.getWebSearchConfig(),
      catalog: await createPanelToolCatalog(runtime),
    };
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      tools,
      capabilities: await runtime.capabilityCenter.snapshot(),
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/config/model-provider") {
    const body = await readJsonBody(request);
    try {
      const config = await runtime.configCenter.updateModelProviderConfig(parseConfigUpdate(body));
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        config,
        profiles: await runtime.configCenter.listModelProviderProfiles(),
        modelCatalogs: await runtime.configCenter.listModelProviderModelCatalogs(),
        modelProviderMarket: {
          presets: listBuiltinModelProviderPresets(),
        },
        capabilities: await runtime.capabilityCenter.snapshot(),
        informationAccess: await runtime.configCenter.getInformationAccessConfig(),
      });
      return true;
    } catch (error) {
      throw configCenterHttpError(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/config/information-sources") {
    const body = await readJsonBody(request);
    const informationAccess = await runtime.configCenter.updateInformationAccessConfig(parseInformationAccessUpdate(body));
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      informationAccess,
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/config/tools/web-search") {
    const body = await readJsonBody(request);
    const webSearch = await runtime.configCenter.updateWebSearchConfig(parseWebSearchUpdate(body));
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      tools: { webSearch, catalog: await createPanelToolCatalog(runtime) },
      capabilities: await runtime.capabilityCenter.snapshot(),
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return true;
  }

  const toolStateMatch = /^\/api\/config\/tools\/([^/]+)\/state$/.exec(url.pathname);
  if (request.method === "POST" && toolStateMatch !== null) {
    const body = await readJsonBody(request);
    const toolName = decodeURIComponent(toolStateMatch[1] ?? "");
    await runtime.configCenter.updateToolState(parseToolStateUpdate(toolName, body));
    const tools: PanelToolsConfig = {
      webSearch: await runtime.configCenter.getWebSearchConfig(),
      catalog: await createPanelToolCatalog(runtime),
    };
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      tools,
      capabilities: await runtime.capabilityCenter.snapshot(),
      informationAccess: await runtime.configCenter.getInformationAccessConfig(),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/config/mcp") {
    const capabilitySnapshot = await runtime.capabilityCenter.snapshot();
    writeJson(response, 200, {
      ok: true,
      status: "completed",
      catalog: capabilitySnapshot.mcpCatalog,
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/config/mcp") {
    const body = await readJsonBody(request);
    try {
      await runtime.configCenter.upsertMcpServer(parseMcpServerUpdate(body));
      const capabilitySnapshot = await runtime.capabilityCenter.snapshot();
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        catalog: capabilitySnapshot.mcpCatalog,
      });
      return true;
    } catch (error) {
      throw configCenterHttpError(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/config/workspace") {
    const body = await readJsonBody(request);
    try {
      const workspace = await runtime.configCenter.updateWorkspaceConfig(parseWorkspaceUpdate(body));
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        workspace,
      });
      return true;
    } catch (error) {
      if (error instanceof WorkspaceDirectoryValidationError) {
        throw new PanelHttpError(400, "invalid_workspace_directory", "工作目录必须是已存在的文件夹。");
      }
      throw error;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/config/workspace/select-directory") {
    if (runtime.workspaceDirectoryPicker === undefined) {
      throw new PanelHttpError(501, "workspace_picker_unavailable", "当前环境不支持系统文件夹选择器，请手动输入工作文件夹路径。");
    }
    const selectedDirectory = await runtime.workspaceDirectoryPicker();
    if (selectedDirectory === undefined) {
      writeJson(response, 200, {
        ok: true,
        status: "cancelled",
        message: "已取消选择文件夹。",
        workspace: await runtime.configCenter.getWorkspaceConfig(),
      });
      return true;
    }
    try {
      const workspace = await runtime.configCenter.updateWorkspaceConfig({ workspaceDirectory: selectedDirectory });
      writeJson(response, 200, {
        ok: true,
        status: "completed",
        workspace,
      });
      return true;
    } catch (error) {
      if (error instanceof WorkspaceDirectoryValidationError) {
        throw new PanelHttpError(400, "invalid_workspace_directory", "工作目录必须是已存在的文件夹。");
      }
      throw error;
    }
  }

  return false;
}

async function createPanelToolCatalog(runtime: PanelConfigRouteRuntime): Promise<ToolCatalogSnapshot> {
  const env = await runtime.configCenter.createUndergroundAiEnvironment();
  const workspaceRoot = (await runtime.configCenter.getWorkspaceConfig().catch(() => undefined))?.workspaceDirectory;
  const toolStates = await runtime.configCenter.listToolStates();
  return createDesktopBasicToolRegistry({
    env,
    fetch: runtime.providerFetch,
    workspaceRoot,
    toolStates,
  }).catalog("desktop-basic");
}

function configCenterHttpError(error: unknown): PanelHttpError {
  if (error instanceof PanelHttpError) {
    return error;
  }
  if (error instanceof ConfigCenterValidationError) {
    return new PanelHttpError(400, "invalid_config", error.message);
  }
  throw error;
}
