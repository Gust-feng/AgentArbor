import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("tool display owners consume only canonical top-level facts", async () => {
  const root = path.join(process.cwd(), "src", "app");
  const sources = await Promise.all([
    readFile(path.join(root, "tool-projection", "tool-display-normalization.ts"), "utf8"),
    readFile(path.join(root, "tool-projection", "tool-display-projection.ts"), "utf8"),
    readFile(path.join(root, "desktop-agent", "desktop-agent-session-projection.ts"), "utf8"),
  ]);

  for (const source of sources) {
    assert.equal(/output\.result\b/u.test(source), false, "display owners must not read output.result");
    assert.equal(/output\.action\b/u.test(source), false, "display owners must not read output.action");
    assert.equal(/output\.summary\b/u.test(source), false, "display owners must not read output.summary");
  }
});
