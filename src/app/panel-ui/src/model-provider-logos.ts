import anthropicLogo from "./assets/providers/anthropic.svg?raw";
import deepseekLogo from "./assets/providers/deepseek.svg?raw";
import kimiLogo from "./assets/providers/kimi.svg?raw";
import minimaxLogo from "./assets/providers/minimax.svg?raw";
import modelProviderLogo from "./assets/providers/model-provider.svg?raw";
import openaiLogo from "./assets/providers/openai.svg?raw";
import zaiLogo from "./assets/providers/zai.svg?raw";
import { decorativeSvg } from "./icon-svg";

const providerLogos = {
  anthropic: decorativeSvg(anthropicLogo),
  deepseek: decorativeSvg(deepseekLogo),
  kimi: decorativeSvg(kimiLogo),
  minimax: decorativeSvg(minimaxLogo),
  modelProvider: decorativeSvg(modelProviderLogo),
  openai: decorativeSvg(openaiLogo),
  zai: decorativeSvg(zaiLogo),
} as const;

export type ModelProviderLogoInput = {
  readonly title?: string;
  readonly vendor?: string;
  readonly profileId?: string;
  readonly presetId?: string;
  readonly baseUrl?: string;
  readonly model?: string;
};

export type ModelProviderLogo = {
  readonly svg: string;
  readonly tone: string;
};

export type ModelProviderIdentity = "openai" | "claude" | "deepseek" | "kimi" | "glm" | "minimax" | "unknown";

export function modelProviderDisplayName(identity: Exclude<ModelProviderIdentity, "unknown">): string {
  if (identity === "openai") return "OpenAI";
  if (identity === "claude") return "Anthropic";
  if (identity === "deepseek") return "DeepSeek";
  if (identity === "kimi") return "月之暗面";
  if (identity === "glm") return "智谱 AI";
  return "MiniMax";
}

export function resolveModelProviderIdentity(input: ModelProviderLogoInput): ModelProviderIdentity {
  const baseUrl = normalizeProviderSignal(input.baseUrl);
  const model = normalizeProviderSignal(input.model);
  const explicitProvider = normalizeProviderSignal([input.presetId, input.vendor].filter(Boolean).join(" "));
  const displayText = normalizeProviderSignal([input.title, input.profileId].filter(Boolean).join(" "));

  const strongSignal = resolveStrongProviderSignal(baseUrl) ?? resolveStrongProviderSignal(explicitProvider);
  if (strongSignal !== undefined) return strongSignal;

  const displaySignal = resolveStrongProviderSignal(displayText);
  if (displaySignal !== undefined) return displaySignal;

  return resolveStrongProviderSignal(model) ?? "unknown";
}

function normalizeProviderSignal(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveStrongProviderSignal(value: string): Exclude<ModelProviderIdentity, "unknown"> | undefined {
  if (value.includes("api.openai.com") || value.includes("openai") || value.includes("chatgpt")) return "openai";
  if (value.includes("anthropic") || value.includes("claude")) return "claude";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("moonshot") || value.includes("kimi") || value.includes("月之暗面")) return "kimi";
  if (value.includes("bigmodel") || value.includes("zhipu") || value.includes("glm") || value.includes("智谱")) return "glm";
  if (value.includes("minimax") || value.includes("minimaxi")) return "minimax";
  return undefined;
}

export function modelProviderSortRank(input: ModelProviderLogoInput): number {
  const identity = resolveModelProviderIdentity(input);
  if (identity === "openai") return 0;
  if (identity === "claude") return 1;
  if (identity === "deepseek") return 2;
  if (identity === "kimi") return 3;
  if (identity === "glm") return 4;
  if (identity === "minimax") return 5;
  return 99;
}

export function resolveModelProviderLogo(input: ModelProviderLogoInput): ModelProviderLogo {
  const identity = resolveModelProviderIdentity(input);
  if (identity === "openai") return { svg: providerLogos.openai, tone: "openai" };
  if (identity === "claude") return { svg: providerLogos.anthropic, tone: "claude" };
  if (identity === "deepseek") return { svg: providerLogos.deepseek, tone: "deepseek" };
  if (identity === "kimi") return { svg: providerLogos.kimi, tone: "kimi" };
  if (identity === "glm") return { svg: providerLogos.zai, tone: "glm" };
  if (identity === "minimax") return { svg: providerLogos.minimax, tone: "minimax" };
  return { svg: providerLogos.modelProvider, tone: "default" };
}
