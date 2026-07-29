import { createResearchToolRegistryContribution } from "../research/research-tool-contribution.js";
import { createNoteWriteTool, type AgentNotesFeature } from "../agent-notes/index.js";
import { createSpaceTools, type SpaceFeature } from "../spaces/index.js";
import { createPersonalKnowledgeTools, type PersonalKnowledgeFeature } from "../personal-knowledge/index.js";
import type {
  AgentToolProviderFetch,
  AgentToolRegistryContribution,
  AgentToolRuntimeContext,
} from "../tool-center/factory.js";
import type { AgentHostRunResources } from "./agent-run-resources.js";

/** Feature contributions selected by the application Host for every Agent run. */
export function createHostAgentToolContributions(input: {
  readonly runtime: AgentToolRuntimeContext;
  readonly resources: AgentHostRunResources;
  readonly providerFetch?: AgentToolProviderFetch;
  /** Models decide when and what to remember; Host only contributes the note tool. */
  readonly agentNotes?: Pick<AgentNotesFeature, "commands" | "queries">;
  /** SpaceFeature owns reference organization; ToolCenter only executes its commands. */
  readonly spaces?: Pick<SpaceFeature, "commands" | "queries">;
  /** PersonalKnowledge owns persisted user notes and Brain references. */
  readonly personalKnowledge?: Pick<PersonalKnowledgeFeature, "commands" | "queries">;
}): readonly AgentToolRegistryContribution[] {
  const contributions: AgentToolRegistryContribution[] = [createResearchToolRegistryContribution({
    constraints: input.runtime.constraints,
    env: input.resources.aiEnvironment,
    fetch: input.providerFetch,
    workspaceRoot: input.resources.workspaceRoot,
  })];
  if (input.agentNotes !== undefined) {
    const agentNotes = input.agentNotes;
    contributions.push((register) => {
      register({
        executor: createNoteWriteTool({
          notes: agentNotes,
          workspaceRoot: input.resources.workspaceRoot,
        }),
        scopes: ["desktop-basic"],
        enabledByDefault: true,
      });
    });
  }
  if (input.spaces !== undefined) {
    const spaces = input.spaces;
    contributions.push((register) => {
      for (const executor of createSpaceTools({ spaces })) {
        register({ executor, scopes: ["desktop-basic"], enabledByDefault: true });
      }
    });
  }
  if (input.personalKnowledge !== undefined) {
    const personalKnowledge = input.personalKnowledge;
    contributions.push((register) => {
      for (const executor of createPersonalKnowledgeTools({ knowledge: personalKnowledge })) {
        register({ executor, scopes: ["desktop-basic"], enabledByDefault: true });
      }
    });
  }
  return contributions;
}
