import type {
  CandidatePool,
  GoalIntentProfile,
  RootletOutput,
  UndergroundConvergenceReport,
  UndergroundEvidenceLedger,
  UndergroundAgentClusterRun,
  UndergroundAutonomyReview,
  UndergroundExplorationPlan,
  UndergroundExplorationReport,
} from "../../../domain/underground/index.js";

export function createUndergroundExplorationReport(input: {
  plan: UndergroundExplorationPlan;
  agentClusterRun?: UndergroundAgentClusterRun;
  agentRunTree?: UndergroundExplorationReport["agentRunTree"];
  goalIntentProfile?: GoalIntentProfile;
  autonomy?: UndergroundAutonomyReview;
  evidenceLedger?: UndergroundEvidenceLedger;
  rootletOutputs: RootletOutput[];
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): UndergroundExplorationReport {
  return {
    plan: input.plan,
    agentClusterRun: input.agentClusterRun === undefined ? undefined : cloneAgentClusterRun(input.agentClusterRun),
    agentRunTree: input.agentRunTree === undefined ? undefined : cloneAgentRunTree(input.agentRunTree),
    goalIntentProfile: input.goalIntentProfile === undefined ? undefined : cloneGoalIntentProfile(input.goalIntentProfile),
    autonomy: input.autonomy === undefined ? undefined : cloneAutonomyReview(input.autonomy),
    evidenceLedger: input.evidenceLedger === undefined ? undefined : cloneEvidenceLedger(input.evidenceLedger),
    rootletOutputs: input.rootletOutputs.map((output) => ({ ...output })),
    candidatePool: {
      ...input.candidatePool,
      sourceRootletOutputRefs: [...input.candidatePool.sourceRootletOutputRefs],
      candidates: input.candidatePool.candidates.map((candidate) => ({ ...candidate })),
      candidatesByKind: {
        option: input.candidatePool.candidatesByKind.option.map((candidate) => ({ ...candidate })),
        risk: input.candidatePool.candidatesByKind.risk.map((candidate) => ({ ...candidate })),
        asset_fit: input.candidatePool.candidatesByKind.asset_fit.map((candidate) => ({ ...candidate })),
        evidence: input.candidatePool.candidatesByKind.evidence.map((candidate) => ({ ...candidate })),
        constraint: input.candidatePool.candidatesByKind.constraint.map((candidate) => ({ ...candidate })),
        counterfactual: input.candidatePool.candidatesByKind.counterfactual.map((candidate) => ({ ...candidate })),
      },
    },
    convergenceReport: {
      ...input.convergenceReport,
      decisions: input.convergenceReport.decisions.map((decision) => ({
        ...decision,
        sourceCandidateRefs: [...decision.sourceCandidateRefs],
        provenanceRefs: [...decision.provenanceRefs],
        evidenceRefs: [...(decision.evidenceRefs ?? [])],
      })),
      candidateComparisons: (input.convergenceReport.candidateComparisons ?? []).map((comparison) => ({
        ...comparison,
        evidenceGaps: [...comparison.evidenceGaps],
        hardConstraintConflictRefs: [...comparison.hardConstraintConflictRefs],
        riskCoverage: [...comparison.riskCoverage],
        unknowns: [...comparison.unknowns],
        whyNot: [...comparison.whyNot],
        evidenceRefs: [...comparison.evidenceRefs],
      })),
      reasoningTrace: (input.convergenceReport.reasoningTrace ?? []).map((entry) => ({
        ...entry,
        inputRefs: [...entry.inputRefs],
        modelCallRefs: [...entry.modelCallRefs],
        toolCallRefs: [...entry.toolCallRefs],
        fallbackRefs: [...entry.fallbackRefs],
      })),
    },
  };
}

function cloneAgentRunTree(
  tree: NonNullable<UndergroundExplorationReport["agentRunTree"]>
): NonNullable<UndergroundExplorationReport["agentRunTree"]> {
  return {
    ...tree,
    rootSpec: {
      ...tree.rootSpec,
      protocol: {
        inputs: tree.rootSpec.protocol.inputs.map((input) => ({ ...input })),
        outputs: tree.rootSpec.protocol.outputs.map((output) => ({ ...output })),
      },
      permissions: {
        ...tree.rootSpec.permissions,
        allowedTools: [...tree.rootSpec.permissions.allowedTools],
      },
      budget: { ...tree.rootSpec.budget },
      inputRefs: [...tree.rootSpec.inputRefs],
    },
    childRuns: tree.childRuns.map((run) => ({
      ...run,
      spec: {
        ...run.spec,
        protocol: {
          inputs: run.spec.protocol.inputs.map((input) => ({ ...input })),
          outputs: run.spec.protocol.outputs.map((output) => ({ ...output })),
        },
        permissions: {
          ...run.spec.permissions,
          allowedTools: [...run.spec.permissions.allowedTools],
        },
        budget: { ...run.spec.budget },
        inputRefs: [...run.spec.inputRefs],
      },
      inputRefs: [...run.inputRefs],
      outputRefs: [...run.outputRefs],
      evidenceRefs: [...run.evidenceRefs],
      execution:
        run.execution === undefined
          ? undefined
          : {
              ...run.execution,
              toolCalls: run.execution.toolCalls.map((call) => ({ ...call })),
            },
      executionHistory: run.executionHistory?.map((segment) => ({
        ...segment,
        toolCalls: segment.toolCalls.map((call) => ({ ...call })),
      })),
      parentInstructions: run.parentInstructions?.map((instruction) => ({
        ...instruction,
        review:
          instruction.review === undefined
            ? undefined
            : {
                ...instruction.review,
                evidenceRefs: [...instruction.review.evidenceRefs],
              },
      })),
      pendingApproval:
        run.pendingApproval === undefined
          ? undefined
          : {
              ...run.pendingApproval,
              affectedResources: [...run.pendingApproval.affectedResources],
              sourceRefs: [...run.pendingApproval.sourceRefs],
            },
    })),
    delegationDecisions: tree.delegationDecisions.map((decision) => ({
      ...decision,
      childSpecIds: [...decision.childSpecIds],
      childRunIds: [...decision.childRunIds],
      inputRefs: [...decision.inputRefs],
      reasoningTraceRefs: [...decision.reasoningTraceRefs],
    })),
    parentSyntheses: tree.parentSyntheses.map((synthesis) => ({
      ...synthesis,
      childRunIds: [...synthesis.childRunIds],
      inputRefs: [...synthesis.inputRefs],
      retainedMaterialRefs: [...synthesis.retainedMaterialRefs],
      rejectedMaterialRefs: [...synthesis.rejectedMaterialRefs],
      conflictRefs: [...synthesis.conflictRefs],
      childReviews: synthesis.childReviews?.map((review) => ({
        ...review,
        evidenceRefs: [...review.evidenceRefs],
      })),
      outputRefs: [...synthesis.outputRefs],
      reasoningTraceRefs: [...synthesis.reasoningTraceRefs],
    })),
  };
}

function cloneAutonomyReview(review: UndergroundAutonomyReview): UndergroundAutonomyReview {
  return {
    enabled: review.enabled,
    latestDecision: review.latestDecision === undefined ? undefined : cloneAutonomyDecision(review.latestDecision),
    decisions: review.decisions.map(cloneAutonomyDecision),
    cycles: review.cycles.map((cycle) => ({
      ...cycle,
      rootletKinds: [...cycle.rootletKinds],
    })),
    stopReason: review.stopReason,
  };
}

function cloneAutonomyDecision(
  decision: NonNullable<UndergroundAutonomyReview["latestDecision"]>
): NonNullable<UndergroundAutonomyReview["latestDecision"]> {
  return {
    ...decision,
    informationGaps: [...decision.informationGaps],
    spawnRequests: decision.spawnRequests.map((request) => ({
      ...request,
      informationNeeds: [...request.informationNeeds],
      sourceHints: [...request.sourceHints],
      expectedEvidence: [...request.expectedEvidence],
    })),
    sourceRefs: [...decision.sourceRefs],
    modelCallRefs: decision.modelCallRefs.map((ref) => ({
      ...ref,
      eventRefs: [...ref.eventRefs],
    })),
  };
}

function cloneAgentClusterRun(run: UndergroundAgentClusterRun): UndergroundAgentClusterRun {
  return {
    ...run,
    plan: {
      ...run.plan,
      budget: { ...run.plan.budget },
      agents: run.plan.agents.map((agent) => ({
        ...agent,
        inputRefs: [...agent.inputRefs],
      })),
      rootletKinds: [...run.plan.rootletKinds],
      schedulingReasons: [...run.plan.schedulingReasons],
    },
    invocations: run.invocations.map((invocation) => ({
      ...invocation,
      inputRefs: [...invocation.inputRefs],
      outputRefs: [...invocation.outputRefs],
    })),
    candidateRefs: [...run.candidateRefs],
    packageRef: run.packageRef === undefined ? undefined : { ...run.packageRef },
  };
}

function cloneGoalIntentProfile(profile: GoalIntentProfile): GoalIntentProfile {
  return {
    ...profile,
    keyConcepts: [...profile.keyConcepts],
    domainConcepts: [...profile.domainConcepts],
    nonGoals: [...profile.nonGoals],
    acceptanceCriteria: [...profile.acceptanceCriteria],
    assumptions: [...profile.assumptions],
    riskHints: [...profile.riskHints],
    constraintHints: [...profile.constraintHints],
    unknowns: [...profile.unknowns],
  };
}

function cloneEvidenceLedger(ledger: UndergroundEvidenceLedger): UndergroundEvidenceLedger {
  return {
    ...ledger,
    entries: ledger.entries.map((entry) => ({
      ...entry,
      sourceRefs: [...entry.sourceRefs],
    })),
  };
}
