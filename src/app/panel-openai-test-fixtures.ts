import type { PanelProviderFetch } from "./panel-server.js";

export type ResponsesRequestBody = {
  readonly instructions?: string;
  readonly input?: readonly unknown[];
  readonly messages?: readonly { readonly role?: string; readonly content?: string }[];
  readonly tools?: readonly unknown[];
  readonly max_output_tokens?: number;
  readonly max_completion_tokens?: number;
  readonly max_tokens?: number;
  readonly stream?: boolean;
};

export type CapturedModelMessage = {
  readonly role: string;
  readonly content: string;
};

export function parseResponsesRequestBody(raw: string): ResponsesRequestBody {
  return JSON.parse(raw) as ResponsesRequestBody;
}

export function extractResponsesMessages(body: ResponsesRequestBody | undefined): readonly CapturedModelMessage[] {
  if (body === undefined) {
    return [];
  }
  const messages: CapturedModelMessage[] = [];
  if (typeof body.instructions === "string" && body.instructions.length > 0) {
    messages.push({ role: "system", content: body.instructions });
  }
  for (const message of body.messages ?? []) {
    messages.push({
      role: typeof message.role === "string" ? message.role : "user",
      content: typeof message.content === "string" ? message.content : "",
    });
  }
  for (const item of body.input ?? []) {
    const record = asTestRecord(item);
    if (record.type === "message") {
      messages.push({
        role: typeof record.role === "string" ? record.role : "user",
        content: responsesMessageContent(record.content),
      });
      continue;
    }
    if (record.type === "function_call") {
      messages.push({
        role: "assistant",
        content: `${String(record.name ?? "")} ${String(record.arguments ?? "")}`.trim(),
      });
      continue;
    }
    if (record.type === "function_call_output") {
      messages.push({
        role: "tool",
        content: typeof record.output === "string" ? record.output : JSON.stringify(record.output ?? ""),
      });
    }
  }
  return messages;
}

export function responsesRequestText(body: ResponsesRequestBody | undefined): string {
  return extractResponsesMessages(body).map((message) => message.content).join("\n");
}

export function hasResponsesToolOutput(body: ResponsesRequestBody): boolean {
  return (
    (body.messages ?? []).some((message) => message.role === "tool") ||
    (body.input ?? []).some((item) => asTestRecord(item).type === "function_call_output")
  );
}

export function hasResponsesToolDefinition(body: ResponsesRequestBody, name: string): boolean {
  return (body.tools ?? []).some((tool) => {
    const record = asTestRecord(tool);
    return record.name === name || asTestRecord(record.function).name === name;
  });
}

export function createStubOpenAiResponse(
  model: string,
  candidateOverrides: Record<string, unknown> = {}
): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiJsonResponse(model, {
    candidates: [
      {
        summary: "Stub candidate advice.",
        tradeoffs: ["observable run state", "package validation remains in charge"],
        applicability: "Use for panel polling tests.",
        impactScope: "Panel test runtime only.",
        severity: "low",
        mitigation: "Keep provider output as candidate advice only.",
        assetRefs: ["panel:test"],
        fitConditions: ["When validating model-visible output."],
        doNotApplyWhen: ["Do not use outside deterministic tests."],
        evidenceType: "test",
        confidence: "medium",
        constraintLevel: "soft",
        enforcementGate: "direction_handoff",
        alternativeDirection: "Use a reduced fake AI pass.",
        whyNotChosen: "This test needs model.requested visibility.",
        ...candidateOverrides,
      },
    ],
  });
}

export function createStubOpenAiAggregationResponse(model: string): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiJsonResponse(model, {
    aggregationRationale: "Stub aggregation: merged rootlet outputs into unified candidate pool.",
    deduplicationNotes: ["No duplicates detected."],
    implicitRelations: [],
    decisionSummary: "Aggregated candidates from rootlet agents.",
    uncertainty: "None for stub.",
    confidence: 0.9,
  });
}

export function createOpenAiSearchToolCallResponse(): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiToolCallResponse("configured-tools-model", "call-panel-search", "search", {
    query: "AgentArbor configured panel search",
    sources: ["web"],
  });
}

export function createOpenAiReadFileToolCallResponse(
  filePath = "README.md",
  callId = "call-panel-read-file"
): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiToolCallResponse("desktop-tool-detail-model", callId, "read_file", { path: filePath });
}

export function createOpenAiDeleteFileToolCallResponse(filePath: string): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiToolCallResponse("basic-confirmation-model", "call-panel-write-file", "delete_file", { path: filePath });
}

