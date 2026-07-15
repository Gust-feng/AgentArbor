import assert from "node:assert/strict";
import test from "node:test";
import { OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION, type ModelMessage } from "../../domain/intelligence/index.js";
import {
  canonicalMessagesFromOpenAIAgentsInput,
  createOpenAIAgentsInputMapper,
} from "./openai-agents-input.js";

const SYSTEM = "Preserve the exact model history.";

test("Chat SDK input round-trips attachments, tool facts, and allowlisted provider continuation", () => {
  const messages: readonly ModelMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: "inspect these inputs",
      attachments: [
        { kind: "image", source: { kind: "url", url: "https://example.test/image.png" }, detail: "high" },
        { kind: "audio", source: { kind: "data", mimeType: "audio/mpeg", data: "YXVkaW8=" }, filename: "note.mp3" },
      ],
    },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ callId: "call-chat-round-trip", toolName: "read_file", input: { path: "README.md" } }],
      protocolExtensions: { reasoning_content: "provider continuation" },
    },
    {
      role: "tool",
      content: JSON.stringify({ status: "completed", output: "README" }),
      toolCallId: "call-chat-round-trip",
      toolName: "read_file",
    },
  ];

  const items = createOpenAIAgentsInputMapper({
    protocol: "openai_compatible_chat_completions",
    messages,
  }).messages(SYSTEM);
  const roundTripped = canonicalMessagesFromOpenAIAgentsInput({
    protocol: "openai_compatible_chat_completions",
    instructions: SYSTEM,
    items,
  });

  assert.deepEqual(roundTripped.map((message) => message.role), ["system", "user", "assistant", "tool"]);
  assert.deepEqual(roundTripped[1]?.attachments?.map((attachment) => attachment.kind), ["image", "audio"]);
  assert.deepEqual(roundTripped[2]?.toolCalls, messages[2]?.toolCalls);
  assert.deepEqual(roundTripped[2]?.protocolExtensions, { reasoning_content: "provider continuation" });
  assert.equal(roundTripped[3]?.toolCallId, "call-chat-round-trip");
});

test("Responses SDK input round-trips persisted reasoning and function-call continuation items", () => {
  const outputItems = [
    {
      id: "reasoning-1",
      type: "reasoning",
      encrypted_content: "encrypted",
      summary: [],
    },
    {
      id: "call-item-1",
      type: "function_call",
      status: "completed",
      call_id: "call-responses-round-trip",
      name: "read_file",
      arguments: JSON.stringify({ path: "README.md" }),
    },
  ] as const;
  const messages: readonly ModelMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "continue the Responses run" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ callId: "call-responses-round-trip", toolName: "read_file", input: { path: "README.md" } }],
      protocolExtensions: { [OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION]: outputItems },
    },
    {
      role: "tool",
      content: JSON.stringify({ status: "completed", output: "README" }),
      toolCallId: "call-responses-round-trip",
      toolName: "read_file",
    },
  ];

  const items = createOpenAIAgentsInputMapper({ protocol: "openai_responses", messages }).messages(SYSTEM);
  const roundTripped = canonicalMessagesFromOpenAIAgentsInput({
    protocol: "openai_responses",
    instructions: SYSTEM,
    items,
  });

  assert.deepEqual(roundTripped[2]?.toolCalls, messages[2]?.toolCalls);
  assert.deepEqual(
    roundTripped[2]?.protocolExtensions?.[OPENAI_RESPONSES_OUTPUT_ITEMS_EXTENSION],
    outputItems,
  );
  assert.equal(roundTripped[3]?.toolCallId, "call-responses-round-trip");
});
