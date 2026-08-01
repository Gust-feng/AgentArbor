import path from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  FileSystemAgentSessionRepository,
  type AgentSessionLease,
} from "../../adapters/intelligence/file-system-agent-session-repository.js";
import { toolCallFactId, type ToolCallResult } from "../../domain/tools/index.js";
import type { AgentSessionExecutionRefs } from "../model-runtime/agent-session.js";
import type { OrdinaryExecutionPort } from "../ordinary-agent/contracts.js";

type ExecutionInput = Parameters<OrdinaryExecutionPort["execute"]>[0];

export type AgentSessionExecutionTestDriver = {
  prepareInput(input: ExecutionInput): Promise<AgentSessionExecutionRefs>;
  prepareToolRound(
    input: ExecutionInput,
    results: readonly ToolCallResult[],
  ): Promise<AgentSessionExecutionRefs>;
  commitToolResults(
    input: ExecutionInput,
    session: AgentSessionExecutionRefs,
    results: readonly ToolCallResult[],
  ): Promise<AgentSessionExecutionRefs>;
  complete(
    input: ExecutionInput,
    answer: string,
    session?: AgentSessionExecutionRefs,
  ): Promise<AgentSessionExecutionRefs>;
};

export function createAgentSessionExecutionTestDriver(
  configDirectory: string,
): AgentSessionExecutionTestDriver {
  const sessionsRoot = path.join(configDirectory, "runtime", "ordinary-agent", "agent-sessions");

  const prepareInput = async (input: ExecutionInput): Promise<AgentSessionExecutionRefs> =>
    withSessionLease(configDirectory, sessionsRoot, input, async (lease) => {
      const startLeafRef = entryRef(input, await lease.session.getLeafId());
      await input.onSessionWriteCheckpoint?.({
        kind: "start_leaf_captured",
        sessionId: input.sessionRef.sessionId,
        startLeafRef,
      });
      const inputEntryRef = entryRef(input, await lease.session.appendMessage({
        role: "user",
        content: input.runInput.userMessage,
        timestamp: Date.now(),
      }))!;
      await input.onSessionWriteCheckpoint?.({
        kind: "input_entry_committed",
        sessionId: input.sessionRef.sessionId,
        inputEntryRef,
      });
      return {
        sessionId: input.sessionRef.sessionId,
        startLeafRef,
        inputEntryRef,
        safeLeafRef: inputEntryRef,
        latestLeafRef: inputEntryRef,
        compactionEntryRefs: [],
      };
    });

  return {
    prepareInput,
    async prepareToolRound(input, results) {
      const prepared = await prepareInput(input);
      return withSessionLease(configDirectory, sessionsRoot, input, async (lease) => {
        const assistantEntryRef = entryRef(input, await lease.session.appendMessage(fauxAssistantMessage(
          results.map((result) => fauxToolCall(
            result.toolName,
            toolCallArguments(result.input),
            { id: toolCallFactId(result) },
          )),
          { stopReason: "toolUse" },
        )))!;
        await input.onSessionWriteCheckpoint?.({
          kind: "assistant_tool_call_entry_committed",
          sessionId: input.sessionRef.sessionId,
          assistantEntryRef,
          toolCallIds: results.map(toolCallFactId),
        });
        return { ...prepared, latestLeafRef: assistantEntryRef };
      });
    },
    async commitToolResults(input, session, results) {
      return withSessionLease(configDirectory, sessionsRoot, input, async (lease) => {
        let toolRoundLeafRef = session.latestLeafRef;
        for (const result of results) {
          toolRoundLeafRef = entryRef(input, await lease.session.appendMessage({
            role: "toolResult",
            toolCallId: toolCallFactId(result),
            toolName: result.toolName,
            content: [{
              type: "text",
              text: JSON.stringify({ status: result.status, output: result.output }),
            }],
            isError: result.status !== "completed",
            timestamp: Date.now(),
          }));
        }
        if (toolRoundLeafRef === null) throw new Error("Tool-result fixture did not produce a Session leaf.");
        await input.onSessionWriteCheckpoint?.({
          kind: "tool_result_entries_committed",
          sessionId: input.sessionRef.sessionId,
          toolRoundLeafRef,
          toolCallIds: results.map(toolCallFactId),
        });
        return { ...session, safeLeafRef: toolRoundLeafRef, latestLeafRef: toolRoundLeafRef };
      });
    },
    async complete(input, answer, session) {
      const prepared = session ?? await prepareInput(input);
      return withSessionLease(configDirectory, sessionsRoot, input, async (lease) => {
        const assistantEntryRef = entryRef(
          input,
          await lease.session.appendMessage(fauxAssistantMessage(answer)),
        )!;
        await input.onSessionWriteCheckpoint?.({
          kind: "assistant_response_entry_committed",
          sessionId: input.sessionRef.sessionId,
          assistantEntryRef,
        });
        return { ...prepared, latestLeafRef: assistantEntryRef };
      });
    },
  };
}

async function withSessionLease<T>(
  configDirectory: string,
  sessionsRoot: string,
  input: ExecutionInput,
  operation: (lease: AgentSessionLease) => Promise<T>,
): Promise<T> {
  const environment = new NodeExecutionEnv({ cwd: configDirectory });
  const repository = new FileSystemAgentSessionRepository({ fileSystem: environment, sessionsRoot });
  try {
    const lease = await repository.acquire(input.sessionRef);
    try {
      return await operation(lease);
    } finally {
      await lease.release();
    }
  } finally {
    await environment.cleanup();
  }
}

function entryRef(input: ExecutionInput, entryId: string | null) {
  return entryId === null ? null : { sessionId: input.sessionRef.sessionId, entryId } as const;
}

function toolCallArguments(input: ToolCallResult["input"]): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : { value: input ?? null };
}
