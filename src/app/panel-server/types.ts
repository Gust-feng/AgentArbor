import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import type { ConfigCenter } from "../config-center.js";
import type { ProcessTerminator } from "../runtime-guard/index.js";
import type { SkillRootInput } from "../skills/index.js";

export type PanelServerOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly configDirectory?: string;
  readonly configCenter?: ConfigCenter;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly providerFetch?: PanelProviderFetch;
  readonly modelCatalogFetch?: PanelModelCatalogFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
  readonly contextAttachmentPicker?: () => Promise<PanelContextAttachmentSelection | undefined>;
  readonly additionalSkillRoots?: readonly SkillRootInput[];
  readonly skillRoots?: readonly SkillRootInput[];
  readonly desktopAgentDefinition?: AgentDefinition;
  readonly agentDefinitions?: readonly AgentDefinition[];
  readonly processTerminator?: ProcessTerminator;
};

export type PanelContextAttachmentSelection = {
  readonly kind: "file" | "project";
  readonly path: string;
};

export type PanelProviderFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
}>;

export type PanelModelCatalogFetch = (
  url: string,
  init: {
    readonly method: "GET";
    readonly headers: Record<string, string>;
    readonly signal?: AbortSignal;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
}>;

export type StartedPanelServer = {
  readonly url: string;
  readonly configDirectory?: string;
  readonly runtimeDirectory?: string;
  close(): Promise<void>;
};
