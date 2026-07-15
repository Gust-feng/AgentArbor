import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  resolveAgentArborAppHomeFromConfigDirectory,
  resolveAgentArborRuntimePaths,
} from "./runtime-paths.js";

test("runtime paths place runtime beside a conventional config directory", () => {
  const appHome = path.resolve("agentarbor-home");

  assert.equal(
    resolveAgentArborAppHomeFromConfigDirectory(path.join(appHome, "config")),
    appHome,
  );
  assert.deepEqual(resolveAgentArborRuntimePaths(path.join(appHome, "config")), {
    appHome,
    runtimeHome: path.join(appHome, "runtime"),
  });
});

test("runtime paths treat a non-config directory as the application home", () => {
  const appHome = path.resolve("custom-agentarbor-home");

  assert.deepEqual(resolveAgentArborRuntimePaths(appHome), {
    appHome,
    runtimeHome: path.join(appHome, "runtime"),
  });
});
