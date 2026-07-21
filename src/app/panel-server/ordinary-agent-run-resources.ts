import type { ReadonlySoilStore } from "../../domain/soil/index.js";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { ExecutionEnv, Session } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionLoop,
  createModelCollectionChannel,
  createModelProviderBinding,
} from "../../adapters/intelligence/index.js";
import type { AgentSessionEntryRef, AgentSessionRef } from "../model-runtime/agent-session.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import {
  agentDefinitionRefMatchesDefinition,
  isCompleteRunAgentDefinitionRef,
} from "../agent-definitions/agent-definition-ref.js";
import { resolveRunToolBoundary } from "../capability/run-tool-boundary.js";
import {
  createOpenAITokenCounter,
  type AgentLoopTokenCounter,
} from "../context-maintenance/index.js";
import {
  buildDesktopAgentModelInput,
} from "../desktop-agent/desktop-agent-model-input.js";
import type { DesktopAgentSkillContext } from "../desktop-agent/desktop-agent-contracts.js";
import { CodedExecutionError, executionErrorFacts } from "../execution-errors/index.js";
import {
  type AgentLoop,
  type AgentLoopInput,
  type AgentLoopToolBoundary,
  type ModelRuntimeConfig,
} from "../model-runtime/index.js";
import { resolveOpenAIModelRuntimeConfig } from "../model-runtime/factory.js";
import type {
  AcquireOrdinaryAgentLoopRunResourcesInput,
  OrdinaryAgentLoopRunResourceAcquirer,
} from "../ordinary-agent/agent-loop-execution.js";
import { ToolExecutionObservationGateway } from "../ordinary-agent/tool-execution-observation-gateway.js";
import { OrdinaryToolMetricsCollector } from "../ordinary-agent/tool-runtime-metrics.js";
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
  prepareAgentHostRunResources,
  type AgentRunResourceHost,
  type AgentHostRunResources,
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
  /** Current request messages used only for skill discovery; Session owns history. */
  readonly modelMessages: readonly ModelMessage[];
  /** Temporary neutral channel factory used only by Host-owned semantic skill routing. */
  readonly createIntelligenceChannel: Extract<ModelRuntimeConfig, { readonly enabled: true }>["createIntelligenceChannel"];
  readonly abortSignal: AbortSignal;
}) => Promise<readonly DesktopAgentSkillContext[]>;

export type CreateOrdinaryAgentRunResourceAcquirerInput = {
  readonly host: AgentRunResourceHost;
  readonly sessionRepository: {
    acquire(ref: AgentSessionRef): Promise<AgentSessionWriterLease>;
  };
  readonly soilStore: ReadonlySoilStore;
  readonly resolveAgentDefinition: OrdinaryAgentDefinitionResolver;
  readonly resolveSkillContexts?: OrdinaryAgentSkillContextResolver;
  readonly resolveSubAgentRoots: (workspaceRoot: string) => readonly SubAgentRootInput[];
};

type AgentSessionWriterLease = {
  readonly session: Session;
  revokeTo(target: AgentSessionEntryRef | null): Promise<void>;
  release(): Promise<void>;
};

