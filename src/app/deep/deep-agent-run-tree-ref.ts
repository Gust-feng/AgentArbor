import type { AgentRunTree } from "../../domain/underground/agent-fabric.js";

export type DeepAgentRunTreeRef = {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly status: AgentRunTree["status"];
  readonly childRunCount: number;
  readonly delegationDecisionCount: number;
  readonly parentSynthesisCount: number;
};

export function deepAgentRunTreeRef(tree: AgentRunTree): DeepAgentRunTreeRef {
  return {
    treeId: tree.treeId,
    rootRunId: tree.rootRunId,
    rootAgentId: tree.rootAgentId,
    status: tree.status,
    childRunCount: tree.childRuns.length,
    delegationDecisionCount: tree.delegationDecisions.length,
    parentSynthesisCount: tree.parentSyntheses.length,
  };
}
