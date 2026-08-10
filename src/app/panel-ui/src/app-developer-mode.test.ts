import { beforeEach, expect, test } from "vitest";
import { getDeveloperModeEnabled, saveDeveloperModeEnabled } from "./app-developer-mode";
import { settingsGroupsForDeveloperMode } from "./components/settings-dialog";

beforeEach(() => window.localStorage.clear());

test("developer mode is disabled by default and persists explicit changes", () => {
  expect(getDeveloperModeEnabled()).toBe(false);

  saveDeveloperModeEnabled(true);
  expect(getDeveloperModeEnabled()).toBe(true);

  saveDeveloperModeEnabled(false);
  expect(getDeveloperModeEnabled()).toBe(false);
});

test("developer-only settings stay out of the normal settings navigation without legacy PathMemory", () => {
  const normalGroups = settingsGroupsForDeveloperMode(false).map((group) => group.id);
  expect(normalGroups).not.toContain("pathMemory");
  expect(normalGroups).not.toContain("developer");
  expect(normalGroups).not.toContain("appearance");

  const developerGroups = settingsGroupsForDeveloperMode(true).map((group) => group.id);
  expect(developerGroups).not.toContain("pathMemory");
  expect(developerGroups).toContain("developer");
  expect(developerGroups).not.toContain("appearance");
});
