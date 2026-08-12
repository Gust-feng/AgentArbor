import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import type { ConfigResponse } from "./contracts/config";
import { createInitialAppState, type AppState } from "./app-state";
import { useAppWorkbenchConfigState } from "./app-workbench-config-state";

describe("useAppFormStateSync active profile transitions", () => {
  test("keeps the user-edited form when the active profile changes to the profile the form targets", async () => {
    const user = userEvent.setup();
    render(<ConfigSyncHarness />);

    await user.click(screen.getByRole("button", { name: "编辑月之暗面表单" }));
    expect(screen.getByTestId("sync-profile").textContent).toBe("moonshot");
    expect(screen.getByTestId("sync-apikey").textContent).toBe("sk-typed");

    await user.click(screen.getByRole("button", { name: "激活月之暗面" }));

    expect(screen.getByTestId("sync-profile").textContent).toBe("moonshot");
    expect(screen.getByTestId("sync-apikey").textContent).toBe("sk-typed");
  });

  test("re-initializes the form when the active profile changes away from the form target", async () => {
    const user = userEvent.setup();
    render(<ConfigSyncHarness />);

    await user.click(screen.getByRole("button", { name: "编辑月之暗面表单" }));
    await user.click(screen.getByRole("button", { name: "激活其他厂商" }));

    expect(screen.getByTestId("sync-profile").textContent).toBe("other");
    expect(screen.getByTestId("sync-apikey").textContent).toBe("");
  });
});

function ConfigSyncHarness(): React.ReactElement {
  const [app, setApp] = useState<AppState>(() => ({
    ...createInitialAppState(),
    config: START_CONFIG,
  }));
  const configState = useAppWorkbenchConfigState(app);
  return (
    <div>
      <button
        type="button"
        onClick={() => configState.setModelForm({
          profileId: "moonshot",
          label: "月之暗面",
          logoDataUrl: "",
          logoCleared: false,
          baseUrl: "https://api.moonshot.cn/v1",
          protocolKind: "openai_compatible_chat_completions",
          model: "",
          apiKey: "sk-typed",
          apiKeyCleared: false,
        })}
      >
        编辑月之暗面表单
      </button>
      <button
        type="button"
        onClick={() => setApp((previous) => ({ ...previous, config: MOONSHOT_ACTIVATED_CONFIG }))}
      >
        激活月之暗面
      </button>
      <button
        type="button"
        onClick={() => setApp((previous) => ({ ...previous, config: OTHER_ACTIVATED_CONFIG }))}
      >
        激活其他厂商
      </button>
      <span data-testid="sync-profile">{configState.modelForm.profileId}</span>
      <span data-testid="sync-apikey">{configState.modelForm.apiKey}</span>
    </div>
  );
}

const PRESETS: ConfigResponse["modelProviderMarket"] = {
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
};

const START_CONFIG: ConfigResponse = {
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
  modelProviderMarket: PRESETS,
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
    START_CONFIG.config!,
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
  modelProviderMarket: PRESETS,
};

const OTHER_ACTIVATED_CONFIG: ConfigResponse = {
  ...MOONSHOT_ACTIVATED_CONFIG,
  config: {
    profileId: "other",
    label: "其他厂商",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://api.other.example.com/v1",
    defaultAiMode: "openai-compatible",
    enabled: true,
    secretConfigured: false,
  },
  profiles: [
    START_CONFIG.config!,
    {
      profileId: "other",
      label: "其他厂商",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.other.example.com/v1",
      defaultAiMode: "openai-compatible",
      enabled: true,
      secretConfigured: false,
    },
  ],
};
