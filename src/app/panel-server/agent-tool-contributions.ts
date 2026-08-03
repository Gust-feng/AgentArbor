import { createResearchToolRegistryContribution } from "../research/research-tool-contribution.js";
import {
  createAgentNotesToolRegistryContribution,
  type AgentNotesFeature,
  type AgentNoteVersions,
} from "../agent-notes/index.js";
import { createSpaceToolRegistryContribution, type SpaceFeature } from "../spaces/index.js";
import {
  createPersonalKnowledgeToolRegistryContribution,
  type PersonalKnowledgeFeature,
} from "../personal-knowledge/index.js";
import type {
  AgentToolProviderFetch,
  AgentToolRegistryContribution,
  AgentToolRuntimeContext,
} from "../tool-center/factory.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { LocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import type { AgentHostRunResources } from "./agent-run-resources.js";

export type HostFeatureAgentToolContributionResolver = (input: {
  readonly workspaceRoot: string;
  readonly taskSoil?: TaskSoil;
  readonly agentNoteVersions?: AgentNoteVersions;
}) => readonly AgentToolRegistryContribution[];

/** Selects feature-owned tool contributions once at the Host composition boundary. */
export function createHostFeatureAgentToolContributionResolver(input: {
  readonly agentNotes?: Pick<AgentNotesFeature, "commands" | "queries">;
  readonly spaces?: Pick<SpaceFeature, "commands" | "queries">;
  readonly personalKnowledge?: Pick<PersonalKnowledgeFeature, "commands" | "queries">;
  readonly fileMutationCoordinator?: LocalWorkspaceMutationCoordinator;
}): HostFeatureAgentToolContributionResolver {
  return ({ workspaceRoot, taskSoil, agentNoteVersions }) => [
    ...(input.agentNotes === undefined
      ? []
      : [createAgentNotesToolRegistryContribution({
          notes: input.agentNotes,
          workspaceRoot,
          initialVersions: agentNoteVersions,
        })]),
    ...(input.spaces === undefined
      ? []
      : [createSpaceToolRegistryContribution({
          spaces: input.spaces,
          workspaceRoot,
          taskSoil,
          mutationCoordinator: input.fileMutationCoordinator,
        })]),
    ...(input.personalKnowledge === undefined
      ? []
      : [createPersonalKnowledgeToolRegistryContribution({ knowledge: input.personalKnowledge })]),
  ];
}

/** Feature contributions selected by the application Host for every Agent run. */
export function createHostAgentToolContributions(input: {
  readonly runtime: AgentToolRuntimeContext;
  readonly resources: AgentHostRunResources;
  readonly providerFetch?: AgentToolProviderFetch;
  readonly featureContributions?: readonly AgentToolRegistryContribution[];
}): readonly AgentToolRegistryContribution[] {
  return [
    createResearchToolRegistryContribution({
      constraints: input.runtime.constraints,
      env: input.resources.aiEnvironment,
      fetch: input.providerFetch,
      workspaceRoot: input.resources.workspaceRoot,
    }),
    ...(input.featureContributions ?? []),
  ];
}
