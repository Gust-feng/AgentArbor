import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { AgentDefinitionRegistry } from "../agent-definition-registry.js";
import { runAgentDefinitionRef } from "../agent-definition-runtime.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { createPanelRunResponse, executeBasicPanelRun, runForPanel } from "./run-execution.js";
import { PanelHttpError } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";

test("panel run response uses execution-frozen facts before current config", async () => {
  const currentConfig = modelConfig("current-profile", "current-model");
  const currentInformationAccess = informationAccess(20);
  const frozenConfig = modelConfig("frozen-profile", "frozen-model");
  const frozenInformationAccess = informationAccess(5);

  const response = await createPanelRunResponse({
    runtime: runtimeWithCurrentConfig(currentConfig, currentInformationAccess),
    runKind: "desktop",
    runMode: "agent",
    requestedMode: "fake",
    run: {
      completed: true,
      config: modelConfig("execution-profile", "execution-model"),
      informationAccess: frozenInformationAccess,
      capabilitySnapshot: capabilitySnapshot(frozenConfig),
      agentDefinitionRef: frozenAgentDefinitionRef(),
      eventEntries: [],
    },
  });

  assert.equal(response.config.profileId, "frozen-profile");
  assert.equal(response.config.model, "frozen-model");
  assert.equal(response.tracking.provider.model, "frozen-model");
  assert.equal(response.informationAccess.web.maxResults, 5);
  assert.equal(response.tracking.informationSources.web.maxResults, 5);
});

test("panel run response rejects results without an explicit terminal state", async () => {
  await assert.rejects(
    () =>
      createPanelRunResponse({
        runtime: runtimeWithCurrentConfig(modelConfig("current-profile", "current-model"), informationAccess(20)),
        runKind: "desktop",
        runMode: "agent",
        requestedMode: "fake",
        run: {
          config: modelConfig("execution-profile", "execution-model"),
          informationAccess: informationAccess(5),
          capabilitySnapshot: capabilitySnapshot(modelConfig("frozen-profile", "frozen-model")),
          agentDefinitionRef: frozenAgentDefinitionRef(),
          eventEntries: [],
        },
      }),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      const panelError = error as PanelHttpError;
      assert.equal(panelError.statusCode, 500);
      assert.equal(panelError.code, "run_terminal_state_missing");
      return true;
    }
  );
});

test("panel run response rejects ordinary desktop results without run-created facts", async () => {
  await assert.rejects(
    () =>
      createPanelRunResponse({
        runtime: runtimeWithCurrentConfig(modelConfig("current-profile", "current-model"), informationAccess(20)),
        runKind: "desktop",
        runMode: "agent",
        requestedMode: "fake",
        run: {
          config: modelConfig("execution-profile", "execution-model"),
          informationAccess: informationAccess(5),
          eventEntries: [],
        },
      }),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      const panelError = error as PanelHttpError;
      assert.equal(panelError.statusCode, 500);
      assert.equal(panelError.code, "desktop_capability_snapshot_required");
      return true;
    }
  );
});

test("panel run execution rejects desktop deep mode below the route layer", async () => {
  await assert.rejects(
    () =>
      runForPanel(
        runtimeWithCurrentConfig(modelConfig("current-profile", "current-model"), informationAccess(20)),
        "desktop",
        "不要从内部把 Desktop 默认入口跑成 deep",
        "fake",
        undefined,
        "deep"
      ),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      const panelError = error as PanelHttpError;
      assert.equal(panelError.statusCode, 400);
      assert.equal(panelError.code, "desktop_run_mode_not_supported");
      return true;
    }
  );
});

test("panel run execution rejects underground ordinary agent mode below the route layer", async () => {
  await assert.rejects(
    () =>
      runForPanel(
        runtimeWithCurrentConfig(modelConfig("current-profile", "current-model"), informationAccess(20)),
        "underground",
        "不要从内部把 Underground 入口跑成普通 agent",
        "fake",
        undefined,
        "agent"
      ),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      const panelError = error as PanelHttpError;
      assert.equal(panelError.statusCode, 400);
      assert.equal(panelError.code, "underground_run_mode_not_supported");
      return true;
    }
  );
});

