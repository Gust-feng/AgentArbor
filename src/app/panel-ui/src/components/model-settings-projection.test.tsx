import { expect, test } from "vitest";
import { modelProviderItems } from "./model-settings-projection";

test("custom provider objects retain their own labels and logos when they share a preset endpoint", () => {
  const items = modelProviderItems({
    config: { profileId: "router-a" },
    profiles: [
      profile("router-a", "团队路由 A", "data:image/png;base64,AAA"),
      profile("router-b", "团队路由 B", "data:image/png;base64,BBB"),
    ],
    modelProviderMarket: {
      presets: [preset("openai", "https://api.openai.com/v1")],
    },
  });

  expect(items.map((item) => ({ key: item.key, title: item.title, logoDataUrl: item.logoDataUrl }))).toEqual([
    { key: "preset:openai", title: "OpenAI", logoDataUrl: undefined },
    { key: "profile:router-a", title: "团队路由 A", logoDataUrl: "data:image/png;base64,AAA" },
    { key: "profile:router-b", title: "团队路由 B", logoDataUrl: "data:image/png;base64,BBB" },
  ]);
});

function profile(profileId: string, label: string, logoDataUrl: string) {
  return {
    profileId,
    label,
    logoDataUrl,
    providerKind: "openai_compatible" as const,
    protocolKind: "openai_compatible_chat_completions" as const,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
  };
}

function preset(presetId: string, baseUrl: string) {
  return {
    presetId,
    label: "OpenAI",
    vendor: "OpenAI",
    description: "OpenAI",
    providerKind: "openai_compatible" as const,
    protocolKind: "openai_responses" as const,
    baseUrl,
    modelsPath: "/models",
  };
}
