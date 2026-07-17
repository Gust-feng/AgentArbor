import type { ReadonlySoilStore } from "../../domain/soil/index.js";
import type { IntelligenceChannel, ModelMessage } from "../../domain/intelligence/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import {
  agentDefinitionRefMatchesDefinition,
  isCompleteRunAgentDefinitionRef,
} from "../agent-definitions/agent-definition-ref.js";
import { resolveRunToolBoundary } from "../capability/run-tool-boundary.js";
import {
  compactAgentLoopContextIfNeeded,
  createOpenAITokenCounter,
  type AgentLoopTokenCounter,
} from "../context-maintenance/index.js";
import {
  assembleDesktopAgentModelInput,
} from "../desktop-agent/desktop-agent-model-input.js";
import type { DesktopAgentSkillContext } from "../desktop-agent/desktop-agent-contracts.js";
import { CodedExecutionError, executionErrorFacts } from "../execution-errors/index.js";
import {
  createModelRuntimeAgentLoop,
  type AgentLoop,
  type AgentLoopInput,
  type AgentLoopToolBoundary,
} from "../model-runtime/index.js";
import type {
  AcquireOrdinaryAgentLoopRunResourcesInput,
  OrdinaryAgentLoopRunResourceAcquirer,
} from "../ordinary-agent/agent-loop-execution.js";
import { createSkillToolRegistryContribution } from "../skills/skill-resource-tool.js";
import {
  createSubAgentAgentToolCatalogContribution,
  createSubAgentAgentTools,
} from "../sub-agents/sub-agent-agent-tools.js";
import { SubAgentRegistry } from "../sub-agents/sub-agent-registry.js";
import type { SubAgentRootInput } from "../sub-agents/sub-agent-loader.js";
import { attachDesktopFileInputsToModelMessages } from "../task-soil/desktop-agent-model-input-files.js";
import { createTaskSoilFromDesktopInput } from "../task-soil/task-soil-workspace.js";
import {
  createAgentToolCenterFactory,
  prepareAgentRunResources,
  type AgentRunResourceHost,
  type AgentRunResources,
} from "./agent-run-resources.js";
import { createHostAgentToolContributions } from "./agent-tool-contributions.js";

export type OrdinaryAgentDefinitionResolver = (
  input: {
    readonly ref: AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["agentDefinitionRef"];
    readonly instructions: string;
  },
) => AgentDefinition | undefined | Promise<AgentDefinition | undefined>;

export type OrdinaryAgentSkillContextResolver = (input: {
  readonly runId: string;
  readonly goal: string;
  readonly catalog: AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["capabilitySnapshot"]["skillCatalog"];
  readonly triggerMode: "keyword" | "model";
  readonly canonicalMessages: AcquireOrdinaryAgentLoopRunResourcesInput["messages"];
  /** Temporary neutral channel factory used only by Host-owned semantic skill routing. */
  readonly createIntelligenceChannel: AgentRunResources["aiConfig"]["createIntelligenceChannel"];
  readonly abortSignal: AbortSignal;
}) => Promise<readonly DesktopAgentSkillContext[]>;

export type CreateOrdinaryAgentRunResourceAcquirerInput = {
  readonly host: AgentRunResourceHost;
  readonly soilStore: ReadonlySoilStore;
  readonly resolveAgentDefinition: OrdinaryAgentDefinitionResolver;
  readonly resolveSkillContexts?: OrdinaryAgentSkillContextResolver;
  readonly resolveSubAgentRoots: (workspaceRoot: string) => readonly SubAgentRootInput[];
};

type OrdinaryAgentRunResourceAcquirerDependencies = {
  readonly prepareRunResources?: (
    runtime: AgentRunResourceHost,
    aiMode: AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["aiMode"],
    input: {
      readonly capabilitySnapshot: AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["capabilitySnapshot"];
      readonly informationAccess: AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["informationAccess"];
    },
  ) => Promise<AgentRunResources<AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["capabilitySnapshot"]>>;
  readonly createAgentLoop?: typeof createModelRuntimeAgentLoop;
  readonly compactContext?: typeof compactAgentLoopContextIfNeeded;
  readonly createTokenCounter?: (model?: string) => AgentLoopTokenCounter;
  readonly resolveToolBoundary?: typeof resolveRunToolBoundary;
};

