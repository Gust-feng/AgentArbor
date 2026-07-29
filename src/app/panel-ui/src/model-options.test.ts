import { describe, expect, test } from "vitest";
import type { ConfigResponse, ModelProviderModelCatalog } from "./contracts/config";
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
});
