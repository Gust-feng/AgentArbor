import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createId } from "./id.js";

const execFileAsync = promisify(execFile);

test("createId preserves its prefix and uses an opaque UUID suffix", () => {
  const first = createId("panel-run");
  const second = createId("panel-run");

  assert.match(first, /^panel-run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.match(second, /^panel-run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.notEqual(first, second);
});

test("createId remains unique for durable records and events across fresh Node processes", async () => {
  const first = await createIdInFreshProcess("conversation");
  const second = await createIdInFreshProcess("conversation");
  const firstEvent = await createIdInFreshProcess("deep-event");
  const secondEvent = await createIdInFreshProcess("deep-event");

  assert.match(first, /^conversation-/u);
  assert.match(second, /^conversation-/u);
  assert.notEqual(first, second);
  assert.match(firstEvent, /^deep-event-/u);
  assert.match(secondEvent, /^deep-event-/u);
  assert.notEqual(firstEvent, secondEvent);
});

async function createIdInFreshProcess(prefix: string): Promise<string> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "dist", "kernel", "id.js")).href;
  const source = [
    `import { createId } from ${JSON.stringify(moduleUrl)};`,
    `process.stdout.write(createId(${JSON.stringify(prefix)}));`,
  ].join("\n");
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return stdout.trim();
}
