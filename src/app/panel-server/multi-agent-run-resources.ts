import type { CapabilityAgentProfile } from "../capability/capability-policy.js";
import { resolveRunToolBoundary } from "../capability/run-tool-boundary.js";
import type { MultiAgentRunResourceAcquirer } from "../deep/multi-agent-feature.js";
import {
  projectMultiAgentCapabilitySnapshot,
} from "../deep/multi-agent-capability-snapshot.js";
import {
  createAgentToolCenterFactory,
  prepareAgentRunResources,
  type AgentRunResourceHost,
} from "./agent-run-resources.js";
import { createHostAgentToolContributions } from "./agent-tool-contributions.js";
import { createOpenAITokenCounter } from "../context-maintenance/index.js";

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
        outputTokenCounter: createOpenAITokenCounter(request.capabilitySnapshot.activeModel.model),
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
      const capabilitySnapshot = projectMultiAgentCapabilitySnapshot({
        ...resources.capabilitySnapshot,
        toolCatalog: {
          ...resources.capabilitySnapshot.toolCatalog,
          allowedTools: toolBoundary.allowedTools,
        },
      });
      return {
        intelligenceChannel: resources.aiConfig.createIntelligenceChannel(request.channelContext),
        toolCenter,
        capabilitySnapshot,
        release: async () => {
          const failures: unknown[] = [];
          try {
            await resources.release();
          } catch (error) {
            failures.push(error);
          }
          if (input.host.processTerminator !== undefined && request.taskSoil.traceId !== undefined) {
            try {
              await input.host.processRegistry.cleanupByRun(
                request.taskSoil.traceId,
                input.host.processTerminator,
              );
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length === 1) {
            throw failures[0];
          }
          if (failures.length > 1) {
            throw new AggregateError(failures, "Multi-Agent run resource release failed");
          }
        },
      };
    } catch (error) {
      await resources.release();
      throw error;
    }
  };
}
