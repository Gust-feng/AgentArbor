import type { Constraint } from "../../domain/constraints.js";
import type { InformationSourceKind } from "../../domain/research/index.js";
import type {
  AgentToolProviderFetch,
  AgentToolRegistryContribution,
  AgentToolRuntimeContext,
  CreateAgentToolCenterOptions,
} from "../tool-center/factory.js";
import {
  createDefaultToolCenter,
} from "../tool-center/factory.js";
import type { ToolExecutionBroker } from "../../domain/tools/index.js";
import type { ConfigCenter } from "../config-center/index.js";
import { readLocalCommandLogRef } from "../tool-center/adapters/local-workspace-command-tools.js";
import type { PageFetchLike } from "./source-adapters.js";
import { createDefaultResearchRuntime } from "./research-runtime.js";
import { createResearchReadTool, createResearchSearchTool } from "./research-tools.js";

export function createResearchToolRegistryContribution(input: {
  readonly constraints?: readonly Constraint[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: AgentToolProviderFetch;
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
  readonly workspaceRoot?: string;
} = {}): AgentToolRegistryContribution {
  const env = input.env ?? process.env;
  const runtime = createDefaultResearchRuntime({
    env,
    tavilyFetch: input.fetch,
    pageFetch: input.fetch as unknown as PageFetchLike,
    codebaseRoot: input.workspaceRoot ?? process.cwd(),
    commandLogRegistry: { read: readLocalCommandLogRef },
    constraints: input.constraints,
    sourcePreference: input.sourcePreference ?? parseInformationSourcePreference(
      env.AGENTARBOR_INFORMATION_SOURCE_PREFERENCE,
    ),
    tavilyMaxResults: input.tavilyMaxResults ?? positiveIntegerFromString(
      env.AGENTARBOR_TAVILY_MAX_RESULTS,
    ),
  });
  return (register) => {
    for (const executor of [createResearchSearchTool(runtime), createResearchReadTool(runtime)]) {
      register({ executor, scopes: ["desktop-basic", "research"], enabledByDefault: true });
    }
  };
}

export function createResearchEnabledToolCenter(
  input: ResearchEnabledToolCenterOptions = {},
): ToolExecutionBroker {
  return createDefaultToolCenter({
    ...input,
    baseToolScopes: input.baseToolScopes ?? ["desktop-basic"],
    toolRegistryScopes: input.toolRegistryScopes ?? ["desktop-basic"],
    contributions: [
      createResearchToolRegistryContribution({
        constraints: input.runtime?.constraints,
        env: input.env,
        fetch: input.fetch,
        sourcePreference: input.sourcePreference,
        tavilyMaxResults: input.tavilyMaxResults,
        workspaceRoot: input.workspaceRoot,
      }),
      ...(input.contributions ?? []),
    ],
  });
}

export async function createConfiguredResearchToolCenter(
  configCenter: ConfigCenter,
  input: Omit<ResearchEnabledToolCenterOptions, "env"> = {},
): Promise<ToolExecutionBroker> {
  return createResearchEnabledToolCenter({
    ...input,
    env: await configCenter.createModelRuntimeEnvironment(),
  });
}

export async function createConfiguredResearchToolCenterFactory(
  configCenter: ConfigCenter,
  input: Omit<ResearchEnabledToolCenterOptions, "env" | "runtime"> = {},
): Promise<(runtime: AgentToolRuntimeContext) => ToolExecutionBroker> {
  const env = await configCenter.createModelRuntimeEnvironment();
  return (runtime) => createResearchEnabledToolCenter({ ...input, env, runtime });
}

export type ResearchEnabledToolCenterOptions = CreateAgentToolCenterOptions & {
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
};

function parseInformationSourcePreference(
  value: string | undefined,
): readonly InformationSourceKind[] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const result = [...new Set(value.split(",").map((item) => informationSourceOrUndefined(item.trim())))]
    .filter((source): source is InformationSourceKind => source !== undefined);
  return result.length === 0 ? undefined : result;
}

function informationSourceOrUndefined(value: string): InformationSourceKind | undefined {
  return value === "web" || value === "page" || value === "codebase" || value === "soil" ||
    value === "run_memory" || value === "docs" || value === "packages" || value === "github" ||
    value === "command_log"
    ? value
    : undefined;
}

function positiveIntegerFromString(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : undefined;
}
