import type { ModelProviderPreset } from "./contracts.js";

export const BUILTIN_MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  {
    presetId: "deepseek",
    label: "DeepSeek",
    vendor: "DeepSeek",
    description: "DeepSeek OpenAI-compatible 接口，适合通用对话、代码和工具调用场景。",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://api.deepseek.com",
    modelsPath: "/models",
    defaultModel: "deepseek-chat",
    regionLabel: "全球",
    docsUrl: "https://api-docs.deepseek.com/",
  },
  {
    presetId: "moonshot",
    label: "月之暗面",
    vendor: "Moonshot AI",
    description: "月之暗面 Kimi 国内 OpenAI-compatible 接口。",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://api.moonshot.cn/v1",
    modelsPath: "/models",
    defaultModel: "kimi-k2.6",
    regionLabel: "国内",
    docsUrl: "https://platform.moonshot.cn/docs/guide/start-using-kimi-api",
  },
  {
    presetId: "glm",
    label: "智谱 GLM",
    vendor: "智谱 AI",
    description: "智谱 BigModel GLM OpenAI-compatible 接口。",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelsPath: "/models",
    defaultModel: "glm-4.5",
    regionLabel: "国内",
    docsUrl: "https://docs.bigmodel.cn/",
  },
  {
    presetId: "minimax",
    label: "MiniMax",
    vendor: "MiniMax",
    description: "MiniMax 国内 OpenAI-compatible 接口。",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://api.minimaxi.com/v1",
    modelsPath: "/models",
    defaultModel: "MiniMax-M2",
    regionLabel: "国内",
    docsUrl: "https://platform.minimax.io/docs/api-reference/text-chat-openai",
  },
];

export function listBuiltinModelProviderPresets(): readonly ModelProviderPreset[] {
  return BUILTIN_MODEL_PROVIDER_PRESETS.map((preset) => ({ ...preset }));
}

