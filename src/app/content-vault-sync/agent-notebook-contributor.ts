import type { AgentNotebook, AgentNoteScope } from "../agent-notes/index.js";
import { parseContentVaultPayload, type ContentVaultResource } from "../content-vault/index.js";
import type { ContentVaultLocalResource, ContentVaultSyncContributor } from "./contracts.js";

export const GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID = "global";

export type AgentNotebookSyncPort = {
  list(): Promise<readonly AgentNotebook[]>;
  read(scope: AgentNoteScope): Promise<AgentNotebook>;
  write(scope: AgentNoteScope, content: string): Promise<AgentNotebook>;
  subscribe(listener: () => void): () => void;
};

/**
 * V1 intentionally synchronizes only the global notebook. Workspace notebooks
 * remain local until Workspaces have a path-independent logical identity.
 */
export function createAgentNotebookContentVaultContributor(
  port: AgentNotebookSyncPort,
): ContentVaultSyncContributor {
  const globalScope = { kind: "global" } as const;
  return {
    kind: "agent_notebook",
    async list() {
      const global = (await port.list()).find((notebook) => notebook.scope.kind === "global");
      const projected = global === undefined ? undefined : projectGlobalNotebook(global);
      return projected === undefined ? [] : [projected];
    },
    async read(resourceId) {
      if (resourceId !== GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID) return undefined;
      return projectGlobalNotebook(await port.read(globalScope));
    },
    async apply(resource) {
      if (resource.resourceId !== GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID) {
        throw new Error(`Unsupported Agent Notebook identity: ${resource.resourceId}`);
      }
      const current = await port.read(globalScope);
      if (resource.deleted) {
        if (current.content.length > 0) await port.write(globalScope, "");
        return;
      }
      const payload = parseContentVaultPayload("agent_notebook", requiredPayload(resource));
      if (payload.scope !== "global" || payload.notebookId !== GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID) {
        throw new Error("Content Vault V1 only accepts the global Agent Notebook");
      }
      const content = String(payload.content);
      if (current.content === content) return;
      await port.write(globalScope, content);
    },
    subscribe: port.subscribe,
  };
}

function projectGlobalNotebook(notebook: AgentNotebook): ContentVaultLocalResource | undefined {
  if (notebook.scope.kind !== "global" || notebook.content.length === 0) return undefined;
  return {
    kind: "agent_notebook",
    resourceId: GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID,
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("agent_notebook", {
      notebookId: GLOBAL_AGENT_NOTEBOOK_RESOURCE_ID,
      label: "全局 Agent 笔记",
      scope: "global",
      content: notebook.content,
      ...(notebook.updatedAt === undefined ? {} : { updatedAt: notebook.updatedAt }),
    }),
  };
}

function requiredPayload(resource: ContentVaultResource): Readonly<Record<string, unknown>> {
  if (resource.deleted || resource.payload === undefined) {
    throw new Error(`Content Vault ${resource.kind}/${resource.resourceId} has no active payload`);
  }
  return resource.payload;
}
