import type { TaskSoil } from "../domain/soil/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import {
  appendChildRunToTree,
  appendDelegationDecisionToTree,
  appendParentSynthesisToTree,
  assertNoDirectChildOutputHandoff,
  completeAgentRunTree,
  completeChildAgentRun,
  createAgentRunTree,
  replaceChildRunInTree,
  startChildAgentRun,
  type AgentRunTree,
  type ChildAgentRun,
  type ParentSynthesisResult,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";
import type { MinimalRuntime } from "./runtime.js";
import { createMinimalRuntime } from "./runtime.js";
import { createTaskSoilFromDesktopInput } from "./task-soil-workspace.js";
import type {
  CognitiveWorkSessionReport,
  CognitiveWorkSessionResult,
  CognitiveWorkSessionStatus,
  CognitiveWorkSessionStep,
  RunCognitiveWorkSessionOptions,
  WorkSessionChildMaterial,
  WorkSessionDecision,
} from "./cognitive-work-session-contracts.js";
export type {
  CognitiveWorkSessionDirectAnswer,
  CognitiveWorkSessionReport,
  CognitiveWorkSessionResult,
  CognitiveWorkSessionRuntimeContext,
  CognitiveWorkSessionStatus,
  CognitiveWorkSessionStep,
  RunCognitiveWorkSessionOptions,
  WorkSessionDecisionAction,
} from "./cognitive-work-session-contracts.js";
import { WORK_SESSION_ALLOWED_TOOLS } from "./cognitive-work-session-contracts.js";
import {
  createDelegationDecision,
  createManagerSpec,
  createParentSynthesis,
  createPlannedChildren,
  MANAGER_AGENT_ID,
  WORK_SESSION_MAX_CHILDREN,
} from "./cognitive-work-session-fabric.js";
import {
  childMaterialMessages,
  childMaterialOutputContract,
  decisionOutputContract,
  directAnswerMessages,
  directAnswerOutputContract,
  managerDecisionMessages,
  parseChildMaterial,
  parseDecision,
  parseDirectAnswer,
  parseSynthesis,
  synthesisMessages,
  synthesisOutputContract,
} from "./cognitive-work-session-model-io.js";
import {
  publishFinalArtifact,
  publishGoalReceived,
  renderReport,
  stoppedResult,
} from "./cognitive-work-session-result.js";
import {
  baseInputRefs,
  createStepRecord,
  evidenceRefsFromToolCalls,
  modelCallRefsFromEvents,
  refsFromTurn,
  toolCallIdsFromTurn,
  toolCallRefsFromEvents,
} from "./cognitive-work-session-run-projection.js";
import {
  createIntelligenceChannelFromOptions,
  createWorkSessionTurnRuntime,
  executeRequiredTurn,
} from "./cognitive-work-session-runtime.js";
import { unique } from "./cognitive-work-session-safe.js";
import {
  publishAgentDelegationPlanned,
  publishChildAgentRunCompleted,
  publishChildAgentRunStarted,
  publishChildAgentRunWaiting,
  publishParentSynthesisCompleted,
} from "./underground-events.js";

