import type { CapabilityAgentProfile } from "../capability/capability-policy.js";
import { resolveRunToolBoundary } from "../capability/run-tool-boundary.js";
import type { MultiAgentRunResourceAcquirer } from "../deep/multi-agent-feature.js";
import {
  createAgentToolCenterFactory,
  prepareAgentRunResources,
  type AgentRunResourceHost,
} from "./agent-run-resources.js";
import { createHostAgentToolContributions } from "./agent-tool-contributions.js";

/**
 * Composition adapter between the neutral Host resource factory and the
 * Multi-Agent feature port. It belongs beside the composition root so neither
 * side needs to know the other's concrete contracts.
 */
export function createMultiAgentRunResourceAcquirer(input: {
  readonly host: AgentRunResourceHost;
  readonly agentDefinition: CapabilityAgentProfile;
}): MultiAgentRunResourceAcquirer {
  return async (request) => {
    const resources = await prepareAgentRunResources(input.host, request.aiMode, {
      capabilitySnapshot: request.capabilitySnapshot,
      informationAccess: request.informationAccess,
    });
    try {
      const toolRuntime = { constraints: request.taskSoil.constraints };
      const toolCenter = createAgentToolCenterFactory(input.host.providerFetch, resources)(toolRuntime, {
        taskSoil: request.taskSoil,
        contributions: createHostAgentToolContributions({
          runtime: toolRuntime,
          resources,
          providerFetch: input.host.providerFetch,
        }),
      });
      const toolBoundary = resolveRunToolBoundary({
        agentDefinition: input.agentDefinition,
        snapshot: resources.capabilitySnapshot,
        goal: request.taskSoil.rawGoal,
        taskSoil: request.taskSoil,
        toolCenter,
      });
      return {
        intelligenceChannel: resources.aiConfig.createIntelligenceChannel(request.channelContext),
        toolCenter,
        capabilitySnapshot: {
          ...resources.capabilitySnapshot,
          toolCatalog: {
            ...resources.capabilitySnapshot.toolCatalog,
            allowedTools: toolBoundary.allowedTools,
          },
        },
        release: async () => {
          await resources.release();
        },
      };
    } catch (error) {
      await resources.release();
      throw error;
    }
  };
}
