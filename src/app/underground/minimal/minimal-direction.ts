/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ① fake 骨架（确定性假实现）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import { createApprovedDirectionHandoff } from "../../../domain/agentarbor/direction-handoff.js";
import { createDirectionHandoffPackage } from "../../../domain/agentarbor/direction-handoff-package.js";
import type { DirectionHandoffPackage } from "../../../domain/agentarbor/direction-handoff-package/contracts.js";
import type { Constraint } from "../../../domain/constraints.js";
import type {
  CandidatePool,
  ConvergenceReview,
  DirectionHandoff,
  ExplorationCandidateRef,
  GoalIntentProfile,
  UndergroundConvergenceReport,
  UserClarificationRequest,
} from "../../../domain/underground/index.js";
import { selectHandoffSourceCandidates } from "../../../domain/underground/index.js";
import { deriveDirectionHandoffDraft } from "../compat/direction-handoff-derivation.js";

export type MinimalDirectionMaterial = {
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
};

export type AwaitingUserDirectionMaterial = MinimalDirectionMaterial & {
  clarificationRequest: UserClarificationRequest;
};

export type StoppedDirectionMaterial = MinimalDirectionMaterial;

export function createMinimalDirectionMaterial(input: {
  goalId: string;
  goal: string;
  producedByAgentId: string;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): MinimalDirectionMaterial {
  const sourceCandidates = selectHandoffSourceCandidates(input.candidatePool, input.convergenceReport);
  const convergenceReview: ConvergenceReview = input.convergenceReport;
  const directionHandoff = createMinimalDirectionHandoff({
    goalId: input.goalId,
    goal: input.goal,
    sourceCandidates,
    convergenceReview,
    constraints: input.constraints,
    goalIntentProfile: input.goalIntentProfile,
  });
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { sourceCandidates, convergenceReview, directionHandoff, directionHandoffPackage };
}

export function createAwaitingUserDirectionMaterial(input: {
  goalId: string;
  goal: string;
  producedByAgentId: string;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): AwaitingUserDirectionMaterial {
  const clarificationRequest = input.convergenceReport.userClarificationRequest;
  if (clarificationRequest === undefined) {
    throw new Error("Awaiting-user DirectionHandoff requires a UserClarificationRequest.");
  }

  const sourceCandidates = selectHandoffSourceCandidates(input.candidatePool, input.convergenceReport);
  const convergenceReview: ConvergenceReview = input.convergenceReport;
  const directionHandoff = createAwaitingUserDirectionHandoff({
    goalId: input.goalId,
    goal: input.goal,
    sourceCandidates,
    convergenceReview,
    constraints: input.constraints,
    goalIntentProfile: input.goalIntentProfile,
    clarificationRequest,
  });
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { sourceCandidates, convergenceReview, directionHandoff, directionHandoffPackage, clarificationRequest };
}

export function createStoppedDirectionMaterial(input: {
  goalId: string;
  goal: string;
  producedByAgentId: string;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): StoppedDirectionMaterial {
  const convergenceReview: ConvergenceReview = input.convergenceReport;
  const directionHandoff = {
    ...deriveDirectionHandoffDraft({
      goalId: input.goalId,
      goal: input.goal,
      sourceCandidates: [],
      convergenceReview,
      constraints: input.constraints,
      goalIntentProfile: input.goalIntentProfile,
    }),
    status: "draft" as const,
  };
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { sourceCandidates: [], convergenceReview, directionHandoff, directionHandoffPackage };
}

function createMinimalDirectionHandoff(input: {
  goalId: string;
  goal: string;
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
}): DirectionHandoff {
  return createApprovedDirectionHandoff(deriveDirectionHandoffDraft(input), input.convergenceReview);
}

function createAwaitingUserDirectionHandoff(input: {
  goalId: string;
  goal: string;
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  clarificationRequest: UserClarificationRequest;
}): DirectionHandoff {
  return {
    ...deriveDirectionHandoffDraft(input),
    status: "awaiting_user",
  };
}
