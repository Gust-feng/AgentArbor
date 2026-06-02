import type { ModelRequest } from "../../domain/intelligence/index.js";
import {
  fakeAssumptionsForGoal,
  fakeConstraintHintsForGoal,
  fakeGoalAnchorFromRequest,
  fakeNonGoalsForGoal,
  fakeRequestContent,
  fakeRiskHintsForGoal,
  fakeUnknownsForGoal,
  includesAny,
  matchLineValue,
  stripTrailingSentencePunctuation,
  termsFromGoalAnchor,
} from "./fake-model-provider-common.js";

export function fakeIntentProfileOutput(request: ModelRequest): Record<string, unknown> {
  const goalAnchor = fakeGoalAnchorFromRequest(request);
  const goalStatement = stripTrailingSentencePunctuation(goalAnchor);
  const goalTerms = termsFromGoalAnchor(goalAnchor);
  const concepts = goalTerms.length > 0 ? goalTerms : ["agentarbor", "direction", "handoff"];
  const unknowns = fakeUnknownsForGoal(goalAnchor);
  return {
    goalStatement,
    keyConcepts: concepts.slice(0, 5),
    domainConcepts: concepts.filter((term) => !["build", "create", "make", "构建", "实现"].includes(term)).slice(0, 5),
    nonGoals: fakeNonGoalsForGoal(goalAnchor),
    acceptanceCriteria: [
      `The ${goalStatement} direction can be reviewed by parent underground agents before handoff.`,
      "Fallback and model refs remain visible without exposing raw prompts.",
    ],
    assumptions: fakeAssumptionsForGoal(goalAnchor),
    riskHints: fakeRiskHintsForGoal(goalAnchor),
    constraintHints: fakeConstraintHintsForGoal(goalAnchor),
    unknowns,
    decisionSummary: `Fake Intent Core shaped ${goalStatement} into a reviewable profile candidate.`,
    uncertainty: "The fake profile is suitable for deterministic tests, not for product-quality semantic judgment.",
    confidence: 0.78,
  };
}

export function fakeGrowthGovernorOutput(request: ModelRequest): Record<string, unknown> {
  const content = fakeRequestContent(request);
  const availableKinds = parseAvailableRootletKinds(content);
  const rootletKinds = availableKinds.length > 0 ? availableKinds : ["option"];
  const maxCandidateOutputs = rootletKinds.reduce((total, kind) => total + fakeMaxOutputsForKind(kind), 0);
  return {
    rootletKinds,
    budget: {
      maxRootletClusters: rootletKinds.length,
      maxCandidateOutputs,
    },
    dispatchDecision:
      `Start ${rootletKinds.join(", ")} rootlet clusters as lower-layer material; parent agents still own convergence and handoff.`,
    decisionSummary:
      `Fake Growth Governor selected ${rootletKinds.length} rootlet cluster(s) for controlled underground dispatch.`,
    uncertainty: "The fake dispatch is deterministic and must remain bounded by budget, schema, and hard guards.",
    confidence: 0.74,
  };
}

export function fakeConvergenceJudgmentOutput(request: ModelRequest): Record<string, unknown> {
  const content = fakeRequestContent(request);
  const candidates = parseConvergenceCandidates(content);
  const rawGoal = stripTrailingSentencePunctuation(fakeGoalAnchorFromRequest(request));
  const stopRequested = includesAny(rawGoal.toLowerCase(), ["stop", "stopped", "no viable", "no candidate", "停止", "终止", "无候选"]);
  const clarificationRequested = includesAny(rawGoal.toLowerCase(), [
    "permission",
    "hard constraint",
    "unknown",
    "unclear",
    "待确认",
    "确认",
    "权限",
    "硬约束",
    "未知",
  ]);
  const firstOption = candidates.find((candidate) => candidate.kind === "option");
  const hasClarificationCandidate = clarificationRequested && candidates.some((candidate) => candidate.kind === "constraint");
  const candidateDecisions = candidates.map((candidate) => {
    const status = fakeConvergenceStatusForCandidate({
      candidate,
      firstOptionId: firstOption?.candidateId,
      stopRequested,
      clarificationRequested: hasClarificationCandidate,
    });
    return {
      candidateId: candidate.candidateId,
      status,
      reason: fakeConvergenceReasonForStatus(candidate, status, rawGoal),
      evidenceRefs: [candidate.outputId].filter((ref) => ref !== "unknown"),
      contentDifference: `Fake Convergence Judge differentiated ${candidate.kind} candidate ${candidate.candidateId}.`,
      whyPreferred:
        status === "accepted"
          ? `Fake Convergence Judge selected ${candidate.candidateId} as the retained option.`
          : `Fake Convergence Judge kept ${candidate.candidateId} as ${status} material.`,
      conflictWith: [],
      ...(status === "unknown"
        ? {
            openQuestion: `Confirm boundary before promoting ${candidate.candidateId}.`,
            clarificationReason: "permission_boundary_unclear",
            blockingLevel: hasClarificationCandidate ? "blocking" : "non_blocking",
          }
        : {}),
    };
  });
  const nextAction = stopRequested
    ? "stop"
    : hasClarificationCandidate
      ? "request_user_clarification"
      : candidateDecisions.some((decision) => decision.status === "accepted" || decision.status === "merged")
        ? "approve_handoff"
        : "stop";
  return {
    candidateDecisions,
    recommendedOptionId: nextAction === "approve_handoff" ? firstOption?.candidateId : undefined,
    nextAction,
    conflictsNeedingUserInput: hasClarificationCandidate ? ["Permission or hard constraint boundary needs user confirmation."] : [],
    constraintViolations: [],
    overallDirectionSummary:
      nextAction === "approve_handoff"
        ? `Fake Convergence Judge approved handoff-ready candidates for ${rawGoal}.`
        : nextAction === "request_user_clarification"
          ? `Fake Convergence Judge requires user clarification before approving ${rawGoal}.`
          : `Fake Convergence Judge stopped convergence for ${rawGoal}.`,
    decisionSummary: `Fake Convergence Judge made ${candidateDecisions.length} candidate decision(s) as the AI mainline.`,
    uncertainty: "This fake judgment is deterministic fixture output, not product-quality semantic reasoning.",
    confidence: nextAction === "approve_handoff" ? 0.76 : 0.42,
  };
}

