import assert from "node:assert/strict";
import test from "node:test";
import { createStartupThemeSnapshot, normalizeStartupTheme } from "./panel-startup-theme.js";

test("startup theme snapshot defaults to the stable light software shell", () => {
  assert.deepEqual(createStartupThemeSnapshot(undefined, undefined), {
    styleId: "default",
    colorId: "light",
    backgroundColor: "#f5f7fa",
    shellColor: "#ffffff",
    borderColor: "#b8c5d6",
    textColor: "#18212f",
    mainWindow: {
      width: 1440,
      height: 960,
    },
  });
});

test("startup theme snapshot keeps each style on its valid default color", () => {
  assert.deepEqual(normalizeStartupTheme("default", "warm"), {
    styleId: "default",
    colorId: "light",
  });
  assert.deepEqual(normalizeStartupTheme("classic", undefined), {
    styleId: "classic",
    colorId: "warm",
  });
  assert.deepEqual(normalizeStartupTheme("glass", undefined), {
    styleId: "glass",
    colorId: "aurora",
  });
});

test("startup theme snapshot accepts valid style color pairs", () => {
  assert.equal(createStartupThemeSnapshot("default", "dark").shellColor, "#151a22");
  assert.equal(createStartupThemeSnapshot("classic", "forest").borderColor, "#b9c7b7");
  assert.equal(createStartupThemeSnapshot("glass", "ocean").textColor, "#132833");
});
