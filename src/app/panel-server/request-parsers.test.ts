import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { PanelHttpError, readJsonBody } from "./http-utils.js";
import {
  parseContextAttachmentPreviewRequest,
  parseConfigUpdate,
  parseDeepChildMessageRequest,
  parseDeepIntakeRequest,
  parseDeepRunControlRequest,
  parseMcpEnvironmentRequest,
  parseMcpServerImport,
  parseRunInput,
  parseToolConfirmationUpdate,
} from "./request-parsers.js";

test("parseRunInput accepts full access tool confirmation policy", () => {
  const parsed = parseRunInput({
    goal: "run commands",
    toolConfirmationPolicy: "full_access",
  });

  assert.equal(parsed.toolConfirmationPolicy, "full_access");
});

test("parseRunInput rejects invalid tool confirmation policy", () => {
  assert.throws(
    () => parseRunInput({
      goal: "run commands",
      toolConfirmationPolicy: "always",
    }),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      assert.equal((error as PanelHttpError).code, "invalid_tool_confirmation_policy");
      return true;
    }
  );
});

test("parseToolConfirmationUpdate accepts full access and rejects invalid policies", () => {
  assert.deepEqual(parseToolConfirmationUpdate({ policy: "full_access" }), { policy: "full_access" });
  assert.throws(
    () => parseToolConfirmationUpdate({ policy: "always" }),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      assert.equal((error as PanelHttpError).code, "invalid_tool_confirmation_policy");
      return true;
    }
  );
});

test("parseConfigUpdate accepts only the supported OpenAI protocol boundary", () => {
  assert.deepEqual(parseConfigUpdate({
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
  }), {
    profileId: undefined,
    label: undefined,
    logoDataUrl: undefined,
    clearLogoDataUrl: undefined,
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
    baseUrl: undefined,
    model: undefined,
    clearModel: undefined,
    defaultAiMode: undefined,
    enabled: undefined,
    apiKey: undefined,
    clearApiKey: undefined,
  });
  assertPanelError(() => parseConfigUpdate({ providerKind: "anthropic" }), "invalid_model_provider_kind");
  assertPanelError(() => parseConfigUpdate({ protocolKind: "anthropic_messages" }), "invalid_model_protocol_kind");
  assertPanelError(() => parseConfigUpdate({ defaultAiMode: "fake" }), "invalid_ai_mode");
});

test("parseRunInput accepts the canonical Panel payload and rejects missing or invalid fields", () => {
  assert.deepEqual(parseRunInput({
    goal: "  inspect the project  ",
    aiMode: "openai-responses",
    reasoningEffort: "high",
    modelOverride: { profileId: "openai", model: "gpt-5" },
    taskSoilInput: {
      contextRefs: [{ ref: "file:notes/context.md", kind: "file" }],
      permissionBoundaryRefs: ["read:file:notes/context.md"],
    },
  }), {
    goal: "inspect the project",
    aiMode: "openai-responses",
    requestedRunMode: undefined,
    reasoningEffort: "high",
    toolConfirmationPolicy: undefined,
    modelOverride: { profileId: "openai", model: "gpt-5" },
    workspaceDirectory: undefined,
    taskSoilInput: {
      contextRefs: [{ ref: "file:notes/context.md", kind: "file", attachmentId: undefined, title: undefined, summary: undefined, metadata: undefined, readonlyPreview: undefined }],
      permissionBoundaryRefs: ["read:file:notes/context.md"],
    },
  });
  assertPanelError(() => parseRunInput({}), "missing_goal");
  assertPanelError(() => parseRunInput({ goal: "run", aiMode: "unsupported" }), "invalid_ai_mode");
  assertPanelError(
    () => parseRunInput({ goal: "run", modelOverride: { profileId: "openai" } }),
    "invalid_model_override",
  );
  assertPanelError(
    () => parseRunInput({ goal: "run", taskSoilInput: { contextRefs: [{ ref: "file:a", kind: "secret" }] } }),
    "empty_context_ref",
  );
});

test("Panel request parsers ignore retired aliases instead of reviving compatibility reads", () => {
  const ordinary = parseRunInput({
    goal: "run",
    openAI: { reasoningEffort: "high" },
    taskSoil: { contextRefs: [{ ref: "file:legacy", kind: "file" }] },
    contextRefs: [{ ref: "file:legacy", kind: "file" }],
  });
  assert.equal(ordinary.reasoningEffort, undefined);
  assert.equal(ordinary.taskSoilInput?.contextRefs, undefined);

  assertPanelError(() => parseDeepChildMessageRequest({ instruction: "legacy" }), "empty_child_instruction");
  assertPanelError(
    () => parseDeepRunControlRequest({ context: ["legacy"] }, "correct"),
    "empty_correction_context",
  );

  assertPanelError(
    () => parseMcpServerImport({ mcp: { servers: { docs: { command: "npx" } } } }),
    "missing_mcp_import_servers",
  );
  assertPanelError(
    () => parseMcpServerImport({ servers: { docs: { command: "npx" } } }),
    "missing_mcp_import_servers",
  );
  assertPanelError(
    () => parseMcpServerImport({ mcpServers: [{ name: "docs", command: "npx" }] }),
    "invalid_mcp_import_servers",
  );
  assert.deepEqual(parseMcpServerImport({
    mcpServers: { docs: { command: "npx", http_headers: { Authorization: "secret://legacy" } } },
  })[0]?.headerSecretRefs, []);
});

test("Deep and context request schemas preserve explicit 400 errors for invalid enum and nested input", () => {
  assert.deepEqual(parseDeepIntakeRequest({ message: "  investigate  ", aiMode: "fake" }), {
    message: "investigate",
    aiMode: "fake",
    taskSoilInput: undefined,
  });
  assertPanelError(() => parseDeepIntakeRequest({ message: "investigate", aiMode: "bad" }), "invalid_ai_mode");
  assertPanelError(
    () => parseDeepRunControlRequest({ correctionContext: ["valid", { nested: true }] }, "correct"),
    "invalid_correction_context",
  );
  assertPanelError(
    () => parseContextAttachmentPreviewRequest({ kind: "archive", value: "x" }),
    "invalid_context_attachment_kind",
  );
});

test("MCP environment requests use the shared schema boundary", () => {
  assert.deepEqual(parseMcpEnvironmentRequest({
    commandLine: "  npx -y @example/mcp  ",
    command: "  npx  ",
    legacyArgs: ["ignored"],
  }), {
    commandLine: "npx -y @example/mcp",
    command: "npx",
  });
  assert.deepEqual(parseMcpEnvironmentRequest({ commandLine: 42, command: false }), {
    commandLine: undefined,
    command: undefined,
  });
  assert.deepEqual(parseMcpEnvironmentRequest(["npx"]), {});
});

test("readJsonBody enforces the existing body limit before schema parsing", async () => {
  const request = Readable.from([JSON.stringify({ goal: "x".repeat(40) })]) as IncomingMessage;
  await assert.rejects(
    readJsonBody(request, { maxChars: 16 }),
    (error) => error instanceof PanelHttpError && error.statusCode === 413 && error.code === "request_body_too_large",
  );
});

function assertPanelError(action: () => unknown, code: string): void {
  assert.throws(action, (error) => error instanceof PanelHttpError && error.statusCode === 400 && error.code === code);
}