export function fakeHandoffNarrativeOutput(request: ModelRequest): Record<string, unknown> {
  const content = fakeRequestContent(request);
  const rawGoal = stripTrailingSentencePunctuation(fakeGoalAnchorFromRequest(request));
  const candidateIds = parseHandoffCandidateIds(content);
  const convergenceOutcome = matchLineValue(content, "Convergence outcome:") ?? "approved";
  const status =
    convergenceOutcome === "approved" && candidateIds.length > 0
      ? "approved"
      : convergenceOutcome === "awaiting_user"
        ? "awaiting_user"
        : "stopped";
  return {
    status,
    clarifiedGoal:
      status === "approved"
        ? `Package ${rawGoal} as an evidence-led direction for Aboveground handoff.`
        : `Do not approve ${rawGoal} until Handoff Steward receives valid narrative material.`,
    optionNarratives:
      status === "approved"
        ? candidateIds.map((candidateId, index) => ({
            candidateId,
            directionSummary:
              `For ${rawGoal}: promote candidate ${candidateId} as handoff-ready direction material with retained evidence, constraints, and parent convergence refs.`,
            whyPreferred:
              index === 0
                ? "It is the retained convergence candidate and has source evidence for handoff."
                : "It supports the retained direction as merged context.",
            whyNot: index === 0 ? [] : ["Do not treat this merged context as a separate primary direction."],
            doNotChooseWhen: ["Do not choose when package validation or hard constraints fail."],
            evidenceRefs: [`handoff-narrative:${candidateId}`],
          }))
        : [],
    nonGoals: ["Do not let Aboveground re-run underground exploration as a parallel direction source."],
    assumptions: ["Convergence Judge already accepted or merged the listed handoff candidates."],
    missingInformation: status === "approved" ? [] : ["Approved handoff narrative is unavailable."],
    risks:
      status === "approved"
        ? ["Aboveground must preserve evidence refs and package validation boundaries."]
        : ["Fallback or awaiting-user handoff material cannot start Aboveground planning."],
    evidenceBoundary:
      "Only model-call refs, convergence review refs, source candidate refs, and package validation output may become handoff evidence.",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent", "sub_agent_tree"],
      suggestedFirstWorkflowNodes: [
        "confirm_direction_handoff",
        "derive_execution_plan",
        "preserve_evidence_refs",
      ],
      escalationRules: [
        "Stop if package validation fails.",
        "Request nutrients instead of inventing a new direction when evidence is insufficient.",
      ],
    },
    decisionSummary:
      status === "approved"
        ? `Fake Handoff Steward organized ${candidateIds.length} candidate narrative(s) for approved package creation.`
        : "Fake Handoff Steward did not approve package creation.",
    uncertainty: "This fake handoff narrative is deterministic fixture output with no private reasoning trace.",
    confidence: status === "approved" ? 0.78 : 0.22,
  };
}

export function fakeRootletKindFromContractId(contractId: string): string {
  const marker = "underground.rootlet_candidate_advice.";
  if (!contractId.startsWith(marker)) {
    return "option";
  }
  return contractId.slice(marker.length).split(".")[0] ?? "option";
}

