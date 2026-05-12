import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import type { ConfigCenter } from "../config-center.js";

export type PanelServerOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly configDirectory?: string;
  readonly configCenter?: ConfigCenter;
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly providerFetch?: PanelProviderFetch;
  readonly workspaceDirectoryPicker?: () => Promise<string | undefined>;
  readonly skillRoots?: readonly string[];
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

export type StartedPanelServer = {
  readonly url: string;
  readonly configDirectory?: string;
  readonly runtimeDirectory?: string;
  close(): Promise<void>;
};
