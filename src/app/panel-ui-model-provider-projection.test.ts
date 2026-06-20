import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("configured builtin providers do not repopulate cleared models from preset defaults", async () => {
  const projection = await readPanelUiSource(path.join("components", "model-settings-projection.ts"));

  assert.equal(projection.includes('profile === undefined ? preset.defaultModel ?? "" : profile.model ?? ""'), true);
  assert.equal(projection.includes("profile?.model ?? preset.defaultModel"), false);
});

test("configured provider projection keeps user display identity editable", async () => {
  const [projection, settings, form, icons, logos, appConfigProjection, modelOptions] = await Promise.all([
    readPanelUiSource(path.join("components", "model-settings-projection.ts")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
    readPanelUiSource(path.join("components", "model-provider-form.tsx")),
    readPanelUiSource(path.join("components", "model-settings-icons.tsx")),
    readPanelUiSource("model-provider-logos.ts"),
    readPanelUiSource("app-config-projection.ts"),
    readPanelUiSource("model-options.ts"),
  ]);

  assert.equal(projection.includes("profile === undefined"), true);
  assert.equal(projection.includes(": friendlyProfileTitle(profile)"), true);
  assert.equal(projection.includes("if (identity !== \"unknown\") return modelProviderDisplayName(identity);"), false);
  assert.equal(settings.includes("provider-detail-logo-edit"), true);
  assert.equal(settings.includes("aria-label=\"供应商名称\""), true);
  assert.equal(settings.includes("LOGO_FILE_MAX_BYTES"), true);
  assert.equal(form.includes("供应商名称"), false);
  assert.equal(icons.includes("provider-logo-image"), true);
  assert.equal(logos.includes("readonly logoDataUrl?: string"), true);
  assert.equal(logos.includes("return { imageSrc: input.logoDataUrl, tone: \"custom\" };"), true);
  assert.equal(appConfigProjection.includes("return config.label ?? \"\";"), true);
  assert.equal(modelOptions.includes("const label = profile.label ?? catalog?.label ?? profile.profileId;"), true);
});

test("configured provider projection binds builtin presets by stable provider facts instead of display-name keywords", async () => {
  const [projection, logos, providerList, settings] = await Promise.all([
    readPanelUiSource(path.join("components", "model-settings-projection.ts")),
    readPanelUiSource("model-provider-logos.ts"),
    readPanelUiSource(path.join("components", "model-provider-list.tsx")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
  ]);

  assert.equal(projection.includes("presetId: builtinProviderPresetId({"), true);
  assert.equal(projection.includes("return item.presetId === preset.presetId;"), true);
  assert.equal(projection.includes("item.identity === presetIdentity"), false);
  assert.equal(projection.includes("protectedBuiltin: true"), true);
  assert.equal(projection.includes("protectedBuiltin: false"), true);
  assert.equal(logos.includes("export function builtinProviderPresetId"), true);
  assert.equal(logos.includes("const displayText = normalizeProviderSignal(input.title);"), false);
  assert.equal(providerList.includes("draggingItem?.profileId !== undefined && draggingItem.protectedBuiltin !== true"), true);
  assert.equal(settings.includes("const selectedBuiltinLocked = selectedItem?.protectedBuiltin === true;"), true);
  assert.equal(settings.includes("selectedBuiltinLocked ? ("), true);
  assert.equal(settings.includes("<div className=\"provider-detail-title\">"), true);
  assert.equal(settings.includes("disabled={props.saving || selectedBuiltinLocked}"), false);
  assert.equal(settings.includes("disabled={selectedBuiltinLocked}"), false);
  assert.equal(settings.includes("spellCheck={false}"), true);
  assert.equal(settings.includes("autoCorrect=\"off\""), true);
  assert.equal(settings.includes("autoCapitalize=\"off\""), true);
});
