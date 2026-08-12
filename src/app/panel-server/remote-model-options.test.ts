import assert from "node:assert/strict";
import test from "node:test";

import type { SanitizedModelProviderConfig } from "../../domain/config/index.js";
import { projectRemoteModelOptions, resolveRemoteModelSelection } from "./remote-model-options.js";

test("remote model projection contains selection metadata but no connection secrets", () => {
  const profile = modelProfile();
  const options = projectRemoteModelOptions({
    profiles: [profile],
    active: profile,
    capabilityOverrides: [],
    catalogs: [{
      profileId: profile.profileId,
      label: "Private catalog",
      baseUrl: "https://private.example/v1",
      modelsPath: "/models",
      fetchedAt: "2026-08-04T00:00:00.000Z",
      models: [{ id: "model-a", displayName: "Model A" }],
    }],
  });

  assert.deepEqual(options.map((option) => ({ label: option.label, providerLabel: option.providerLabel, isDefault: option.isDefault })), [
    { label: "Model A", providerLabel: "Private provider", isDefault: true },
  ]);
  const serialized = JSON.stringify(options);
  for (const forbidden of [profile.baseUrl, profile.secretRef, "apiKey", "modelsPath", "secretConfigured"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must stay on desktop`);
  }
});

test("remote model selection resolves only an option in the current safe catalog", () => {
  const profile = modelProfile();
  const options = projectRemoteModelOptions({ profiles: [profile], active: profile, capabilityOverrides: [], catalogs: [] });
  const selectionId = options[0]?.id;
  assert.notEqual(selectionId, undefined);
  assert.deepEqual(resolveRemoteModelSelection(options, selectionId!), { profileId: "private-profile", model: "model-a" });
  assert.equal(resolveRemoteModelSelection(options, '["private-profile","forged-model"]'), undefined);
  assert.equal(resolveRemoteModelSelection([], selectionId!), undefined);
});

test("remote model projection excludes disabled profiles", () => {
  const disabled = { ...modelProfile(), enabled: false };
  assert.deepEqual(projectRemoteModelOptions({ profiles: [disabled], active: disabled, capabilityOverrides: [], catalogs: [] }), []);
});

function modelProfile(): SanitizedModelProviderConfig {
  return {
    profileId: "private-profile",
    label: "Private provider",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://private.example/v1",
    model: "model-a",
    defaultAiMode: "openai-compatible",
    secretRef: "secret:model-provider:private-profile",
    secretConfigured: true,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}
