import { describe, expect, test } from "vitest";
import type { ConfigResponse, ModelProviderModelCatalog } from "./contracts/config";
import { resolveModelIconSvg } from "./model-icons";
import { modelOptionsFromConfig } from "./model-options";

describe("modelOptionsFromConfig", () => {
  test("keeps capability-only models out of composer options unless requested", () => {
    const config: ConfigResponse = {
      config: {
        profileId: "profile-openai",
        label: "OpenAI",
        model: "configured-model",
      },
      profiles: [
        {
          profileId: "profile-openai",
          label: "OpenAI",
          model: "configured-model",
          defaultAiMode: "openai-responses",
          enabled: true,
          secretConfigured: true,
        },
      ],
      modelCapabilityProfiles: [
        {
          profileId: "profile-openai",
          model: "retired-model",
          capabilities: { contextWindowTokens: 123_000 },
        },
      ],
    };
    const catalogs: Record<string, ModelProviderModelCatalog> = {
      "profile-openai": {
        profileId: "profile-openai",
        label: "OpenAI",
        baseUrl: "https://api.example.test",
        modelsPath: "/models",
        fetchedAt: "2026-07-29T00:00:00.000Z",
        models: [
          {
            id: "catalog-model",
            displayName: "Catalog Model",
          },
        ],
      },
    };

    expect(modelOptionsFromConfig(config, catalogs).map((option) => option.modelId)).toEqual([
      "configured-model",
      "catalog-model",
    ]);
    expect(
      modelOptionsFromConfig(config, catalogs, { includeCapabilityProfileModels: true }).map((option) => option.modelId)
    ).toEqual([
      "configured-model",
      "catalog-model",
      "retired-model",
    ]);
  });

  test("keeps unconfigured provider presets out of the model picker", () => {
    const config: ConfigResponse = {
      profiles: [
        {
          profileId: "moonshot",
          label: "月之暗面",
          model: "kimi-k3",
          defaultAiMode: "openai-compatible",
          enabled: true,
          secretConfigured: false,
        },
        {
          profileId: "glm",
          label: "智谱 AI",
          model: "glm-5.1",
          defaultAiMode: "openai-compatible",
          enabled: true,
          secretConfigured: false,
        },
      ],
    };

    expect(modelOptionsFromConfig(config, {})).toEqual([]);
  });

  test("uses model-family icons immediately for configured profiles", () => {
    const config: ConfigResponse = {
      profiles: [
        {
          profileId: "moonshot",
          label: "月之暗面",
          model: "kimi-k3",
          defaultAiMode: "openai-compatible",
          enabled: true,
          secretConfigured: true,
        },
      ],
    };

    const [option] = modelOptionsFromConfig(config, {});
    expect(option?.modelId).toBe("kimi-k3");
    expect(option?.providerIdentity).toBe("kimi");
    expect(option?.iconSvg).toBe(resolveModelIconSvg("kimi"));
  });
});
