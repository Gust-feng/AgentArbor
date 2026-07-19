import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserSnapshotTool, type BrowserAutomation } from "./browser-tool.js";
import { InMemoryToolOutputStore } from "../tool-output-store.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

test("browser_snapshot returns bounded browser page facts through injected automation", async () => {
  const automation: BrowserAutomation = {
    async snapshot(input) {
      return {
        url: input.url,
        title: "Example Page",
        text: "Visible body text with enough content for a preview.",
      };
    },
  };
  const tool = createBrowserSnapshotTool({ automation });

  const output = await tool.execute({ url: "https://example.com/path", waitMs: 10, maxTextChars: 20 }, context);
  const record = asRecord(output);

  assert.equal(tool.definition.metadata?.operationType, "read-only");
  assertDirectToolFacts(record);
  assert.equal(record.url, "https://example.com/path");
  assert.equal(record.title, "Example Page");
  assert.equal(String(record.text).length <= 22, true);
  assert.equal(record.startChar, 0);
  assert.equal(record.hasMoreAfter, true);
  assert.equal(asRecord(asRecord(record.continuation).nextInput).startChar, 20);
  assert.equal(record.truncated, true);
});

test("browser_snapshot continues truncated page text with startChar", async () => {
  const automation: BrowserAutomation = {
    async snapshot() {
      return {
        url: "https://example.com/long",
        title: "Long Page",
        text: "abcdefghijklmnopqrstuvwxyz",
      };
    },
  };
  const tool = createBrowserSnapshotTool({ automation });

  const output = await tool.execute({ url: "https://example.com/long", maxTextChars: 5, startChar: 10 }, context);
  const record = asRecord(output);

  assertDirectToolFacts(record);
  assert.equal(record.text, "klmno");
  assert.equal(record.startChar, 10);
  assert.equal(record.textChars, 5);
  assert.equal(record.hasMoreAfter, true);
  assert.equal(asRecord(asRecord(record.continuation).nextInput).startChar, 15);
  assert.equal(Number(asRecord(asRecord(record.continuation).nextInput).startChar) > Number(record.startChar), true);
});

test("browser_snapshot continues beyond the former startChar ceiling without inserting ellipsis", async () => {
  const pageText = `${"x".repeat(2_000_000)}abcdef`;
  const automation: BrowserAutomation = {
    async snapshot() {
      return {
        url: "https://example.com/ceiling",
        title: "Ceiling Page",
        text: pageText,
      };
    },
  };
  const tool = createBrowserSnapshotTool({ automation });

  const first = asRecord(await tool.execute({
    url: "https://example.com/ceiling",
    maxTextChars: 3,
    startChar: 2_000_000,
  }, context));
  const nextInput = asRecord(asRecord(first.continuation).nextInput);
  const second = asRecord(await tool.execute(nextInput, context));

  assertDirectToolFacts(first);
  assert.equal(first.text, "abc");
  assert.equal(first.truncated, true);
  assert.equal(nextInput.startChar, 2_000_003);
  assert.equal(Number(nextInput.startChar) > Number(first.startChar), true);
  assertDirectToolFacts(second);
  assert.equal(second.text, "def");
  assert.equal(second.truncated, false);
  assert.equal(second.continuation, undefined);
  assert.equal(`${first.text}${second.text}`, "abcdef");
  assert.equal(`${first.text}${second.text}`.includes("..."), false);
});

test("browser_snapshot rejects non-http urls", async () => {
  const tool = createBrowserSnapshotTool({
    automation: {
      async snapshot() {
        throw new Error("should not run");
      },
    },
  });

  await assert.rejects(() => tool.execute({ url: "file:///etc/passwd" }, context), /HTTP or HTTPS/);
});

test("browser_snapshot rejects fractional continuation offsets", async () => {
  const tool = createBrowserSnapshotTool({
    automation: {
      async snapshot() {
        throw new Error("automation must not run for invalid input");
      },
    },
  });

  await assert.rejects(
    () => tool.execute({ url: "https://example.com", startChar: 1.5 }, context),
    /non-negative safe integer/
  );
});

test("browser_snapshot distinguishes navigation and retained-snapshot failures", async () => {
  const navigation = createBrowserSnapshotTool({
    automation: { async snapshot() { throw new Error("navigation unavailable"); } },
  });
  await assert.rejects(
    navigation.execute({ url: "https://example.com/failure" }, context),
    (error: unknown) => error instanceof Error && (error as Error & { readonly code?: string }).code === "browser_navigation_failed",
  );

  const retained = createBrowserSnapshotTool({
    outputStore: new InMemoryToolOutputStore(),
    automation: { async snapshot() { throw new Error("must not navigate"); } },
  });
  await assert.rejects(
    retained.execute({ snapshotRef: "tool-output://missing", startChar: 0 }, context),
    (error: unknown) => error instanceof Error && (error as Error & { readonly code?: string }).code === "tool_output_not_found",
  );
});

test("browser_snapshot continues from one retained snapshot without navigating again", async () => {
  let navigations = 0;
  const tool = createBrowserSnapshotTool({
    outputStore: new InMemoryToolOutputStore(),
    automation: {
      async snapshot(input) {
        navigations += 1;
        return { url: input.url, title: "Stable", text: "abcdefghijkl" };
      },
    },
  });

  const first = asRecord(await tool.execute({ url: "https://example.com/stable", maxTextChars: 4 }, context));
  const second = asRecord(await tool.execute(asRecord(asRecord(first.continuation).nextInput), context));
  const third = asRecord(await tool.execute(asRecord(asRecord(second.continuation).nextInput), context));

  assert.equal(navigations, 1);
  assert.equal(`${first.text}${second.text}${third.text}`, "abcdefghijkl");
  assert.equal(second.url, undefined);
  assert.equal(third.continuation, undefined);
});

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function assertDirectToolFacts(output: Readonly<Record<string, unknown>>): void {
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `browser output must not contain ${legacyField}`);
  }
}
