import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { ConfigResponse, ModelProviderModelCatalog } from "../contracts/config";
import { ModelSettings, type ModelForm } from "./model-settings";

const HISTORICAL_LOGO = "data:image/png;base64,HISTORICAL";

describe("ModelSettings custom provider creation", () => {
  test("creates a fresh provider object without reusing the selected provider logo", async () => {
    const user = userEvent.setup();
    const onCreateCustomProfile = vi.fn<(form?: ModelForm) => Promise<void>>(async () => undefined);

    render(<ModelSettingsHarness onCreateCustomProfile={onCreateCustomProfile} />);

    await user.click(screen.getByRole("button", { name: "添加模型供应商" }));

    await waitFor(() => expect(onCreateCustomProfile).toHaveBeenCalledTimes(1));
    const createdForm = onCreateCustomProfile.mock.calls[0]?.[0];
    expect(createdForm).toBeDefined();
    if (createdForm === undefined) {
      throw new Error("Custom provider creation did not receive a form.");
    }
    expect(createdForm).toMatchObject({
      label: "自定义厂商",
      logoDataUrl: "",
      logoCleared: false,
      baseUrl: "https://api.example.com/v1",
    });
    expect(createdForm.profileId).toMatch(/^custom_/u);

    const historicalRow = document.querySelector('[data-provider-key="profile:custom_history"]');
    const createdRow = document.querySelector(`[data-provider-key="profile:${createdForm.profileId}"]`);
    expect(historicalRow?.querySelector("img")?.getAttribute("src")).toBe(HISTORICAL_LOGO);
    expect(createdRow).not.toBeNull();
    expect(createdRow?.querySelector("img")).toBeNull();
  });
});

function ModelSettingsHarness(props: {
  readonly onCreateCustomProfile: (form?: ModelForm) => Promise<void>;
}): React.ReactElement {
  const [modelForm, setModelForm] = useState<ModelForm>({
    profileId: "custom_history",
    label: "历史厂商",
    logoDataUrl: HISTORICAL_LOGO,
    logoCleared: false,
    baseUrl: "https://router.example.com/v1",
    protocolKind: "openai_compatible_chat_completions",
    model: "history-model",
    apiKey: "",
    apiKeyCleared: false,
  });
  return (
    <ModelSettings
      config={CONFIG}
      modelForm={modelForm}
      setModelForm={setModelForm}
      onSave={async () => undefined}
      onCreateCustomProfile={props.onCreateCustomProfile}
      onReorderModelProviders={async () => undefined}
      onDeleteModelProvider={async () => undefined}
      onFetchModels={async () => undefined}
      onSaveModelCatalog={async (_profileId: string, _catalog: ModelProviderModelCatalog) => undefined}
      onRevealModelApiKey={async () => undefined}
    />
  );
}

const CONFIG: ConfigResponse = {
  config: {
    profileId: "custom_history",
    label: "历史厂商",
    logoDataUrl: HISTORICAL_LOGO,
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://router.example.com/v1",
    model: "history-model",
    defaultAiMode: "openai-compatible",
  },
  profiles: [
    {
      profileId: "custom_history",
      label: "历史厂商",
      logoDataUrl: HISTORICAL_LOGO,
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://router.example.com/v1",
      model: "history-model",
      defaultAiMode: "openai-compatible",
    },
  ],
  modelProviderOrder: ["profile:custom_history"],
};
