import { expect, test } from "vitest";
import { resolveModelProviderIdentity, resolveModelProviderLogo } from "./model-provider-logos";

test("custom provider identity is not inferred from a shared built-in endpoint", () => {
  const provider = {
    profileId: "team-router-a",
    baseUrl: "https://api.openai.com/v1",
  };

  expect(resolveModelProviderIdentity(provider)).toBe("unknown");
  expect(resolveModelProviderLogo(provider).tone).toBe("default");
});

test("each custom provider keeps its own uploaded image even when endpoints match", () => {
  const first = resolveModelProviderLogo({
    profileId: "team-router-a",
    baseUrl: "https://api.openai.com/v1",
    logoDataUrl: "data:image/png;base64,AAA",
  });
  const second = resolveModelProviderLogo({
    profileId: "team-router-b",
    baseUrl: "https://api.openai.com/v1",
    logoDataUrl: "data:image/png;base64,BBB",
  });

  expect(first.imageSrc).toBe("data:image/png;base64,AAA");
  expect(second.imageSrc).toBe("data:image/png;base64,BBB");
});
