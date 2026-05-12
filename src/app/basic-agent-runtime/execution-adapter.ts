import type {
  BasicAgentRunExecutionInput,
  BasicAgentRunExecutionResult,
} from "./run-executor.js";

export interface BasicAgentExecutionAdapter {
  execute(input: BasicAgentRunExecutionInput): Promise<BasicAgentRunExecutionResult>;
}