export function fakeCandidateForKind(kind: string, index: number, goalAnchor: string): Record<string, unknown> {
  const goalTerms = goalAnchor
    .split(/[\s.;,，；、/]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  const decomposedGoalTerms = [...goalTerms, ...[...goalTerms].reverse()].join(" ");
  const summary = `Fake ${kind} candidate advice ${index} with goal-specific ${decomposedGoalTerms || "current goal"} material.`;
  switch (kind) {
    case "risk":
      return {
        summary,
        impactScope: `${goalAnchor} runtime boundary and user trust`,
        severity: index === 1 ? "medium" : "low",
        mitigation: "Keep Convergence Judge and package validation in charge.",
      };
    case "asset_fit":
      return {
        summary,
        assetRefs: ["soil:minimal-constraints"],
        fitConditions: [`Only use refs that match ${goalAnchor}.`],
        doNotApplyWhen: ["The asset would copy Soil body content into the prompt."],
      };
    case "evidence":
      return {
        summary,
        evidenceType: `${goalAnchor} verification`,
        confidence: index === 1 ? "medium" : "low",
      };
    case "constraint":
      return {
        summary,
        constraintLevel: "hard",
        enforcementGate: "direction_handoff",
      };
    case "counterfactual":
      return {
        summary,
        alternativeDirection: `Defer ${goalAnchor} execution until evidence and constraints are clearer.`,
        whyNotChosen: "It does not satisfy the current underground direction boundary.",
      };
    case "option":
    default:
      return {
        summary,
        tradeoffs: ["more candidate diversity", `goal-specific ${goalAnchor}`, "requires convergence validation"],
        applicability: `Use when the ${goalAnchor} goal profile needs another direction candidate.`,
      };
  }
}

function parseHandoffCandidateIds(content: string): string[] {
  return [...content.matchAll(/candidateId=([^\s\n]+)/g)]
    .map((match) => match[1])
    .filter((candidateId): candidateId is string => candidateId !== undefined && candidateId.length > 0);
}

type FakeConvergenceCandidate = {
  readonly kind: string;
  readonly candidateId: string;
  readonly outputId: string;
};

function parseConvergenceCandidates(content: string): FakeConvergenceCandidate[] {
  const matches = [...content.matchAll(/- \[(option|risk|asset_fit|evidence|constraint|counterfactual)\]\s+candidateId=([^\s]+)\s+outputId=([^\s\n]+)/g)];
  return matches.map((match) => ({
    kind: match[1] ?? "option",
    candidateId: match[2] ?? "candidate-unknown",
    outputId: match[3] ?? "unknown",
  }));
}

function fakeConvergenceStatusForCandidate(input: {
  readonly candidate: FakeConvergenceCandidate;
  readonly firstOptionId?: string;
  readonly stopRequested: boolean;
  readonly clarificationRequested: boolean;
}): "accepted" | "merged" | "rejected" | "unknown" {
  if (input.stopRequested) {
    return "rejected";
  }
  if (input.clarificationRequested && input.candidate.kind === "constraint") {
    return "unknown";
  }
  if (input.candidate.kind === "option") {
    return input.candidate.candidateId === input.firstOptionId ? "accepted" : "merged";
  }
  if (input.candidate.kind === "risk" || input.candidate.kind === "counterfactual") {
    return "rejected";
  }
  return "merged";
}

function fakeConvergenceReasonForStatus(
  candidate: FakeConvergenceCandidate,
  status: "accepted" | "merged" | "rejected" | "unknown",
  rawGoal: string
): string {
  switch (status) {
    case "accepted":
      return `Candidate ${candidate.candidateId} is the retained ${candidate.kind} direction for ${rawGoal}.`;
    case "merged":
      return `Candidate ${candidate.candidateId} supports the retained direction as ${candidate.kind} material.`;
    case "unknown":
      return `Candidate ${candidate.candidateId} exposes a boundary that must be clarified before approval.`;
    case "rejected":
      return `Candidate ${candidate.candidateId} is retained as why-not evidence, not a handoff direction.`;
  }
}

function parseAvailableRootletKinds(content: string): string[] {
  const line = matchLineValue(content, "Available rootlet kinds:");
  if (line === undefined) {
    return [];
  }
  const validKinds = new Set(["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"]);
  return [...new Set(
    line
      .split(/[,，;；\s]+/u)
      .map((kind) => kind.trim())
      .filter((kind) => validKinds.has(kind))
  )];
}

function fakeMaxOutputsForKind(kind: string): number {
  switch (kind) {
    case "asset_fit":
    case "counterfactual":
      return 2;
    case "option":
    case "risk":
    case "evidence":
    case "constraint":
    default:
      return 3;
  }
}