export function createOpenAiRunCommandToolCallResponse(command: string): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiToolCallResponse("basic-command-confirmation-model", "call-panel-run-command", "shell_command", { commandLine: command });
}

export function createOpenAiToolCallResponse(
  model: string,
  callId: string,
  name: string,
  input: Record<string, unknown>
): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiFixtureResponse({
    id: "resp-test-tool-call",
    model,
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: callId,
        name,
        arguments: JSON.stringify(input),
      },
    ],
  });
}

export function createOpenAiJsonResponse(model: string, output: unknown): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiTextResponse(model, JSON.stringify(output));
}

export function createOpenAiTextResponse(model: string, text: string): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiFixtureResponse({
    id: "resp-test-text",
    model,
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 12,
      total_tokens: 22,
    },
  });
}

export function createOpenAiStreamTextResponse(
  model: string,
  chunks: readonly string[]
): Awaited<ReturnType<PanelProviderFetch>> {
  const responseId = "resp-test-stream";
  return {
    ok: true,
    status: 200,
    body: sseChunks([
      {
        type: "response.created",
        response: { id: responseId, model, status: "in_progress" },
      },
      ...chunks.map((chunk) => ({
        type: "response.output_text.delta",
        delta: chunk,
      })),
      {
        type: "response.completed",
        response: { id: responseId, model, status: "completed" },
      },
      ...chunks.map((chunk, index) => ({
        id: `chatcmpl-test-stream-${index}`,
        object: "chat.completion.chunk",
        created: 1_776_000_000,
        model,
        choices: [
          {
            index: 0,
            delta: { content: chunk },
            finish_reason: index === chunks.length - 1 ? "stop" : null,
          },
        ],
      })),
    ]),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  };
}

export function createOpenAiChatStreamTextResponse(
  model: string,
  chunks: readonly string[]
): Awaited<ReturnType<PanelProviderFetch>> {
  return {
    ok: true,
    status: 200,
    body: sseChunks(chunks.map((chunk, index) => ({
      id: `chatcmpl-test-stream-${index}`,
      object: "chat.completion.chunk",
      created: 1_776_000_000,
      model,
      choices: [
        {
          index: 0,
          delta: { content: chunk },
          finish_reason: index === chunks.length - 1 ? "stop" : null,
        },
      ],
    }))),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  };
}

export function createOpenAiStreamReasoningTextResponse(
  model: string,
  chunks: readonly { readonly kind: "reasoning" | "output"; readonly delta: string }[]
): Awaited<ReturnType<PanelProviderFetch>> {
  const responseId = "resp-test-reasoning-stream";
  return {
    ok: true,
    status: 200,
    body: sseChunks([
      {
        type: "response.created",
        response: { id: responseId, model, status: "in_progress" },
      },
      ...chunks.map((chunk) => ({
        type: chunk.kind === "reasoning" ? "response.reasoning_summary_text.delta" : "response.output_text.delta",
        delta: chunk.delta,
      })),
      {
        type: "response.completed",
        response: { id: responseId, model, status: "completed" },
      },
      ...chunks.map((chunk, index) => ({
        id: `chatcmpl-test-reasoning-stream-${index}`,
        object: "chat.completion.chunk",
        created: 1_776_000_000,
        model,
        choices: [
          {
            index: 0,
            delta: chunk.kind === "reasoning" ? { reasoning_content: chunk.delta } : { content: chunk.delta },
            finish_reason: index === chunks.length - 1 ? "stop" : null,
          },
        ],
      })),
    ]),
    json: async () => {
      throw new Error("Streaming response should not be read through json().");
    },
  };
}

export function createInvalidOpenAiResponse(model: string): Awaited<ReturnType<PanelProviderFetch>> {
  return createOpenAiJsonResponse(model, {
    rationale: "bad raw output with provider raw response marker",
    hidden_reasoning: "must not leave provider normalization with Bearer leaked-token, system prompt, and sk-raw-secret",
  });
}

function createOpenAiFixtureResponse(payload: Record<string, unknown>): Awaited<ReturnType<PanelProviderFetch>> {
  const compatPayload = withChatCompletionsCompatibility(payload);
  return {
    ok: true,
    status: 200,
    body: sseChunks([...openAiResponsesChunks(payload), ...openAiChatCompletionChunksFromResponses(payload)]),
    json: async () => compatPayload,
  };
}

