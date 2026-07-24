import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  asRecord,
  contextAttachmentToolCenter,
  createZipBuffer,
  taskSoilWithContext,
  TOOL_CONTEXT,
} from "./context-attachment-test-support.js";
test("context attachment archive tools inspect selected ZIP without extracting or exposing local paths", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-zip-"));
  const zipFile = path.join(localRoot, "project.zip");
  const archive = createZipBuffer({
    "README.md": "# Demo\n",
    "src/index.ts": "export const answer = 42;\n",
    "../unsafe.txt": "bad path",
  });
  await fs.writeFile(zipFile, archive);
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_archive",
          ref: `local-file:${zipFile}`,
          kind: "file",
          title: "project.zip",
          metadata: {
            byteLength: archive.length,
            mimeType: "application/zip",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${zipFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: [
        "attachment_list",
        "attachment_inspect_archive",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-zip",
        toolName: "attachment_list",
        input: {},
      },
      TOOL_CONTEXT,
      permission
    );
    const inspected = await center.execute(
      {
        callId: "call:inspect-zip",
        toolName: "attachment_inspect_archive",
        input: { attachmentId: "ctx_archive" },
      },
      TOOL_CONTEXT,
      permission
    );
    const modelVisible = JSON.stringify([listed.output, inspected.output]);

    assert.equal(listed.status, "completed");
    assert.equal(inspected.status, "completed");
    const archiveFacts = asRecord(inspected.output);
    for (const legacyField of ["action", "status", "summary", "result"]) {
      assert.equal(legacyField in archiveFacts, false, `archive output must not contain ${legacyField}`);
    }
    assert.equal(modelVisible.includes("\"format\":\"archive\""), true);
    assert.equal(modelVisible.includes("\"canInspectArchive\":true"), true);
    assert.equal(modelVisible.includes("\"archive\":true"), true);
    assert.equal(modelVisible.includes("\"format\":\"zip\""), true);
    assert.equal(modelVisible.includes("src/index.ts"), true);
    assert.equal(modelVisible.includes("\"unsafePath\":true"), true);
    assert.equal(modelVisible.includes(zipFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});