/**
 * Host-owned composition adapter for one frozen Ordinary run. The Ordinary
 * feature sees only its resource-acquirer port and never imports Panel code.
 */
export function createOrdinaryAgentRunResourceAcquirer(
  options: CreateOrdinaryAgentRunResourceAcquirerInput,
  dependencies: OrdinaryAgentRunResourceAcquirerDependencies = {},
): OrdinaryAgentLoopRunResourceAcquirer {
  return {
    async acquire(input) {
      const definition = await resolveFrozenAgentDefinition(options, input).catch((error: unknown) => {
        throw expectedOrWrappedExecutionError(
          error,
          "run_resource_acquisition_failed",
          "Ordinary run resources could not be acquired.",
        );
      });
      const resources = await (dependencies.prepareRunResources ?? prepareAgentRunResources)(options.host, input.birth.aiMode, {
        capabilitySnapshot: input.birth.capabilitySnapshot,
        informationAccess: input.birth.informationAccess,
      }).catch((error: unknown) => {
        throw expectedOrWrappedExecutionError(
          error,
          "run_resource_acquisition_failed",
          "Ordinary run resources could not be acquired.",
        );
      });
      let loop: AgentLoop | undefined;
      try {
        const taskSoil = createTaskSoilFromDesktopInput({
          goal: input.runInput.userMessage,
          goalId: input.runId,
          traceId: input.runId,
          aiMode: input.birth.aiMode,
          constraints: options.soilStore.listConstraints(),
          soilStore: options.soilStore,
          taskSoilInput: input.runInput.taskSoil,
        });
        const skillContexts = await options.resolveSkillContexts?.({
          runId: input.runId,
          goal: input.runInput.userMessage,
          catalog: input.birth.capabilitySnapshot.skillCatalog,
          triggerMode: input.birth.capabilitySnapshot.skillTrigger?.mode ?? "keyword",
          canonicalMessages: input.messages,
          createIntelligenceChannel: resources.aiConfig.createIntelligenceChannel,
          abortSignal: input.abortSignal,
        }) ?? [];
        const toolRuntime = { constraints: taskSoil.constraints };
        const toolCenter = createAgentToolCenterFactory(options.host.providerFetch, resources)(toolRuntime, {
          taskSoil,
          contributions: [
            ...createHostAgentToolContributions({
              runtime: toolRuntime,
              resources,
              providerFetch: options.host.providerFetch,
            }),
            createSkillToolRegistryContribution(skillContexts),
          ],
        });
        const registry = new SubAgentRegistry({
          roots: options.resolveSubAgentRoots(resources.workspaceRoot),
          catalog: input.birth.capabilitySnapshot.subAgentCatalog,
        });
        const frozenSubAgents = await registry.list();
        const subAgentToolCatalog = createSubAgentAgentToolCatalogContribution({
          subAgents: frozenSubAgents,
          dynamicSpawnAvailable: true,
        });
        let toolBoundary: ReturnType<typeof resolveRunToolBoundary>;
        try {
          toolBoundary = (dependencies.resolveToolBoundary ?? resolveRunToolBoundary)({
            agentDefinition: definition,
            snapshot: input.birth.capabilitySnapshot,
            skillCatalog: input.birth.capabilitySnapshot.skillCatalog,
            subAgentCatalog: input.birth.capabilitySnapshot.subAgentCatalog,
            goal: input.runInput.userMessage,
            taskSoil,
            toolCenter,
            agentToolDefinitions: subAgentToolCatalog.definitions,
            skillContexts,
          });
        } catch (error) {
          throw expectedOrWrappedExecutionError(
            error,
            "tool_boundary_resolution_failed",
            "Ordinary tool boundary could not be resolved.",
          );
        }
        const tools = ordinaryToolBoundary(input, definition, toolCenter, toolBoundary.allowedTools);
        const agentTools = await createSubAgentAgentTools({
          registry,
          parentAllowedTools: toolBoundary.allowedTools,
          executableTools: toolCenter.list().map((tool) => tool.name),
          exposedToolNames: toolBoundary.allowedAgentToolNames,
          dynamicSpawnAvailable: true,
        });
        const modelInput = assembleDesktopAgentModelInput({
          agentDefinition: definition,
          instructions: input.birth.instructions,
          goal: input.runInput.userMessage,
          taskSoil,
          canonicalMessages: input.messages,
          skillContexts,
        });
        const messagesWithAttachments = await attachDesktopFileInputsToModelMessages({
          messages: modelInput.messages,
          taskSoil,
          modelCapabilities: resources.capabilitySnapshot.modelCapabilities,
          workspaceRoot: resources.workspaceRoot,
        });
        const maintainContext = createOrdinaryContextMaintainer({
          input,
          definition,
          resources,
          tools: toolBoundary.toolDefinitions,
          compactContext: dependencies.compactContext ?? compactAgentLoopContextIfNeeded,
          tokenCounter: (dependencies.createTokenCounter ?? createOpenAITokenCounter)(input.birth.config.model),
        });
        loop = (dependencies.createAgentLoop ?? createModelRuntimeAgentLoop)({
          mode: input.birth.aiMode,
          env: resources.aiEnvironment,
          modelProvider: input.birth.config,
          providerProfileId: input.birth.capabilitySnapshot.modelCapabilities.protocolProfileId,
          providerFetch: options.host.providerFetch,
        });
        const ownedLoop = loop;
        const processTerminator = options.host.processTerminator;
        const release = idempotentRelease([
          () => ownedLoop.release(),
          resources.release,
          ...(processTerminator === undefined
            ? []
            : [() => options.host.processRegistry.cleanupByRun(
                input.runId,
                processTerminator,
              ).then(() => undefined)]),
        ]);
        return {
          loop,
          resolvedMessages: messagesWithAttachments,
          tools,
          maintainContext,
          ...(toolBoundary.capabilityResolution === undefined
            ? {}
            : { capabilityResolution: toolBoundary.capabilityResolution }),
          ...(agentTools.length === 0 ? {} : { agentTools }),
          release,
        };
      } catch (error) {
        await releaseAfterAcquireFailure(loop, resources.release);
        throw expectedOrWrappedExecutionError(
          error,
          "run_resource_acquisition_failed",
          "Ordinary run resources could not be acquired.",
        );
      }
    },
  };
}

