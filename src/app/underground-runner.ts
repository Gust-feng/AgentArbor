import type {
  CandidatePool,
  UndergroundAgentClusterRun,
  UndergroundConvergenceReport,
  UndergroundExplorationReport,
} from "../domain/underground/index.js";
import {
  runUndergroundAgentClusterExploration,
  type RunUndergroundAgentClusterExplorationInput,
} from "./underground-agent-cluster-runtime.js";

export type RunUndergroundExplorationInput = RunUndergroundAgentClusterExplorationInput;

export type RunUndergroundExplorationResult = {
  readonly candidatePool: CandidatePool;
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly undergroundReport: UndergroundExplorationReport;
  readonly agentClusterRun: UndergroundAgentClusterRun;
};

export function runUndergroundExploration(
  input: RunUndergroundExplorationInput
): RunUndergroundExplorationResult {
  return runUndergroundAgentClusterExploration(input);
}
