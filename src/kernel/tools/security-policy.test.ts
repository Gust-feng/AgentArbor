import assert from "node:assert/strict";
import test from "node:test";
import type { ToolDefinition, ToolDefinitionMetadata } from "../../domain/tools/index.js";
import {
  confirmationIdForToolCall,
  confirmationRequestFromSecurityDecision,
  evaluateToolCallSecurity,
} from "./security-policy.js";

test("tool security policy only blocks unsupported URL protocols", () => {
  const ftp = evaluateToolCallSecurity({
    request: { callId: "call-ftp", toolName: "browser_snapshot", input: { url: "ftp://example.test/file" } },
    definition: toolDefinition("browser_snapshot", readOnlyMetadata()),
    metadata: readOnlyMetadata(),
    context: { platform: "linux" },
  });
  const token = evaluateToolCallSecurity({
    request: { callId: "call-token", toolName: "browser_snapshot", input: { url: "https://example.test/?access_token=sk-secret" } },
    definition: toolDefinition("browser_snapshot", readOnlyMetadata()),
    metadata: readOnlyMetadata(),
    context: { platform: "linux" },
  });

  assert.equal(ftp.decision, "blocked");
  assert.equal(ftp.decision === "blocked" ? ftp.code : "", "url_protocol_blocked");
  assert.equal(token.decision, "allow");
});

test("tool security policy never lets confirmation bypass hard URL blocks", () => {
  const request = { callId: "call-ftp", toolName: "browser_snapshot", input: { url: "ftp://example.test/file" } };
  const decision = evaluateToolCallSecurity({
    request,
    definition: toolDefinition("browser_snapshot", readOnlyMetadata()),
    metadata: readOnlyMetadata(),
    context: { platform: "linux", approvedConfirmationIds: [confirmationIdForToolCall(request.callId)] },
  });

  assert.equal(decision.decision, "blocked");
  assert.equal(decision.decision === "blocked" ? decision.code : "", "url_protocol_blocked");
});

test("tool security policy allows local and private URL reads without confirmation", () => {
  const request = { callId: "call-local", toolName: "browser_snapshot", input: { url: "http://localhost:3000" } };
  const decision = evaluateToolCallSecurity({
    request,
    definition: toolDefinition("browser_snapshot", readOnlyMetadata()),
    metadata: readOnlyMetadata(),
    context: { platform: "linux", approvedConfirmationIds: [confirmationIdForToolCall(request.callId)] },
  });

  assert.equal(decision.decision, "allow");
});

test("tool security policy allows local, private, and metadata URLs", () => {
  for (const url of [
    "http://localhost:3000",
    "http://127.0.0.1:8787",
    "http://10.0.0.2",
    "http://192.168.1.50",
    "http://172.16.0.10",
    "http://169.254.169.254/latest/meta-data",
  ]) {
    const decision = evaluateToolCallSecurity({
      request: { callId: `call-${url}`, toolName: "browser_snapshot", input: { url } },
      definition: toolDefinition("browser_snapshot", readOnlyMetadata()),
      metadata: readOnlyMetadata(),
      context: { platform: "linux" },
    });

    assert.equal(decision.decision, "allow", url);
  }
});

test("tool security policy allows normal external read-only URLs", () => {
  const decision = evaluateToolCallSecurity({
    request: { callId: "call-web", toolName: "browser_snapshot", input: { url: "https://example.test/page?q=agent" } },
    definition: toolDefinition("browser_snapshot", readOnlyMetadata()),
    metadata: readOnlyMetadata(),
    context: { platform: "linux" },
  });

  assert.equal(decision.decision, "allow");
});

test("tool security policy gates explicit confirmation tools unless exact confirmation is approved", () => {
  const request = { callId: "call-shell", toolName: "shell_command", input: { command: "pnpm test" } };
  const metadata: ToolDefinitionMetadata = {
    ...readOnlyMetadata(),
    category: "terminal",
    operationType: "execute",
    riskLevel: "high",
    requiresConfirmation: true,
  };
  const definition = toolDefinition("shell_command", metadata);
  const pending = evaluateToolCallSecurity({
    request,
    definition,
    metadata,
    context: { platform: "win32" },
  });
  const wrongApproval = evaluateToolCallSecurity({
    request,
    definition,
    metadata,
    context: { platform: "win32", approvedConfirmationIds: ["confirmation-other"] },
  });
  const approved = evaluateToolCallSecurity({
    request,
    definition,
    metadata,
    context: { platform: "win32", approvedConfirmationIds: [confirmationIdForToolCall(request.callId)] },
  });

  assert.equal(pending.decision, "approval_required");
  assert.equal(wrongApproval.decision, "approval_required");
  assert.equal(approved.decision, "allow");
  assert.equal(pending.decision === "approval_required" ? pending.affectedResources[0] : "", "pnpm test");

  const confirmation = confirmationRequestFromSecurityDecision({
    request,
    decision: pending as Extract<typeof pending, { readonly decision: "approval_required" }>,
  });
  assert.equal(confirmation.confirmationId, "confirmation-call-shell");
  assert.equal(confirmation.resumeAvailability, "live");
  assert.equal(confirmation.title, "运行命令");
  assert.equal(confirmation.actionSummary, "运行命令：pnpm test");
  assert.equal(confirmation.actionSummary.includes("请求执行执行操作"), false);
  assert.equal(confirmation.actionSummary.includes("需要你确认后继续"), false);
  assert.equal(confirmation.actionSummary.includes("在工作区内执行 Shell 命令"), false);
});

test("tool security policy does not infer confirmation beyond command tools", () => {
  const metadata: ToolDefinitionMetadata = {
    ...readOnlyMetadata(),
    category: "filesystem",
    operationType: "read-write",
    riskLevel: "medium",
    requiresConfirmation: true,
  };
  const decision = evaluateToolCallSecurity({
    request: { callId: "call-custom-write", toolName: "custom_write", input: { path: "notes.txt" } },
    definition: toolDefinition("custom_write", metadata),
    metadata,
    context: { platform: "win32" },
  });

  assert.equal(decision.decision, "allow");
});

function toolDefinition(name: string, metadata: ToolDefinitionMetadata): ToolDefinition {
  return {
    name,
    description: `${name} test tool`,
    inputSchema: { type: "object", properties: {} },
    metadata,
  };
}

function readOnlyMetadata(): ToolDefinitionMetadata {
  return {
    category: "web",
    operationType: "read-only",
    riskLevel: "low",
    requiresConfirmation: false,
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
  };
}