function createOrdinaryContextMaintainer(input: {
  readonly input: AcquireOrdinaryAgentLoopRunResourcesInput;
  readonly definition: AgentDefinition;
  readonly resources: AgentRunResources;
  readonly tools: ReturnType<typeof resolveRunToolBoundary>["toolDefinitions"];
  readonly compactContext: typeof compactAgentLoopContextIfNeeded;
  readonly tokenCounter: AgentLoopTokenCounter;
}): NonNullable<AgentLoopInput["maintainContext"]> {
  const channel = lazyIntelligenceChannel(() => input.resources.aiConfig.createIntelligenceChannel({
    bus: new InMemoryMessageBus(new InMemoryEventLog()),
  }));
  return async ({ messages, abortSignal }) => {
    const result = await input.compactContext({
      goal: input.input.runInput.userMessage,
      traceId: input.input.runId,
      goalId: input.input.runId,
      agentIdentity: {
        agentId: input.definition.agentId,
        displayName: input.definition.displayName,
      },
      messages,
      tools: input.tools,
      intelligenceChannel: channel,
      modelCapabilities: input.resources.capabilitySnapshot.modelCapabilities,
      tokenCounter: input.tokenCounter,
      compactedContextRole: "user",
      abortSignal,
    }).catch((error: unknown) => {
      const wrapped = expectedOrWrappedExecutionError(
        error,
        "context_compaction_failed",
        "Ordinary context could not be compacted.",
      );
      const facts = executionErrorFacts(wrapped);
      return {
        status: "failed" as const,
        code: facts?.code ?? "context_compaction_failed",
        message: facts?.message ?? "Ordinary context could not be compacted.",
      };
    });
    if (result.status === "failed") {
      return {
        status: "failed",
        code: "context_compaction_failed",
        error: result.message,
      };
    }
    return result.status === "compacted"
      ? { status: "compacted", messages: result.messages }
      : { status: "unchanged" };
  };
}

