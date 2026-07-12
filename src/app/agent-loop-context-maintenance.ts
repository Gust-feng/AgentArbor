/** @deprecated Import the neutral context-maintenance module directly. */
export {
  compactAgentLoopContextIfNeeded,
  createOpenAITokenCounter,
} from "./context-maintenance/index.js";
export type {
  AgentLoopContextMaintenanceResult,
  AgentLoopTokenCounter,
  MaintainAgentLoopContextInput,
} from "./context-maintenance/index.js";