export async function runCognitiveWorkSession(
  goal = "Analyze the current AgentArbor project and produce an optimization report.",
  options: RunCognitiveWorkSessionOptions = {}
): Promise<CognitiveWorkSessionResult> {
  const aiMode = options.aiMode ?? "fake";
  const runtime = options.runtime ?? createMinimalRuntime();
  const traceId = createId("trace");
  const goalId = createId("goal");
  const createdAt = nowIso();
  const taskSoil = createTaskSoilFromDesktopInput({
    goal,
    goalId,
    traceId,
    aiMode,
    constraints: runtime.constraints,
    soilStore: runtime.soilStore,
    taskSoilInput: options.taskSoilInput,
    createdAt,
  });
  let agentRunTree = createAgentRunTree({
    treeId: createId("agent-run-tree"),
    rootRunId: createId("agent-run"),
    rootAgentId: MANAGER_AGENT_ID,
    rootSpec: createManagerSpec({ goalId, traceId, createdAt }),
    createdAt,
  });

  publishGoalReceived({ runtime, traceId, goalId, goal, taskSoil });
  options.onRuntimeReady?.({ runtime, traceId, goalId });

  const intelligenceChannel =
    options.createIntelligenceChannel ?? createIntelligenceChannelFromOptions(aiMode, options);
  if (aiMode === "none" || intelligenceChannel === undefined) {
    const stoppedTree = completeAgentRunTree(agentRunTree, "stopped", nowIso());
    return stoppedResult({
      runtime,
      traceId,
      goalId,
      taskSoil,
      agentRunTree: stoppedTree,
      openQuestion: "AI runtime is not configured; Desktop Work Session stopped before producing an artifact.",
    });
  }

  const turnRuntime = createWorkSessionTurnRuntime({
    runtime,
    intelligenceChannel,
    toolCenter: options.createToolCenter?.(runtime),
  });
  const maxChildren = Math.max(1, Math.floor(options.maxChildRuns ?? WORK_SESSION_MAX_CHILDREN));
  const stepLimit = Math.max(1, Math.floor(options.stepLimit ?? 6));
  const steps: CognitiveWorkSessionStep[] = [];
  const modelCallRefs: string[] = [];
  const toolCallRefs: string[] = [];
  const evidenceRefs: string[] = [];
  const completedChildren: ChildAgentRun[] = [];
  const childMaterials: WorkSessionChildMaterial[] = [];
  let report: CognitiveWorkSessionReport | undefined;
  let synthesis: ParentSynthesisResult | undefined;

  for (let stepIndex = 1; stepIndex <= stepLimit; stepIndex += 1) {
    const decisionTurn = await executeRequiredTurn({
      turnRuntime,
      traceId,
      goalId,
      callerAgentId: MANAGER_AGENT_ID,
      callerRef: { kind: "agent_run", id: agentRunTree.rootRunId, label: "work_session_manager" },
      purpose: "work_session_decision",
      outputContract: decisionOutputContract(),
      inputRefs: baseInputRefs(traceId, goalId, agentRunTree.rootRunId),
      messages: managerDecisionMessages({
        goal,
        taskSoil,
        tree: agentRunTree,
        stepLimit,
        stepIndex,
        steps,
        completedChildren,
        synthesis,
        report,
        evidenceRefs,
        toolCallRefs,
      }),
      allowedTools: [...WORK_SESSION_ALLOWED_TOOLS],
      maxModelRounds: 3,
      maxToolRounds: 2,
    });

    const decision = parseDecision(decisionTurn.finalOutput?.structuredOutput);
    const decisionModelRefs = refsFromTurn(decisionTurn);
    const decisionToolRefs = toolCallIdsFromTurn(decisionTurn);
    const decisionEvidenceRefs = evidenceRefsFromToolCalls(decisionTurn.toolCalls);
    modelCallRefs.push(...decisionModelRefs);
    toolCallRefs.push(...decisionToolRefs);
    evidenceRefs.push(...decisionEvidenceRefs);

    if (decision.action === "direct_answer") {
      const answerTurn = await executeRequiredTurn({
        turnRuntime,
        traceId,
        goalId,
        callerAgentId: MANAGER_AGENT_ID,
        callerRef: { kind: "agent_run", id: agentRunTree.rootRunId, label: "direct_answer" },
        purpose: "work_session_direct_answer",
        outputContract: directAnswerOutputContract(),
        inputRefs: baseInputRefs(traceId, goalId, agentRunTree.rootRunId),
        messages: directAnswerMessages({
          goal,
          taskSoil,
          decision,
          evidenceRefs,
          toolCallRefs,
        }),
        allowedTools: [],
        maxModelRounds: 1,
        maxToolRounds: 0,
      });
      const directAnswer = parseDirectAnswer(answerTurn.finalOutput);
      const answerModelRefs = refsFromTurn(answerTurn);
      modelCallRefs.push(...answerModelRefs);
      evidenceRefs.push(...directAnswer.evidenceRefs);
      agentRunTree = completeAgentRunTree(agentRunTree, "completed", nowIso());
      steps.push(createStepRecord({
        stepIndex,
        decision,
        status: "completed",
        modelCallRefs: unique([...decisionModelRefs, ...answerModelRefs]),
        toolCallRefs: decisionToolRefs,
        evidenceRefs: unique([...decisionEvidenceRefs, ...directAnswer.evidenceRefs]),
        childRunIds: [],
        summary: directAnswer.decisionSummary,
      }));
      return {
        status: "completed",
        traceId,
        goalId,
        runtime,
        taskSoil,
        agentRunTree,
        directAnswer,
        openQuestions: [],
        evidenceRefs: unique([...directAnswer.evidenceRefs, ...evidenceRefs]),
        uncertainty: directAnswer.uncertainty,
        nextActions: directAnswer.followUpSuggestions,
        steps,
        modelCallRefs: unique([...modelCallRefs, ...modelCallRefsFromEvents(runtime.eventLog.list())]),
        toolCallRefs: unique([...toolCallRefs, ...toolCallRefsFromEvents(runtime.eventLog.list())]),
        eventTypes: runtime.eventLog.types(),
      };
    }

    if (decision.action === "ask_user") {
      steps.push(createStepRecord({
        stepIndex,
        decision,
        status: "stopped",
        modelCallRefs: decisionModelRefs,
        toolCallRefs: decisionToolRefs,
        evidenceRefs: decisionEvidenceRefs,
        childRunIds: [],
        summary: decision.uncertainty,
      }));
      const stoppedTree = completeAgentRunTree(agentRunTree, "stopped", nowIso());
      return stoppedResult({
        runtime,
        traceId,
        goalId,
        taskSoil,
        agentRunTree: stoppedTree,
        openQuestion: decision.uncertainty,
        steps,
        status: "awaiting_user",
        modelCallRefs: unique(modelCallRefs),
        toolCallRefs: unique(toolCallRefs),
        evidenceRefs: unique(evidenceRefs),
      });
    }

    if (decision.action === "stop") {
      steps.push(createStepRecord({
        stepIndex,
        decision,
        status: "stopped",
        modelCallRefs: decisionModelRefs,
        toolCallRefs: decisionToolRefs,
        evidenceRefs: decisionEvidenceRefs,
        childRunIds: [],
      }));
      const stoppedTree = completeAgentRunTree(agentRunTree, "stopped", nowIso());
      return stoppedResult({
        runtime,
        traceId,
        goalId,
        taskSoil,
        agentRunTree: stoppedTree,
        openQuestion: decision.uncertainty,
        steps,
        modelCallRefs: unique(modelCallRefs),
        toolCallRefs: unique(toolCallRefs),
        evidenceRefs: unique(evidenceRefs),
      });
    }

    if (decision.action === "use_tools") {
      steps.push(createStepRecord({
        stepIndex,
        decision,
        status: "completed",
        modelCallRefs: decisionModelRefs,
        toolCallRefs: decisionToolRefs,
        evidenceRefs: decisionEvidenceRefs,
        childRunIds: [],
        summary:
          decisionToolRefs.length > 0
            ? `${decision.decisionSummary} Tool refs: ${decisionToolRefs.join(", ")}.`
            : decision.decisionSummary,
      }));
      continue;
    }

    if (decision.action === "wait_children") {
      steps.push(createStepRecord({
        stepIndex,
        decision,
        status: "completed",
        modelCallRefs: decisionModelRefs,
        toolCallRefs: decisionToolRefs,
        evidenceRefs: decisionEvidenceRefs,
        childRunIds: completedChildren.map((child) => child.childRunId),
      }));
      continue;
    }

    if (decision.action === "spawn_children") {
      const remainingChildBudget = maxChildren - agentRunTree.childRuns.length;
      if (remainingChildBudget <= 0 || decision.childSpecs.length === 0) {
        steps.push(createStepRecord({
          stepIndex,
          decision,
          status: "stopped",
          modelCallRefs: decisionModelRefs,
          toolCallRefs: decisionToolRefs,
          evidenceRefs: decisionEvidenceRefs,
          childRunIds: [],
          summary:
            remainingChildBudget <= 0
              ? "Child delegation budget is exhausted; Work Session stopped before fabricating an artifact."
              : "Model requested child delegation without child specs; Work Session stopped at schema boundary.",
        }));
        const stoppedTree = completeAgentRunTree(agentRunTree, "stopped", nowIso());
        return stoppedResult({
          runtime,
          traceId,
          goalId,
          taskSoil,
          agentRunTree: stoppedTree,
          openQuestion:
            remainingChildBudget <= 0
              ? "Child delegation budget is exhausted."
              : "Model requested child delegation without child specs.",
          steps,
          modelCallRefs: unique(modelCallRefs),
          toolCallRefs: unique(toolCallRefs),
          evidenceRefs: unique(evidenceRefs),
        });
      }

      const plannedChildren = createPlannedChildren({
        requests: decision.childSpecs.slice(0, remainingChildBudget),
        parentAgentId: MANAGER_AGENT_ID,
        goalId,
        traceId,
        createdAt: nowIso(),
      });
      const delegationDecision = createDelegationDecision({
        decision,
        childRuns: plannedChildren,
        traceId,
        modelCallRefs: decisionModelRefs,
      });
      agentRunTree = appendDelegationDecisionToTree(agentRunTree, delegationDecision, nowIso());
      for (const child of plannedChildren) {
        agentRunTree = appendChildRunToTree(agentRunTree, child, nowIso());
      }
      publishAgentDelegationPlanned({
        runtime,
        traceId,
        parentAgentId: MANAGER_AGENT_ID,
        delegationDecision,
        childSpecs: plannedChildren.map((child) => child.spec),
        agentRunTree,
      });

      const startedChildren: ChildAgentRun[] = [];
      for (const planned of plannedChildren) {
        const started = startChildAgentRun(planned, nowIso());
        startedChildren.push(started);
        agentRunTree = replaceChildRunInTree(agentRunTree, started, nowIso());
        publishChildAgentRunStarted({
          runtime,
          traceId,
          parentAgentId: MANAGER_AGENT_ID,
          childRun: started,
          agentRunTree,
        });
      }
      publishChildAgentRunWaiting({
        runtime,
        traceId,
        parentAgentId: MANAGER_AGENT_ID,
        childRunIds: startedChildren.map((child) => child.childRunId),
        agentRunTree,
      });

      for (const started of startedChildren) {
        const childTurn = await executeRequiredTurn({
          turnRuntime,
          traceId,
          goalId,
          callerAgentId: started.spec.agentId,
          callerRef: { kind: "agent_run", id: started.childRunId, label: started.spec.role },
          purpose: "work_session_child_material",
          outputContract: childMaterialOutputContract(),
          inputRefs: [
            ...baseInputRefs(traceId, goalId, agentRunTree.rootRunId),
            { kind: "agent_spec", id: started.spec.specId, label: started.spec.displayName },
          ],
          messages: childMaterialMessages({
            goal,
            taskSoil,
            spec: started.spec,
            evidenceRefs,
            toolCallRefs,
            steps,
          }),
          allowedTools: started.spec.permissions.allowedTools,
          maxModelRounds: started.spec.budget.maxModelRounds,
          maxToolRounds: started.spec.budget.maxToolRounds,
        });
        const material = parseChildMaterial(childTurn.finalOutput?.structuredOutput);
        const childModelRefs = refsFromTurn(childTurn);
        const childToolRefs = toolCallIdsFromTurn(childTurn);
        const childEvidenceRefs = unique([...material.evidenceRefs, ...evidenceRefsFromToolCalls(childTurn.toolCalls)]);
        modelCallRefs.push(...childModelRefs);
        toolCallRefs.push(...childToolRefs);
        evidenceRefs.push(...childEvidenceRefs);

        const outputRef = `work-material:${started.childRunId}`;
        const completed = completeChildAgentRun({
          run: started,
          outputRefs: [outputRef],
          evidenceRefs: childEvidenceRefs,
          confidence: material.confidence,
          uncertainty: material.uncertainty,
          completedAt: nowIso(),
        });
        completedChildren.push(completed);
        childMaterials.push(material);
        agentRunTree = replaceChildRunInTree(agentRunTree, completed, nowIso());
        publishChildAgentRunCompleted({
          runtime,
          traceId,
          parentAgentId: MANAGER_AGENT_ID,
          childRun: completed,
          agentRunTree,
        });
      }

      steps.push(createStepRecord({
        stepIndex,
        decision,
        status: "completed",
        modelCallRefs: decisionModelRefs,
        toolCallRefs: decisionToolRefs,
        evidenceRefs: decisionEvidenceRefs,
        childRunIds: plannedChildren.map((child) => child.childRunId),
      }));
      continue;
    }

    if (decision.action === "synthesize") {
      if (completedChildren.length === 0 && evidenceRefs.length === 0) {
        steps.push(createStepRecord({
          stepIndex,
          decision,
          status: "stopped",
          modelCallRefs: decisionModelRefs,
          toolCallRefs: decisionToolRefs,
          evidenceRefs: decisionEvidenceRefs,
          childRunIds: [],
          summary: "Synthesis requires completed child material or tool evidence refs; Work Session stopped.",
        }));
        const stoppedTree = completeAgentRunTree(agentRunTree, "stopped", nowIso());
        return stoppedResult({
          runtime,
          traceId,
          goalId,
          taskSoil,
          agentRunTree: stoppedTree,
          openQuestion: "Synthesis requires completed child material or tool evidence refs.",
          steps,
          modelCallRefs: unique(modelCallRefs),
          toolCallRefs: unique(toolCallRefs),
          evidenceRefs: unique(evidenceRefs),
        });
      }

      const synthesisTurn = await executeRequiredTurn({
        turnRuntime,
        traceId,
        goalId,
        callerAgentId: MANAGER_AGENT_ID,
        callerRef: { kind: "agent_run", id: agentRunTree.rootRunId, label: "parent_synthesis" },
        purpose: "work_session_synthesis",
        outputContract: synthesisOutputContract(),
        inputRefs: [
          ...baseInputRefs(traceId, goalId, agentRunTree.rootRunId),
          ...completedChildren.map((child) => ({ kind: "agent_run" as const, id: child.childRunId, label: child.spec.displayName })),
        ],
        messages: synthesisMessages({
          goal,
          taskSoil,
          childRuns: completedChildren,
          materials: childMaterials,
          steps,
          evidenceRefs,
          toolCallRefs,
        }),
        allowedTools: [],
        maxModelRounds: 1,
        maxToolRounds: 0,
      });
      report = parseSynthesis(synthesisTurn.finalOutput?.structuredOutput);
      const synthesisModelRefs = refsFromTurn(synthesisTurn);
      modelCallRefs.push(...synthesisModelRefs);
      evidenceRefs.push(...report.evidenceRefs);
      synthesis = createParentSynthesis({
        report,
        childRuns: completedChildren,
        traceId,
        modelCallRefs: synthesisModelRefs,
      });
      agentRunTree = appendParentSynthesisToTree(agentRunTree, synthesis, nowIso());
      publishParentSynthesisCompleted({
        runtime,
        traceId,
        parentAgentId: MANAGER_AGENT_ID,
        parentSynthesis: synthesis,
        childRuns: completedChildren,
        agentRunTree,
      });
      steps.push(createStepRecord({
        stepIndex,
        decision,
        status: "completed",
        modelCallRefs: unique([...decisionModelRefs, ...synthesisModelRefs]),
        toolCallRefs: decisionToolRefs,
        evidenceRefs: unique([...decisionEvidenceRefs, ...report.evidenceRefs]),
        childRunIds: completedChildren.map((child) => child.childRunId),
        synthesisId: synthesis.synthesisId,
      }));
      continue;
    }

    if (decision.action === "produce_artifact") {
      if (report === undefined || synthesis === undefined) {
        steps.push(createStepRecord({
          stepIndex,
          decision,
          status: "stopped",
          modelCallRefs: decisionModelRefs,
          toolCallRefs: decisionToolRefs,
          evidenceRefs: decisionEvidenceRefs,
          childRunIds: completedChildren.map((child) => child.childRunId),
          summary: "Artifact production requires parent synthesis; Work Session stopped before final output.",
        }));
        const stoppedTree = completeAgentRunTree(agentRunTree, "stopped", nowIso());
        return stoppedResult({
          runtime,
          traceId,
          goalId,
          taskSoil,
          agentRunTree: stoppedTree,
          openQuestion: "Artifact production requires parent synthesis.",
          steps,
          modelCallRefs: unique(modelCallRefs),
          toolCallRefs: unique(toolCallRefs),
          evidenceRefs: unique(evidenceRefs),
        });
      }

      assertNoDirectChildOutputHandoff({
        handoffInputRefs: synthesis.outputRefs,
        childRuns: completedChildren,
      });

      const finalArtifact = runtime.artifactStore.save({
        producedBy: MANAGER_AGENT_ID,
        type: "report",
        content: renderReport({ goal, report }),
        summary: report.title,
      });
      publishFinalArtifact({ runtime, traceId, finalArtifact, report, synthesis });
      agentRunTree = completeAgentRunTree(agentRunTree, "completed", nowIso());
      steps.push(createStepRecord({
        stepIndex,
        decision,
        status: "completed",
        modelCallRefs: decisionModelRefs,
        toolCallRefs: decisionToolRefs,
        evidenceRefs: decisionEvidenceRefs,
        childRunIds: completedChildren.map((child) => child.childRunId),
        synthesisId: synthesis.synthesisId,
      }));

      return {
        status: "completed",
        traceId,
        goalId,
        runtime,
        taskSoil,
        agentRunTree,
        finalArtifact,
        report,
        openQuestions: [],
        evidenceRefs: unique([...report.evidenceRefs, ...evidenceRefs]),
        uncertainty: report.uncertainty,
        nextActions: report.nextActions,
        steps,
        modelCallRefs: unique([...modelCallRefs, ...modelCallRefsFromEvents(runtime.eventLog.list())]),
        toolCallRefs: unique([...toolCallRefs, ...toolCallRefsFromEvents(runtime.eventLog.list())]),
        eventTypes: runtime.eventLog.types(),
      };
    }
  }

  const stoppedTree = completeAgentRunTree(agentRunTree, "stopped", nowIso());
  return stoppedResult({
    runtime,
    traceId,
    goalId,
    taskSoil,
    agentRunTree: stoppedTree,
    openQuestion: `Work Session reached step limit ${stepLimit} before producing an artifact.`,
    steps,
    modelCallRefs: unique(modelCallRefs),
    toolCallRefs: unique(toolCallRefs),
    evidenceRefs: unique(evidenceRefs),
  });
}