function responsesMessageContent(value: unknown): string {
  if (!Array.isArray(value)) {
    return typeof value === "string" ? value : "";
  }
  return value
    .map((part) => {
      const record = asTestRecord(part);
      return typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function openAiResponsesChunks(payload: Record<string, unknown>): readonly unknown[] {
  const responseId = typeof payload.id === "string" ? payload.id : "resp-test";
  const model = typeof payload.model === "string" ? payload.model : "test-model";
  const chunks: unknown[] = [
    {
      type: "response.created",
      response: { id: responseId, model, status: "in_progress" },
    },
  ];
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const [outputIndex, item] of output.entries()) {
    const record = asTestRecord(item);
    if (record.type === "message") {
      for (const part of Array.isArray(record.content) ? record.content : []) {
        const partRecord = asTestRecord(part);
        if (partRecord.type === "output_text" && typeof partRecord.text === "string" && partRecord.text.length > 0) {
          chunks.push({
            type: "response.output_text.delta",
            output_index: outputIndex,
            delta: partRecord.text,
          });
        }
      }
      continue;
    }
    if (record.type === "function_call") {
      const callId = typeof record.call_id === "string" ? record.call_id : `call-test-${outputIndex}`;
      const name = typeof record.name === "string" ? record.name : "test_tool";
      const args = typeof record.arguments === "string" ? record.arguments : "";
      chunks.push({
        type: "response.output_item.added",
        output_index: outputIndex,
        item: { type: "function_call", call_id: callId, name, arguments: "" },
      });
      if (args.length > 0) {
        chunks.push({
          type: "response.function_call_arguments.delta",
          output_index: outputIndex,
          delta: args,
        });
      }
      chunks.push({
        type: "response.output_item.done",
        output_index: outputIndex,
        item: { type: "function_call", call_id: callId, name, arguments: args },
      });
    }
  }
  chunks.push({
    type: "response.completed",
    response: { id: responseId, model, status: payload.status ?? "completed" },
  });
  return chunks;
}

function withChatCompletionsCompatibility(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    object: "chat.completion",
    choices: openAiChatCompletionChoicesFromResponses(payload),
    usage: {
      prompt_tokens: numberOrZero(asTestRecord(payload.usage).input_tokens),
      completion_tokens: numberOrZero(asTestRecord(payload.usage).output_tokens),
      total_tokens: numberOrZero(asTestRecord(payload.usage).total_tokens),
    },
  };
}

function openAiChatCompletionChoicesFromResponses(payload: Record<string, unknown>): readonly unknown[] {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const text = output
    .flatMap((item) => {
      const record = asTestRecord(item);
      if (record.type !== "message") {
        return [];
      }
      return (Array.isArray(record.content) ? record.content : [])
        .map((part) => {
          const partRecord = asTestRecord(part);
          return partRecord.type === "output_text" && typeof partRecord.text === "string" ? partRecord.text : "";
        })
        .filter(Boolean);
    })
    .join("");
  const toolCalls = output.flatMap((item) => {
    const record = asTestRecord(item);
    if (record.type !== "function_call") {
      return [];
    }
    return [
      {
        id: record.call_id,
        type: "function",
        function: {
          name: record.name,
          arguments: record.arguments ?? "",
        },
      },
    ];
  });
  return [
    {
      finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      message: {
        role: "assistant",
        content: text,
        tool_calls: toolCalls.length === 0 ? undefined : toolCalls,
      },
    },
  ];
}

function openAiChatCompletionChunksFromResponses(payload: Record<string, unknown>): readonly unknown[] {
  const model = typeof payload.model === "string" ? payload.model : "test-model";
  return openAiChatCompletionChoicesFromResponses(payload).map((choice, index) => {
    const choiceRecord = asTestRecord(choice);
    const message = asTestRecord(choiceRecord.message);
    const delta: Record<string, unknown> = { role: "assistant" };
    if (typeof message.content === "string" && message.content.length > 0) {
      delta.content = message.content;
    }
    if (Array.isArray(message.tool_calls)) {
      delta.tool_calls = message.tool_calls.map((toolCall, toolCallIndex) => {
        const record = asTestRecord(toolCall);
        const fn = asTestRecord(record.function);
        return {
          index: toolCallIndex,
          id: record.id,
          type: record.type ?? "function",
          function: {
            name: fn.name,
            arguments: fn.arguments ?? "",
          },
        };
      });
    }
    return {
      id: typeof payload.id === "string" ? payload.id : `chatcmpl-test-${index}`,
      object: "chat.completion.chunk",
      created: 1_776_000_000,
      model,
      choices: [
        {
          index,
          delta,
          finish_reason: choiceRecord.finish_reason ?? null,
        },
      ],
    };
  });
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asTestRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function* sseChunks(chunks: readonly unknown[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield `data: ${JSON.stringify(chunk)}\n\n`;
  }
  yield "data: [DONE]\n\n";
}
