import type {
  BasicAgentRunExecutionInput,
  BasicAgentRunExecutionResult,
} from "../basic-agent-run-executor.js";

export interface BasicAgentExecutionAdapter {
  execute(input: BasicAgentRunExecutionInput): Promise<BasicAgentRunExecutionResult>;
}