test("panel run execution rejects agent definition drift before running a restored desktop job", async () => {
  const oldDefinition = {
    ...DESKTOP_ROOT_AGENT,
    prompt: {
      ...DESKTOP_ROOT_AGENT.prompt,
      systemPrompt: "Old prompt content must not leak from drift checks.",
    },
  };

  await assert.rejects(
    () =>
      executeBasicPanelRun({
        agentDefinitions: new AgentDefinitionRegistry([DESKTOP_ROOT_AGENT]),
      } as unknown as PanelRuntime, {
        job: {
          ...panelRunJob(),
          agentDefinitionRef: runAgentDefinitionRef(oldDefinition),
        },
        abortSignal: new AbortController().signal,
        onRuntimeReady: () => undefined,
        onModelOutputDelta: () => undefined,
      }),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      const panelError = error as PanelHttpError;
      assert.equal(panelError.statusCode, 500);
      assert.equal(panelError.code, "agent_definition_mismatch");
      assert.equal(panelError.message.includes(oldDefinition.prompt.systemPrompt), false);
      return true;
    }
  );
});

test("panel run execution rejects ordinary desktop jobs without a frozen agent definition ref", async () => {
  await assert.rejects(
    () =>
      executeBasicPanelRun({
        agentDefinitions: new AgentDefinitionRegistry([DESKTOP_ROOT_AGENT]),
      } as unknown as PanelRuntime, {
        job: panelRunJob(),
        abortSignal: new AbortController().signal,
        onRuntimeReady: () => undefined,
        onModelOutputDelta: () => undefined,
      }),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      const panelError = error as PanelHttpError;
      assert.equal(panelError.statusCode, 500);
      assert.equal(panelError.code, "agent_definition_ref_required");
      return true;
    }
  );
});

test("panel run response projects failed execution result as failed", async () => {
  const agentDefinitionRef = frozenAgentDefinitionRef();
  const resolution = capabilityResolution(agentDefinitionRef);
  const response = await createPanelRunResponse({
    runtime: runtimeWithCurrentConfig(modelConfig("current-profile", "current-model"), informationAccess(20)),
    runKind: "desktop",
    runMode: "agent",
    requestedMode: "fake",
    run: ordinaryDesktopRunResult({
      config: modelConfig("execution-profile", "execution-model"),
      informationAccess: informationAccess(5),
      capabilityResolution: resolution,
      eventEntries: [],
      failed: {
        code: "desktop_agent_failed",
        message: "模型没有形成最终结果。",
      },
    }, agentDefinitionRef),
  });

  assert.equal(response.status, "failed");
  assert.equal(response.trace.status, "failed");
  assert.equal(response.tracking.run.status, "failed");
  assert.equal(response.transcript.status, "failed");
  assert.deepEqual(response.agentDefinitionRef, agentDefinitionRef);
  assert.deepEqual(response.capabilityResolution, resolution);
  assert.deepEqual(response.error, {
    code: "desktop_agent_failed",
    message: "模型没有形成最终结果。",
  });
  assert.equal(response.transcript.events[0]?.agentLabel, "Frozen Failure Agent");
  assert.equal(response.transcript.events.at(-1)?.type, "run.failed");
  assert.equal(response.transcript.events.at(-1)?.status, "failed");
  assert.equal(response.transcript.events.at(-1)?.agentLabel, "Frozen Failure Agent");
  assert.equal(JSON.stringify(response.agentDefinitionRef).includes("systemPrompt"), false);
  assert.equal(JSON.stringify(response.capabilityResolution).includes("systemPrompt"), false);
});

