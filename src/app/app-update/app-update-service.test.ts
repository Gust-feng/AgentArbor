import assert from "node:assert/strict";
import test from "node:test";
import {
  compareAppVersions,
  createAppUpdateService,
  type AppUpdateFetch,
} from "./app-update-service.js";

test("app update version comparison follows semver precedence", () => {
  assert.equal(compareAppVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareAppVersions("v1.0.0", "1.0.0"), 0);
  assert.equal(compareAppVersions("1.0.0-beta.2", "1.0.0-beta.1"), 1);
  assert.equal(compareAppVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareAppVersions("not-a-version", "1.0.0"), undefined);
});

test("app update service reports unconfigured when no manifest URL exists", async () => {
  const service = createAppUpdateService({ currentVersion: "0.1.0" });

  assert.deepEqual(service.status(), {
    ok: true,
    status: "unconfigured",
    runtime: "manifest",
    currentVersion: "0.1.0",
    manifestUrlConfigured: false,
    canCheck: false,
    canInstall: false,
  });

  const checked = await service.check();
  assert.equal(checked.status, "unconfigured");
  assert.equal(checked.manifestUrlConfigured, false);
  assert.equal(checked.canCheck, false);
  assert.equal(checked.canInstall, false);
});

test("app update service detects newer manifests without executing installers", async () => {
  let calledUrl = "";
  const updateFetch: AppUpdateFetch = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        version: "0.2.0",
        channel: "stable",
        releasePageUrl: "https://updates.example/releases/0.2.0",
        downloadUrl: "file:///unsafe-installer.exe",
        notes: ["One", "Two"],
      }),
    };
  };
  const service = createAppUpdateService({
    currentVersion: "0.1.0",
    manifestUrl: "https://updates.example/agentarbor.json",
    fetch: updateFetch,
  });

  const checked = await service.check();

  assert.equal(calledUrl, "https://updates.example/agentarbor.json");
  assert.equal(checked.ok, true);
  assert.equal(checked.status, "available");
  assert.equal(checked.latest?.version, "0.2.0");
  assert.equal(checked.latest?.downloadUrl, undefined);
  assert.equal(checked.latest?.releasePageUrl, "https://updates.example/releases/0.2.0");
  assert.equal(checked.latest?.notes, "One\nTwo");
  assert.equal(checked.canInstall, false);
});

test("app update service records failed checks as update state", async () => {
  const updateFetch: AppUpdateFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: "bad version" }),
  });
  const service = createAppUpdateService({
    currentVersion: "0.1.0",
    manifestUrl: "https://updates.example/agentarbor.json",
    fetch: updateFetch,
  });

  const checked = await service.check();

  assert.equal(checked.ok, false);
  assert.equal(checked.status, "failed");
  assert.equal(checked.errorSummary, "更新清单版本号无效。");
});

test("manifest app update service does not install updates", async () => {
  const service = createAppUpdateService({
    currentVersion: "0.1.0",
    manifestUrl: "https://updates.example/agentarbor.json",
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: "0.2.0" }),
    }),
  });

  await service.check();
  const installed = await service.install();

  assert.equal(installed.ok, false);
  assert.equal(installed.status, "failed");
  assert.equal(installed.canInstall, false);
  assert.equal(installed.errorSummary, "当前运行方式只能检查发布信息，不能自动安装更新。");
});

test("app update service treats a missing GitHub release as no published package yet", async () => {
  const updateFetch: AppUpdateFetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ message: "Not Found" }),
  });
  const service = createAppUpdateService({
    currentVersion: "0.1.0",
    manifestUrl: "https://api.github.com/repos/Gust-feng/AgentArbor/releases/latest",
    fetch: updateFetch,
  });

  const checked = await service.check();

  assert.equal(checked.ok, true);
  assert.equal(checked.status, "no_release");
  assert.equal(checked.manifestUrlConfigured, true);
});
