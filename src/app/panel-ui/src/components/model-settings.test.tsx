import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("ModelSettings built-in provider presets", () => {
  test("shows unconfigured presets without creating model profiles", () => {
    const onSave = vi.fn<(form?: ModelForm) => Promise<void>>(async () => undefined);

    render(<FreshModelSettingsHarness onSave={onSave} />);

    expect(document.querySelector('[data-provider-key="profile:default"]')).not.toBeNull();
    expect(document.querySelector('[data-provider-key="preset:moonshot"]')).not.toBeNull();
    expect(screen.getByText("月之暗面")).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("ModelSettings API key editing", () => {
  test("keeps the API key field editable when the provider already has a configured secret", async () => {
    const user = userEvent.setup();

    render(<ConfigurableModelSettingsHarness config={SECRET_CONFIG} />);

    const apiKeyInput = screen.getByLabelText("API Key") as HTMLInputElement;
    expect(apiKeyInput.readOnly).toBe(false);
    await user.type(apiKeyInput, "sk-replacement");
    expect(apiKeyInput.value).toBe("sk-replacement");
  });

  test("preserves the typed API key when the first save activates the preset profile", async () => {
    const user = userEvent.setup();

    const { rerender } = render(<ConfigurableModelSettingsHarness config={FRESH_CONFIG} />);

    const moonshotRow = document.querySelector('[data-provider-key="preset:moonshot"]') as HTMLElement | null;
    expect(moonshotRow).not.toBeNull();
    if (moonshotRow === null) {
      throw new Error("Unconfigured moonshot preset row not found.");
    }
    fireEvent.click(within(moonshotRow).getByRole("button", { name: "月之暗面" }));

    const apiKeyInput = screen.getByLabelText("API Key") as HTMLInputElement;
    await user.type(apiKeyInput, "sk-moonshot");
    expect(apiKeyInput.value).toBe("sk-moonshot");

    rerender(<ConfigurableModelSettingsHarness config={MOONSHOT_ACTIVATED_CONFIG} />);

    expect(apiKeyInput.value).toBe("sk-moonshot");
    expect(apiKeyInput.readOnly).toBe(false);
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

function FreshModelSettingsHarness(props: {
  readonly onSave: (form?: ModelForm) => Promise<void>;
}): React.ReactElement {
  return (
    <ConfigurableModelSettingsHarness
      config={FRESH_CONFIG}
      initialForm={DEFAULT_FORM}
      onSave={props.onSave}
    />
  );
}

function ConfigurableModelSettingsHarness(props: {
  readonly config: ConfigResponse;
  readonly initialForm?: ModelForm;
  readonly onSave?: (form?: ModelForm) => Promise<void>;
}): React.ReactElement {
  const [modelForm, setModelForm] = useState<ModelForm>(props.initialForm ?? {
    profileId: "",
    label: "",
    logoDataUrl: "",
    logoCleared: false,
    baseUrl: "",
    protocolKind: "openai_compatible_chat_completions",
    model: "",
    apiKey: "",
    apiKeyCleared: false,
  });
  return (
    <ModelSettings
      config={props.config}
      modelForm={modelForm}
      setModelForm={setModelForm}
      onSave={props.onSave ?? (async () => undefined)}
      onCreateCustomProfile={async () => undefined}
      onReorderModelProviders={async () => undefined}
      onDeleteModelProvider={async () => undefined}
      onFetchModels={async () => undefined}
      onSaveModelCatalog={async (_profileId: string, _catalog: ModelProviderModelCatalog) => undefined}
      onRevealModelApiKey={async () => undefined}
    />
  );
}

const DEFAULT_FORM: ModelForm = {
  profileId: "default",
  label: "OpenAI",
  logoDataUrl: "",
  logoCleared: false,
  baseUrl: "https://api.openai.com/v1",
  protocolKind: "openai_responses",
  model: "",
  apiKey: "",
  apiKeyCleared: false,
};

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

const FRESH_CONFIG: ConfigResponse = {
  config: {
    profileId: "default",
    label: "OpenAI",
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
    baseUrl: "https://api.openai.com/v1",
    defaultAiMode: "openai-responses",
    enabled: true,
    secretConfigured: false,
  },
  profiles: [
    {
      profileId: "default",
      label: "OpenAI",
      providerKind: "openai_compatible",
      protocolKind: "openai_responses",
      baseUrl: "https://api.openai.com/v1",
      defaultAiMode: "openai-responses",
      enabled: true,
      secretConfigured: false,
    },
  ],
  modelProviderMarket: {
    presets: [
      {
        presetId: "openai",
        label: "OpenAI",
        vendor: "OpenAI",
        description: "OpenAI",
        providerKind: "openai_compatible",
        protocolKind: "openai_responses",
        baseUrl: "https://api.openai.com/v1",
        modelsPath: "/models",
      },
      {
        presetId: "moonshot",
        label: "月之暗面",
        vendor: "Moonshot AI",
        description: "Kimi",
        providerKind: "openai_compatible",
        protocolKind: "openai_compatible_chat_completions",
        baseUrl: "https://api.moonshot.cn/v1",
        modelsPath: "/models",
      },
    ],
  },
};

const SECRET_CONFIG: ConfigResponse = {
  config: {
    profileId: "default",
    label: "OpenAI",
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
    baseUrl: "https://api.openai.com/v1",
    defaultAiMode: "openai-responses",
    enabled: true,
    secretConfigured: true,
  },
  profiles: [
    {
      profileId: "default",
      label: "OpenAI",
      providerKind: "openai_compatible",
      protocolKind: "openai_responses",
      baseUrl: "https://api.openai.com/v1",
      defaultAiMode: "openai-responses",
      enabled: true,
      secretConfigured: true,
    },
  ],
  modelProviderMarket: FRESH_CONFIG.modelProviderMarket,
  modelProviderOrder: ["profile:default"],
};

const MOONSHOT_ACTIVATED_CONFIG: ConfigResponse = {
  config: {
    profileId: "moonshot",
    label: "月之暗面",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultAiMode: "openai-compatible",
    enabled: true,
    secretConfigured: true,
  },
  profiles: [
    {
      profileId: "default",
      label: "OpenAI",
      providerKind: "openai_compatible",
      protocolKind: "openai_responses",
      baseUrl: "https://api.openai.com/v1",
      defaultAiMode: "openai-responses",
      enabled: true,
      secretConfigured: false,
    },
    {
      profileId: "moonshot",
      label: "月之暗面",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.moonshot.cn/v1",
      defaultAiMode: "openai-compatible",
      enabled: true,
      secretConfigured: true,
    },
  ],
  modelProviderMarket: FRESH_CONFIG.modelProviderMarket,
  modelProviderOrder: ["profile:default", "profile:moonshot"],
};