test("panel run response projects blocked execution result as blocked", async () => {
  const agentDefinitionRef = frozenAgentDefinitionRef();
  const response = await createPanelRunResponse({
    runtime: runtimeWithCurrentConfig(modelConfig("current-profile", "current-model"), informationAccess(20)),
    runKind: "desktop",
    runMode: "agent",
    requestedMode: "fake",
    run: ordinaryDesktopRunResult({
      config: modelConfig("execution-profile", "execution-model"),
      informationAccess: informationAccess(5),
      eventEntries: [],
      blocked: {
        code: "out_of_fuel",
        message: "当前轮次已到上限，任务没有完成。",
      },
    }, agentDefinitionRef),
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.trace.status, "blocked");
  assert.equal(response.tracking.run.status, "blocked");
  assert.equal(response.transcript.status, "blocked");
  assert.deepEqual(response.error, {
    code: "out_of_fuel",
    message: "当前轮次已到上限，任务没有完成。",
  });
  assert.equal(response.transcript.events.at(1)?.type, "run.blocked");
  assert.equal(response.transcript.events.at(1)?.status, "blocked");
});

test("panel run response projects pending approval execution result as approval needed", async () => {
  const agentDefinitionRef = frozenAgentDefinitionRef();
  const response = await createPanelRunResponse({
    runtime: runtimeWithCurrentConfig(modelConfig("current-profile", "current-model"), informationAccess(20)),
    runKind: "desktop",
    runMode: "agent",
    requestedMode: "fake",
    run: ordinaryDesktopRunResult({
      config: modelConfig("execution-profile", "execution-model"),
      informationAccess: informationAccess(5),
      eventEntries: [],
      pendingApproval: {
        confirmationId: "confirmation-test",
        resume: async () => ({
          failed: {
            code: "not_used",
            message: "not used",
          },
        }),
        resumeWithDecision: async () => ({
          failed: {
            code: "not_used",
            message: "not used",
          },
        }),
      },
    }, agentDefinitionRef),
  });

  assert.equal(response.status, "approval_needed");
  assert.equal(response.trace.status, "approval_needed");
  assert.equal(response.tracking.run.status, "approval_needed");
  assert.equal(response.transcript.status, "approval_needed");
  assert.equal(response.error, undefined);
});

function runtimeWithCurrentConfig(
  config: SanitizedModelProviderConfig,
  informationAccessConfig: SanitizedInformationAccessConfig
): PanelRuntime {
  return {
    configCenter: {
      getModelProviderConfig: async () => config,
      getInformationAccessConfig: async () => informationAccessConfig,
    },
  } as unknown as PanelRuntime;
}

function ordinaryDesktopRunResult(
  run: Parameters<typeof createPanelRunResponse>[0]["run"],
  agentDefinitionRef = frozenAgentDefinitionRef()
): Parameters<typeof createPanelRunResponse>[0]["run"] {
  const config = run.config ?? modelConfig("execution-profile", "execution-model");
  return {
    ...run,
    config,
    informationAccess: run.informationAccess ?? informationAccess(5),
    capabilitySnapshot: run.capabilitySnapshot ?? capabilitySnapshot(config),
    agentDefinitionRef,
  };
}

function panelRunJob() {
  return {
    runId: "run-agent-definition-drift",
    runKind: "desktop" as const,
    runMode: "agent" as const,
    goal: "恢复一个定义已经漂移的普通 Agent run",
    aiMode: "fake" as const,
    status: "pending" as const,
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    config: modelConfig("frozen-profile", "frozen-model"),
    informationAccess: informationAccess(5),
    streamEvents: [],
    streamEventIds: new Set<string>(),
    nextStreamSequence: 1,
    confirmationDecisions: [],
  };
}

function capabilitySnapshot(activeModel: SanitizedModelProviderConfig): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "snapshot-test",
    createdAt: "2026-06-06T00:00:00.000Z",
    activeModel,
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
    },
    toolCatalog: {
      scope: "desktop-basic",
      tools: [],
      allowedTools: [],
    },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\AgentArbor",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    securitySummary: "Test snapshot.",
    warnings: [],
  };
}

function modelConfig(profileId: string, model: string): SanitizedModelProviderConfig {
  return {
    defaultAiMode: "fake",
    profileId,
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: `https://${profileId}.example.test`,
    model,
    secretRef: `secret://test/${profileId}`,
    secretConfigured: false,
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
}

function informationAccess(maxResults: number): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web"],
    web: {
      provider: "tavily",
      providerKind: "tavily",
      maxResults,
      secretRef: "secret://test/tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}

function frozenAgentDefinitionRef(): RunAgentDefinitionRef {
  return {
    agentId: "frozen-failure-agent",
    agentDisplayName: "Frozen Failure Agent",
    promptRef: "prompt:frozen-failure-agent:v1",
    promptVersion: "v1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: "frozen-failure-agent:ordinary-visible-tools:v1",
  };
}

function capabilityResolution(agentDefinitionRef: RunAgentDefinitionRef): RunCapabilityResolution {
  return {
    resolutionId: "capability-resolution-failure",
    snapshotId: "snapshot-test",
    runMode: "agent",
    agentId: agentDefinitionRef.agentId,
    agentDisplayName: agentDefinitionRef.agentDisplayName,
    toolVisibilityProfileId: agentDefinitionRef.toolVisibilityProfileId,
    allowedTools: ["search"],
    toolExposures: [{
      name: "search",
      displayName: "Search",
      enabled: true,
      modelVisible: true,
      scopes: ["desktop-basic"],
      availability: "available",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
      reason: "可用。",
    }],
    enabledSkills: [],
    mcpDrafts: [],
    warnings: [],
    createdAt: "2026-06-06T00:00:00.000Z",
  };
}
