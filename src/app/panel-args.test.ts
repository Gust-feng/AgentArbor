import assert from "node:assert/strict";
import test from "node:test";
import { parsePanelArgs } from "./panel-args.js";

test("panel args default to the local desktop panel host and smoke off", () => {
  assert.deepEqual(parsePanelArgs([]), {
    host: "127.0.0.1",
    port: 9090,
    configDirectory: undefined,
    smoke: false,
  });
});

test("panel args support explicit host, port, config directory and smoke flag", () => {
  assert.deepEqual(
    parsePanelArgs(["--host", "0.0.0.0", "--port", "0", "--config-dir", "C:/tmp/agentarbor", "--smoke"]),
    {
      host: "0.0.0.0",
      port: 0,
      configDirectory: "C:/tmp/agentarbor",
      smoke: true,
    }
  );
});

test("panel args reject unknown switches", () => {
  assert.throws(() => parsePanelArgs(["--desktop-mode"]), /Unknown panel argument: --desktop-mode/);
});
