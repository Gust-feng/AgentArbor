import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createElectronAppUpdateService,
  electronAutoUpdaterFromModule,
  type ElectronUpdaterDownloadProgress,
  type ElectronUpdaterLike,
  type ElectronUpdaterUpdateInfo,
} from "./electron-app-update-service.js";

class FakeElectronUpdater extends EventEmitter implements ElectronUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkCalls = 0;
  downloadCalls = 0;
  quitAndInstallCalls: Array<{ readonly isSilent?: boolean; readonly isForceRunAfter?: boolean }> = [];
  checkResult: "available" | "not-available" | "error" = "not-available";
  updateInfo: ElectronUpdaterUpdateInfo = { version: "0.2.0", releaseDate: "2026-06-30T00:00:00.000Z" };

  override on(event: "checking-for-update", listener: () => void): this;
  override on(event: "update-available", listener: (info: ElectronUpdaterUpdateInfo) => void): this;
  override on(event: "update-not-available", listener: (info: ElectronUpdaterUpdateInfo) => void): this;
  override on(event: "download-progress", listener: (progress: ElectronUpdaterDownloadProgress) => void): this;
  override on(event: "update-downloaded", listener: (info: ElectronUpdaterUpdateInfo) => void): this;
  override on(event: "error", listener: (error: Error) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  async checkForUpdates(): Promise<void> {
    this.checkCalls += 1;
    this.emit("checking-for-update");
    if (this.checkResult === "error") {
      const error = new Error("feed failed");
      this.emit("error", error);
      throw error;
    }
    if (this.checkResult === "available") {
      this.emit("update-available", this.updateInfo);
      return;
    }
    this.emit("update-not-available", this.updateInfo);
  }

  async downloadUpdate(): Promise<void> {
    this.downloadCalls += 1;
    this.emit("download-progress", {
      percent: 42,
      transferred: 42,
      total: 100,
      bytesPerSecond: 1000,
    });
    this.emit("update-downloaded", this.updateInfo);
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitAndInstallCalls.push({ isSilent, isForceRunAfter });
  }
}

test("electron app update service reports up to date checks", async () => {
  const updater = new FakeElectronUpdater();
  updater.updateInfo = {
    version: "0.1.0",
    releaseNotes: "<p>不应投影当前版本的更新说明。</p>",
  };
  const service = createElectronAppUpdateService({
    updater,
    currentVersion: "0.1.0",
  });

  const checked = await service.check();

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.checkCalls, 1);
  assert.equal(checked.status, "up_to_date");
  assert.equal(checked.runtime, "electron");
  assert.equal(checked.canCheck, true);
  assert.equal(checked.canInstall, false);
  assert.equal(checked.latest, undefined);
});

test("electron app update service downloads available updates before install", async () => {
  const updater = new FakeElectronUpdater();
  updater.checkResult = "available";
  updater.updateInfo = {
    version: "0.2.0",
    releaseDate: "2026-06-30T00:00:00.000Z",
    files: [{ url: "AgentArbor-Setup-0.2.0.exe" }],
  };
  const service = createElectronAppUpdateService({
    updater,
    currentVersion: "0.1.0",
  });

  const checked = await service.check();

  assert.equal(updater.downloadCalls, 1);
  assert.equal(checked.status, "downloaded");
  assert.equal(checked.latest?.version, "0.2.0");
  assert.equal(checked.progress?.percent, 100);
  assert.equal(checked.canInstall, true);

  const installing = await service.install();

  assert.equal(installing.status, "installing");
  assert.deepEqual(updater.quitAndInstallCalls, [{ isSilent: false, isForceRunAfter: true }]);
});

test("electron app update service rejects install before download", async () => {
  const updater = new FakeElectronUpdater();
  const service = createElectronAppUpdateService({
    updater,
    currentVersion: "0.1.0",
  });

  const installed = await service.install();

  assert.equal(installed.ok, false);
  assert.equal(installed.status, "failed");
  assert.equal(installed.canInstall, false);
  assert.equal(updater.quitAndInstallCalls.length, 0);
});

test("electron app update service can be explicitly unsupported", async () => {
  const updater = new FakeElectronUpdater();
  const service = createElectronAppUpdateService({
    updater,
    currentVersion: "0.1.0",
    enabled: false,
    reason: "dev mode",
  });

  const checked = await service.check();

  assert.equal(checked.status, "unsupported");
  assert.equal(checked.runtime, "unsupported");
  assert.equal(checked.canCheck, false);
  assert.equal(checked.canInstall, false);
  assert.equal(updater.checkCalls, 0);
});

test("electron updater module resolver accepts ESM default exports", () => {
  const updater = new FakeElectronUpdater();

  assert.equal(electronAutoUpdaterFromModule({ autoUpdater: updater }), updater);
  assert.equal(electronAutoUpdaterFromModule({ default: { autoUpdater: updater } }), updater);
  assert.equal(electronAutoUpdaterFromModule({}), undefined);
});
