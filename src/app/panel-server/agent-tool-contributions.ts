import { createResearchToolRegistryContribution } from "../research/research-tool-contribution.js";
import {
  createAgentNotesToolRegistryContribution,
  type AgentNotesFeature,
  type AgentNoteVersions,
} from "../agent-notes/index.js";
import { createSpaceRevocationOverlay, createSpaceToolRegistryContribution, type SpaceFeature, type SpaceRevocationOverlay } from "../spaces/index.js";
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
import type { AgentHostRunResources } from "./agent-run-resources.js";

export type HostFeatureAgentToolContributionResolver = (input: {
  readonly workspaceRoot: string;
  readonly taskSoil?: TaskSoil;
  readonly agentNoteVersions?: AgentNoteVersions;
}) => readonly AgentToolRegistryContribution[];

/** Selects feature-owned tool contributions once at the Host composition boundary. */
export function createHostFeatureAgentToolContributionResolver(input: {
  readonly agentNotes?: Pick<AgentNotesFeature, "commands" | "queries">;
  readonly spaces?: Pick<SpaceFeature, "commands" | "queries" | "events">;
  readonly personalKnowledge?: Pick<PersonalKnowledgeFeature, "commands" | "queries">;
  readonly revocationOverlay?: SpaceRevocationOverlay;
  readonly assertSpaceAvailable?: (spaceId: string) => void;
  readonly deleteSpace?: (spaceId: string) => Promise<void>;
  readonly deleteConversation?: (conversationId: string) => Promise<void>;
}): HostFeatureAgentToolContributionResolver {
  // Shared across runs on purpose: a revocation is permanent, since re-adding a
  // reference mints a new id rather than reviving the revoked one.
  const revocationOverlay = input.revocationOverlay ?? (input.spaces === undefined
    ? undefined
    : createSpaceRevocationOverlay(input.spaces.events));
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
          revocationOverlay,
          assertSpaceAvailable: input.assertSpaceAvailable,
          deleteSpace: input.deleteSpace,
          deleteConversation: input.deleteConversation,
        })]),
    ...(input.personalKnowledge === undefined
      ? []
      : [createPersonalKnowledgeToolRegistryContribution({ knowledge: input.personalKnowledge })]),
  ];
}

/** Feature contributions selected by the application Host for every Agent run. */
export function createHostAgentToolContributions(input: {
  readonly runtime: AgentToolRuntimeContext;
  readonly resources: Pick<AgentHostRunResources, "aiEnvironment" | "workspaceRoot">;
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