function lazyIntelligenceChannel(create: () => IntelligenceChannel): IntelligenceChannel {
  let channel: IntelligenceChannel | undefined;
  const get = (): IntelligenceChannel => {
    channel ??= create();
    return channel;
  };
  return {
    request: (request, options) => get().request(request, options),
    validateResponse: (request, response) => get().validateResponse(request, response),
  };
}

async function resolveFrozenAgentDefinition(
  options: CreateOrdinaryAgentRunResourceAcquirerInput,
  input: AcquireOrdinaryAgentLoopRunResourcesInput,
): Promise<AgentDefinition> {
  const ref = input.birth.agentDefinitionRef;
  if (!isCompleteRunAgentDefinitionRef(ref)) {
    throw new CodedExecutionError(
      "agent_definition_mismatch",
      "Ordinary run requires a complete frozen AgentDefinition reference",
    );
  }
  const definition = await options.resolveAgentDefinition({ ref, instructions: input.birth.instructions });
  if (definition === undefined || !agentDefinitionRefMatchesDefinition(ref, definition)) {
    throw new CodedExecutionError(
      "agent_definition_mismatch",
      "Ordinary run AgentDefinition no longer matches its frozen reference",
    );
  }
  if (definition.toolVisibilityProfile.runMode !== "agent" || definition.turnPolicy.purpose !== "desktop_agent") {
    throw new CodedExecutionError(
      "agent_definition_mismatch",
      "Ordinary run requires an ordinary desktop AgentDefinition",
    );
  }
  if (definition.prompt.systemPrompt !== input.birth.instructions) {
    throw new CodedExecutionError(
      "agent_definition_mismatch",
      "Ordinary run instructions no longer match its frozen AgentDefinition",
    );
  }
  return definition;
}

function expectedOrWrappedExecutionError(
  error: unknown,
  code: string,
  message: string,
): unknown {
  return executionErrorFacts(error) === undefined
    ? new CodedExecutionError(code, message, { cause: error })
    : error;
}

function ordinaryToolBoundary(
  input: AcquireOrdinaryAgentLoopRunResourcesInput,
  definition: AgentDefinition,
  gateway: AgentLoopToolBoundary["gateway"],
  allowedTools: readonly string[],
): AgentLoopToolBoundary {
  return {
    gateway,
    context: {
      callerAgentId: definition.agentId,
      traceId: input.runId,
      goalId: input.runId,
      confirmationPolicy: input.birth.toolConfirmationPolicy,
    },
    permission: {
      callerAgentId: definition.agentId,
      allowedTools,
      confirmationPolicy: input.birth.toolConfirmationPolicy,
    },
  };
}

function idempotentRelease(releasers: readonly (() => Promise<void>)[]): () => Promise<void> {
  let releasePromise: Promise<void> | undefined;
  return () => {
    releasePromise ??= releaseAll(releasers);
    return releasePromise;
  };
}

async function releaseAll(releasers: readonly (() => Promise<void>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const release of releasers) {
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Ordinary run resource release failed");
}

async function releaseAfterAcquireFailure(
  loop: AgentLoop | undefined,
  releaseHostResources: () => Promise<void>,
): Promise<void> {
  await releaseAll([
    ...(loop === undefined ? [] : [() => loop.release()]),
    releaseHostResources,
  ]).catch(() => undefined);
}
