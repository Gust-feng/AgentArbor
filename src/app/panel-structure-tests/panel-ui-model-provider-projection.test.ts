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
  const [projection, settings, form, icons, logos, appConfigProjection, appSettingsController, modelOptions] = await Promise.all([
    readPanelUiSource(path.join("components", "model-settings-projection.ts")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
    readPanelUiSource(path.join("components", "model-provider-form.tsx")),
    readPanelUiSource(path.join("components", "model-settings-icons.tsx")),
    readPanelUiSource("model-provider-logos.ts"),
    readPanelUiSource("app-config-projection.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource("model-options.ts"),
  ]);

  assert.equal(projection.includes("profile === undefined"), true);
  assert.equal(projection.includes(": friendlyProfileTitle(profile)"), true);
  assert.equal(projection.includes("if (identity !== \"unknown\") return modelProviderDisplayName(identity);"), false);
  assert.equal(settings.includes("provider-detail-logo-edit"), true);
  assert.equal(settings.includes("aria-label=\"供应商名称\""), true);
  assert.equal(settings.includes("const LOGO_FILE_MAX_BYTES = 3 * 1024 * 1024;"), true);
  assert.equal(settings.includes("LOGO_FILE_MIME_BY_EXTENSION"), true);
  assert.equal(settings.includes("logoDataUrlFromFileReaderResult"), true);
  assert.equal(settings.includes("readonly editedProfiles"), true);
  assert.equal(settings.includes("modelFormForProviderItem({ ...targetForm, logoDataUrl, logoCleared: false }, targetItem)"), true);
  assert.equal(settings.includes("function setSelectedModelForm(form: ModelForm): void"), true);
  assert.equal(settings.includes("function scheduleSelectedModelSave(form: ModelForm): void"), true);
  assert.equal(settings.includes("function modelFormForProviderItem(form: ModelForm, item: ModelProviderListItem): ModelForm"), true);
  assert.equal(settings.includes("upsertModelFormDraft(nextForm)"), true);
  assert.equal(settings.includes("void saveModelImmediately(nextForm).catch(() => undefined);"), true);
  assert.equal(settings.includes("flushScheduledModelSave();"), true);
  assert.equal(settings.includes("lastActiveProfileIdRef"), true);
  assert.equal(settings.includes("selectedForm.logoDataUrl || selectedItem.logoDataUrl"), true);
  assert.equal(settings.includes("value={selectedForm.label}"), true);
  assert.equal(appConfigProjection.includes("return config.label ?? \"\";"), true);
  assert.equal(appSettingsController.includes("mergeSavedModelForm(previous, nextModelForm, response)"), true);
  assert.equal(appSettingsController.includes("logoDataUrl: savedProfile.logoDataUrl ?? \"\""), true);
  assert.equal(form.includes("供应商名称"), false);
  assert.equal(icons.includes("provider-logo-image"), true);
  assert.equal(logos.includes("readonly logoDataUrl?: string"), true);
  assert.equal(logos.includes("return { imageSrc: input.logoDataUrl, tone: \"custom\" };"), true);
  assert.equal(modelOptions.includes("const label = profile.label ?? catalog?.label ?? profile.profileId;"), true);
});

test("configured provider projection binds builtin presets by profile identity instead of display-name or endpoint keywords", async () => {
  const [projection, logos, providerList, settings] = await Promise.all([
    readPanelUiSource(path.join("components", "model-settings-projection.ts")),
    readPanelUiSource("model-provider-logos.ts"),
    readPanelUiSource(path.join("components", "model-provider-list.tsx")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
  ]);

  assert.equal(projection.includes("presetId: builtinProviderPresetId({ profileId: profile.profileId })"), true);
  assert.equal(projection.includes("baseUrl: profile.baseUrl,"), false);
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