type OrdinaryAgentRunResourceAcquirerDependencies = {
  readonly prepareHostResources?: (
    runtime: AgentRunResourceHost,
    input: {
      readonly capabilitySnapshot: AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["capabilitySnapshot"];
      readonly informationAccess: AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["informationAccess"];
    },
  ) => Promise<AgentHostRunResources<AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["capabilitySnapshot"]>>;
  readonly createSessionLoop?: typeof createAgentSessionLoop;
  readonly createProviderBinding?: typeof createModelProviderBinding;
  readonly createExecutionEnvironment?: (cwd: string) => ExecutionEnv;
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
      const resources = await (dependencies.prepareHostResources ?? prepareAgentHostRunResources)(options.host, {
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
      let sessionLease: AgentSessionWriterLease | undefined;
      let executionEnvironment: ExecutionEnv | undefined;
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
        const providerBinding = await createCustomProviderBindingForRun(options, dependencies, input, resources.aiEnvironment);
        const currentModelMessages: readonly ModelMessage[] = [{
          role: "user",
          content: input.runInput.userMessage,
        }];
        const createSkillRoutingChannel = (context: Parameters<Extract<ModelRuntimeConfig, { readonly enabled: true }>["createIntelligenceChannel"]>[0]) =>
          createModelCollectionChannel({
            modelRegistry: providerBinding.modelRegistry,
            selectedModel: providerBinding.selectedModel,
            thinkingLevel: providerBinding.thinkingLevel,
            transformProviderPayload: providerBinding.transformProviderPayload,
            providerKind: input.birth.config.providerKind,
            bus: context.bus,
            supportedPurposes: ["skill_routing"],
          });
        const skillContexts = await options.resolveSkillContexts?.({
          runId: input.runId,
          goal: input.runInput.userMessage,
          catalog: input.birth.capabilitySnapshot.skillCatalog,
          triggerMode: input.birth.capabilitySnapshot.skillTrigger?.mode ?? "keyword",
          modelMessages: currentModelMessages,
          createIntelligenceChannel: createSkillRoutingChannel,
          abortSignal: input.abortSignal,
        }) ?? [];
        const toolRuntime = { constraints: taskSoil.constraints };
        const toolMetrics = new OrdinaryToolMetricsCollector();
        const tokenCounter = (dependencies.createTokenCounter ?? createOpenAITokenCounter)(
          input.birth.config.model,
        );
        const toolCenter = createAgentToolCenterFactory(options.host.providerFetch, resources)(toolRuntime, {
          taskSoil,
          outputTokenCounter: tokenCounter,
          metricsSink: toolMetrics,
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
        const observedToolGateway = new ToolExecutionObservationGateway(toolCenter, toolMetrics);
        const tools = ordinaryToolBoundary(input, definition, observedToolGateway, toolBoundary.allowedTools);
        const agentTools = await createSubAgentAgentTools({
          registry,
          parentAllowedTools: toolBoundary.allowedTools,
          executableTools: toolCenter.list().map((tool) => tool.name),
          exposedToolNames: toolBoundary.allowedAgentToolNames,
          dynamicSpawnAvailable: true,
        });
        const modelInput = buildDesktopAgentModelInput({
          agentDefinition: definition,
          goal: input.runInput.userMessage,
          taskSoil,
          skillContexts,
        });
        const messagesWithAttachments = await attachDesktopFileInputsToModelMessages({
          messages: modelInput.messages,
          taskSoil,
          modelCapabilities: resources.capabilitySnapshot.modelCapabilities,
          workspaceRoot: resources.workspaceRoot,
        });
        executionEnvironment = (dependencies.createExecutionEnvironment ??
          ((cwd: string) => new NodeExecutionEnv({ cwd })))(resources.workspaceRoot);
        sessionLease = await options.sessionRepository.acquire(input.sessionRef);
        loop = (dependencies.createSessionLoop ?? createAgentSessionLoop)({
          executionEnvironment,
          modelRegistry: providerBinding.modelRegistry,
          selectedModel: providerBinding.selectedModel,
          thinkingLevel: providerBinding.thinkingLevel,
          transformProviderPayload: providerBinding.transformProviderPayload,
          agentSession: sessionLease.session,
        });
        const ownedLoop = loop;
        const ownedSessionLease = sessionLease;
        const ownedExecutionEnvironment = executionEnvironment;
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
          () => ownedExecutionEnvironment.cleanup(),
        ]);
        return {
          loop,
          resolvedMessages: messagesWithAttachments,
          tools,
          toolMetrics,
          revokeSessionTo: (target) => ownedSessionLease.revokeTo(target),
          releaseSession: ownedSessionLease.release,
          ...(toolBoundary.capabilityResolution === undefined
            ? {}
            : { capabilityResolution: toolBoundary.capabilityResolution }),
          ...(agentTools.length === 0 ? {} : { agentTools }),
          release,
        };
      } catch (error) {
        await releaseAfterAcquireFailure(
          loop,
          sessionLease,
          executionEnvironment,
          resources.release,
        );
        throw expectedOrWrappedExecutionError(
          error,
          "run_resource_acquisition_failed",
          "Ordinary run resources could not be acquired.",
        );
      }
    },
  };
}

async function createCustomProviderBindingForRun(
  options: CreateOrdinaryAgentRunResourceAcquirerInput,
  dependencies: OrdinaryAgentRunResourceAcquirerDependencies,
  input: AcquireOrdinaryAgentLoopRunResourcesInput,
  environment: Readonly<Record<string, string | undefined>>,
) {
  const mode = requireOpenAIModelRuntimeMode(input.birth.aiMode);
  const resolvedProvider = resolveOpenAIModelRuntimeConfig({
    mode,
    env: environment,
    modelProvider: input.birth.config,
  });
  return (dependencies.createProviderBinding ?? createModelProviderBinding)({
    protocol: resolvedProvider.protocol,
    baseUrl: resolvedProvider.baseUrl,
    model: resolvedProvider.model,
    profileId: input.birth.config.profileId,
    apiKey: resolvedProvider.apiKey,
    resolveApiKey: async () => {
      const currentEnvironment = await options.host.configCenter.createModelRuntimeEnvironment({
        modelProvider: input.birth.config,
        informationAccess: input.birth.informationAccess,
      });
      return resolveOpenAIModelRuntimeConfig({
        mode,
        env: currentEnvironment,
        modelProvider: input.birth.config,
      }).apiKey;
    },
    providerProfileId: resolvedProvider.providerProfileId,
    requestSettings: resolvedProvider.requestSettings,
    enableWebSearch: resolvedProvider.enableWebSearch,
    supportsVisionInput:
      input.birth.capabilitySnapshot.modelCapabilities.supportsVisionInput === true,
    supportsReasoningOutput:
      input.birth.capabilitySnapshot.modelCapabilities.supportsReasoningOutput === true,
    contextWindow: input.birth.capabilitySnapshot.modelCapabilities.contextWindowTokens,
    maxOutputTokens: input.birth.capabilitySnapshot.modelCapabilities.maxOutputTokens,
  });
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
  sessionLease: AgentSessionWriterLease | undefined,
  executionEnvironment: ExecutionEnv | undefined,
  releaseHostResources: () => Promise<void>,
): Promise<void> {
  await releaseAll([
    ...(loop === undefined ? [] : [() => loop.release()]),
    ...(sessionLease === undefined ? [] : [sessionLease.release]),
    releaseHostResources,
    ...(executionEnvironment === undefined ? [] : [() => executionEnvironment.cleanup()]),
  ]).catch(() => undefined);
}

function requireOpenAIModelRuntimeMode(
  mode: AcquireOrdinaryAgentLoopRunResourcesInput["birth"]["aiMode"],
): "openai-compatible" | "openai-responses" {
  if (mode === "openai-compatible" || mode === "openai-responses") return mode;
  throw new CodedExecutionError(
    "unsupported_provider_protocol",
    `Ordinary Session loop does not support runtime mode ${mode}.`,
  );
}
