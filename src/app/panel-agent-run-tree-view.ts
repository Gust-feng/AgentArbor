import type { AgentRunTreeAttachment, AgentRunTreeAttachmentRootletKind } from "./agent-run-tree-attachment.js";

export type SafeAgentRunTreeView = {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly status: AgentRunTreeAttachment["status"];
  readonly rootSpec: {
    readonly specId: string;
    readonly agentId: string;
    readonly displayName: string;
    readonly agentKind: string;
    readonly role: string;
    readonly promptRef: string;
    readonly outputContractRef: string;
    readonly allowedTools: readonly string[];
    readonly allowModel: boolean;
    readonly budget: {
      readonly maxModelRounds: number;
      readonly maxToolRounds: number;
      readonly maxChildRuns?: number;
      readonly maxOutputRefs?: number;
    };
  };
  readonly childRuns: readonly {
    readonly childRunId: string;
    readonly parentAgentId: string;
    readonly status: string;
    readonly specId: string;
    readonly agentId: string;
    readonly displayName: string;
    readonly agentKind: string;
    readonly role: string;
    readonly rootletKind?: AgentRunTreeAttachmentRootletKind;
    readonly promptRef: string;
    readonly outputContractRef: string;
    readonly allowModel: boolean;
    readonly allowedTools: readonly string[];
    readonly budget: {
      readonly maxModelRounds: number;
      readonly maxToolRounds: number;
      readonly maxChildRuns?: number;
      readonly maxOutputRefs?: number;
    };
    readonly inputRefs: readonly string[];
    readonly outputRefs: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly uncertainty?: string;
    readonly confidence?: number;
    readonly startedAt: string;
    readonly completedAt?: string;
    readonly failureReason?: string;
  }[];
  readonly delegationDecisions: readonly {
    readonly decisionId: string;
    readonly parentAgentId: string;
    readonly action: string;
    readonly childSpecIds: readonly string[];
    readonly childRunIds: readonly string[];
    readonly rationale: string;
    readonly uncertainty: string;
    readonly source: string;
    readonly confidence: number;
    readonly reasoningTraceRefs: readonly string[];
    readonly createdAt: string;
  }[];
  readonly parentSyntheses: readonly {
    readonly synthesisId: string;
    readonly parentAgentId: string;
    readonly childRunIds: readonly string[];
    readonly retainedMaterialRefs: readonly string[];
    readonly rejectedMaterialRefs: readonly string[];
    readonly conflictRefs: readonly string[];
    readonly outputRefs: readonly string[];
    readonly nextAction: string;
    readonly decisionSummary: string;
    readonly uncertainty: string;
    readonly source: string;
    readonly confidence: number;
    readonly reasoningTraceRefs: readonly string[];
    readonly createdAt: string;
  }[];
};

export function createSafeAgentRunTreeView(tree: AgentRunTreeAttachment): SafeAgentRunTreeView {
  return {
    treeId: tree.treeId,
    rootRunId: tree.rootRunId,
    rootAgentId: tree.rootAgentId,
    status: tree.status,
    rootSpec: {
      specId: tree.rootSpec.specId,
      agentId: tree.rootSpec.agentId,
      displayName: tree.rootSpec.displayName,
      agentKind: tree.rootSpec.agentKind,
      role: tree.rootSpec.role,
      promptRef: tree.rootSpec.promptRef,
      outputContractRef: tree.rootSpec.outputContractRef,
      allowedTools: [...tree.rootSpec.permissions.allowedTools],
      allowModel: tree.rootSpec.permissions.allowModel,
      budget: { ...tree.rootSpec.budget },
    },
    childRuns: tree.childRuns.map((run) => ({
      childRunId: run.childRunId,
      parentAgentId: run.parentAgentId,
      status: run.status,
      specId: run.spec.specId,
      agentId: run.spec.agentId,
      displayName: run.spec.displayName,
      agentKind: run.spec.agentKind,
      role: run.spec.role,
      rootletKind: run.spec.rootletKind,
      promptRef: run.spec.promptRef,
      outputContractRef: run.spec.outputContractRef,
      allowModel: run.spec.permissions.allowModel,
      allowedTools: [...run.spec.permissions.allowedTools],
      budget: { ...run.spec.budget },
      inputRefs: [...run.inputRefs],
      outputRefs: [...run.outputRefs],
      evidenceRefs: [...run.evidenceRefs],
      uncertainty: run.uncertainty,
      confidence: run.confidence,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      failureReason: run.failureReason,
    })),
    delegationDecisions: tree.delegationDecisions.map((decision) => ({
      decisionId: decision.decisionId,
      parentAgentId: decision.parentAgentId,
      action: decision.action,
      childSpecIds: [...decision.childSpecIds],
      childRunIds: [...decision.childRunIds],
      rationale: decision.rationale,
      uncertainty: decision.uncertainty,
      source: decision.source,
      confidence: decision.confidence,
      reasoningTraceRefs: [...decision.reasoningTraceRefs],
      createdAt: decision.createdAt,
    })),
    parentSyntheses: tree.parentSyntheses.map((synthesis) => ({
      synthesisId: synthesis.synthesisId,
      parentAgentId: synthesis.parentAgentId,
      childRunIds: [...synthesis.childRunIds],
      retainedMaterialRefs: [...synthesis.retainedMaterialRefs],
      rejectedMaterialRefs: [...synthesis.rejectedMaterialRefs],
      conflictRefs: [...synthesis.conflictRefs],
      outputRefs: [...synthesis.outputRefs],
      nextAction: synthesis.nextAction,
      decisionSummary: synthesis.decisionSummary,
      uncertainty: synthesis.uncertainty,
      source: synthesis.source,
      confidence: synthesis.confidence,
      reasoningTraceRefs: [...synthesis.reasoningTraceRefs],
      createdAt: synthesis.createdAt,
    })),
  };
}
