import type { IncomingMessage, ServerResponse } from "node:http";
import type { SanitizedWebSearchConfig } from "../../domain/config/index.js";
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
  parseMcpServerUpdate,
  parseToolStateUpdate,
  parseWebSearchUpdate,
  parseWorkspaceUpdate,
} from "./request-parsers.js";
import type { PanelProviderFetch } from "./types.js";

export type PanelConfigRouteRuntime = {
  readonly configCenter: ConfigCenter;
  readonly capabilityCenter: CapabilityCenter;
  readonly providerFetch?: PanelProviderFetch;
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
        capabilities: await runtime.capabilityCenter.snapshot(),
      });
      return true;
    } catch (error) {
      throw configCenterHttpError(error);
    }
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
