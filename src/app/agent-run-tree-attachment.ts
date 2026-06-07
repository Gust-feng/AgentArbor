export type AgentRunTreeAttachmentStatus = "running" | "completed" | "failed" | "stopped";

export type AgentRunTreeAttachmentRootletKind =
  | "option"
  | "risk"
  | "asset_fit"
  | "evidence"
  | "constraint"
  | "counterfactual";

export type AgentRunTreeSpecAttachment = {
  readonly specId: string;
  readonly agentId: string;
  readonly displayName: string;
  readonly agentKind: string;
  readonly role: string;
  readonly rootletKind?: AgentRunTreeAttachmentRootletKind;
  readonly promptRef: string;
  readonly outputContractRef: string;
  readonly permissions: {
    readonly allowModel: boolean;
    readonly allowedTools: readonly string[];
  };
  readonly budget: {
    readonly maxModelRounds: number;
    readonly maxToolRounds: number;
    readonly maxChildRuns?: number;
    readonly maxOutputRefs?: number;
  };
};

export type AgentRunTreeAttachment = {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly rootSpec: AgentRunTreeSpecAttachment;
  readonly childRuns: readonly {
    readonly childRunId: string;
    readonly parentAgentId: string;
    readonly spec: AgentRunTreeSpecAttachment;
    readonly status: string;
    readonly inputRefs: readonly string[];
    readonly outputRefs: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly failureReason?: string;
    readonly uncertainty?: string;
    readonly confidence?: number;
    readonly startedAt: string;
    readonly completedAt?: string;
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
  readonly status: AgentRunTreeAttachmentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
};
