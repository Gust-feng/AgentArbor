import assert from "node:assert/strict";
import test from "node:test";
import { parsePanelArgs, parsePanelDesktopArgs } from "./panel-args.js";

test("panel args default to the fixed local browser panel port and smoke off", () => {
  assert.deepEqual(parsePanelArgs([]), {
    host: "127.0.0.1",
    port: 9090,
    configDirectory: undefined,
    smoke: false,
    windowSmoke: false,
    devUrl: undefined,
  });
});

test("desktop panel args default to a dynamic local panel port", () => {
  assert.deepEqual(parsePanelDesktopArgs([]), {
    host: "127.0.0.1",
    port: 0,
    configDirectory: undefined,
    smoke: false,
    windowSmoke: false,
    devUrl: undefined,
  });
});

test("desktop panel smoke keeps the dynamic local panel port when no port is explicit", () => {
  assert.deepEqual(parsePanelDesktopArgs(["--smoke"]), {
    host: "127.0.0.1",
    port: 0,
    configDirectory: undefined,
    smoke: true,
    windowSmoke: false,
    devUrl: undefined,
  });
});

test("desktop panel window smoke creates a real window path without enabling server-only smoke", () => {
  assert.deepEqual(parsePanelDesktopArgs(["--window-smoke"]), {
    host: "127.0.0.1",
    port: 0,
    configDirectory: undefined,
    smoke: false,
    windowSmoke: true,
    devUrl: undefined,
  });
});

test("desktop panel args honor an explicit fixed port", () => {
  assert.deepEqual(parsePanelDesktopArgs(["--port", "9090"]), {
    host: "127.0.0.1",
    port: 9090,
    configDirectory: undefined,
    smoke: false,
    windowSmoke: false,
    devUrl: undefined,
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
      windowSmoke: false,
      devUrl: undefined,
    }
  );
});

test("desktop panel args support a dev url override", () => {
  assert.deepEqual(parsePanelDesktopArgs(["--dev-url", "http://127.0.0.1:4305/"]), {
    host: "127.0.0.1",
    port: 0,
    configDirectory: undefined,
    smoke: false,
    windowSmoke: false,
    devUrl: "http://127.0.0.1:4305/",
  });
});

test("panel args reject unknown switches", () => {
  assert.throws(() => parsePanelArgs(["--desktop-mode"]), /Unknown panel argument: --desktop-mode/);
});

test("panel args reject mutually exclusive smoke modes", () => {
  assert.throws(
    () => parsePanelDesktopArgs(["--smoke", "--window-smoke"]),
    /--smoke and --window-smoke cannot be used together/
  );
});
