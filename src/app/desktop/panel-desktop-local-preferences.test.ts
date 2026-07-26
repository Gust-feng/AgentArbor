import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDesktopLocalPreferenceStore, normalizeDesktopLocalPreferenceKey } from "./panel-desktop-local-preferences.js";

test("desktop local preference store persists accepted AgentArbor preferences", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-prefs-"));
  try {
    const store = createDesktopLocalPreferenceStore({ userDataDirectory: temp });

    assert.equal(store.write({ key: "agentarbor:startup-animation", value: "true" }), true);
    assert.equal(store.read("agentarbor:startup-animation"), "true");
    assert.deepEqual(JSON.parse(await fs.readFile(store.preferencePath, "utf8")), {
      "agentarbor:startup-animation": "true",
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("desktop local preference store does not collide with Chromium's Preferences file on Windows", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-prefs-"));
  try {
    await fs.writeFile(path.join(temp, "Preferences"), "{}", "utf8");
    const store = createDesktopLocalPreferenceStore({ userDataDirectory: temp });

    assert.equal(store.write({ key: "agentarbor:model-usage-display", value: "true" }), true);
    assert.equal(store.read("agentarbor:model-usage-display"), "true");
    assert.equal(path.basename(store.preferencePath), "agentarbor-local-preferences.json");
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("desktop local preference store migrates startup animation from legacy Chromium localStorage", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-prefs-"));
  try {
    const currentUserData = path.join(temp, "AgentArbor");
    const appData = path.join(temp, "Roaming");
    const legacyLevelDb = path.join(appData, "agentarbor", "Partitions", "agentarbor", "Local Storage", "leveldb");
    await fs.mkdir(legacyLevelDb, { recursive: true });
    await fs.writeFile(
      path.join(legacyLevelDb, "000003.log"),
      "\u0000_http://127.0.0.1:36851\u0000\u0001agentarbor:startup-animation\u0005\u0001true\u0000",
      "latin1"
    );

    const store = createDesktopLocalPreferenceStore({
      userDataDirectory: currentUserData,
      appDataDirectory: appData,
    });

    assert.equal(store.read("agentarbor:startup-animation"), "true");
    assert.deepEqual(JSON.parse(await fs.readFile(store.preferencePath, "utf8")), {
      "agentarbor:startup-animation": "true",
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("desktop local preference store keeps explicit JSON preferences ahead of legacy migration", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-prefs-"));
  try {
    const currentUserData = path.join(temp, "AgentArbor");
    const appData = path.join(temp, "Roaming");
    const preferencePath = path.join(currentUserData, "preferences", "local-preferences.json");
    await fs.mkdir(path.dirname(preferencePath), { recursive: true });
    await fs.writeFile(preferencePath, JSON.stringify({ "agentarbor:startup-animation": "false" }), "utf8");
    const legacyLevelDb = path.join(appData, "agentarbor", "Local Storage", "leveldb");
    await fs.mkdir(legacyLevelDb, { recursive: true });
    await fs.writeFile(
      path.join(legacyLevelDb, "000003.log"),
      "\u0000_http://127.0.0.1:36851\u0000\u0001agentarbor:startup-animation\u0005\u0001true\u0000",
      "latin1"
    );

    const store = createDesktopLocalPreferenceStore({
      userDataDirectory: currentUserData,
      appDataDirectory: appData,
    });

    assert.equal(store.read("agentarbor:startup-animation"), "false");
    assert.deepEqual(JSON.parse(await fs.readFile(store.preferencePath, "utf8")), {
      "agentarbor:startup-animation": "false",
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("desktop local preference store rejects corrupted boolean suffixes from legacy LevelDB", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-prefs-"));
  try {
    const levelDb = path.join(temp, "Local Storage", "leveldb");
    await fs.mkdir(levelDb, { recursive: true });
    await fs.writeFile(
      path.join(levelDb, "000003.log"),
      "\u0000_http://127.0.0.1:4305\u0000\u0001agentarbor:model-usage-display\u0005\u0001true4\u0000",
      "latin1"
    );

    const store = createDesktopLocalPreferenceStore({ userDataDirectory: temp });

    assert.equal(store.read("agentarbor:model-usage-display"), undefined);
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("desktop local preference key normalization rejects unrelated localStorage keys", () => {
  assert.equal(normalizeDesktopLocalPreferenceKey("agentarbor:startup-animation"), "agentarbor:startup-animation");
  assert.equal(normalizeDesktopLocalPreferenceKey("agentarbor.panel.sidebar.collapsed"), "agentarbor.panel.sidebar.collapsed");
  assert.equal(normalizeDesktopLocalPreferenceKey("other-app:key"), undefined);
  assert.equal(normalizeDesktopLocalPreferenceKey("../agentarbor:startup-animation"), undefined);
});
