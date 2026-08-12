import {
  resolveModelFamilyIdentity,
  type ModelFamilyIdentity,
} from "../../model-visuals/model-family";
import claudeModelIcon from "../../model-visuals/model-icons/claude_model_icon.svg?raw";
import deepseekModelIcon from "../../model-visuals/model-icons/deepseek_model_icon.svg?raw";
import glmModelIcon from "../../model-visuals/model-icons/glm.svg?raw";
import kimiModelIcon from "../../model-visuals/model-icons/kimi_model_icon.svg?raw";
import minimaxModelIcon from "../../model-visuals/model-icons/minimax_model_icon.svg?raw";
import openaiModelIcon from "../../model-visuals/model-icons/chatgpt_gpt_model_icon.svg?raw";

export type MobileModelFamily = ModelFamilyIdentity;

export type MobileModelIcon = {
  readonly family: MobileModelFamily;
  readonly svg?: string;
};

const modelSvgs: Readonly<Record<Exclude<MobileModelFamily, "unknown">, string>> = {
  openai: decorativeSvg(openaiModelIcon),
  claude: decorativeSvg(claudeModelIcon),
  deepseek: decorativeSvg(deepseekModelIcon),
  kimi: decorativeSvg(kimiModelIcon),
  glm: decorativeSvg(glmModelIcon),
  minimax: decorativeSvg(minimaxModelIcon),
};

export function resolveMobileModelIcon(input: {
  readonly label: string;
  readonly providerLabel?: string;
}): MobileModelIcon {
  const family = resolveModelFamilyIdentity({
    displayName: input.label,
    model: input.providerLabel,
  });
  return family === "unknown" ? { family } : { family, svg: modelSvgs[family] };
}

export function mobileModelInitial(input: {
  readonly label: string;
  readonly providerLabel?: string;
}): string {
  const source = input.providerLabel?.trim() || input.label.trim() || "M";
  return Array.from(source)[0]?.toLocaleUpperCase() ?? "M";
}

function decorativeSvg(svg: string): string {
  const withoutMetadata = svg
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/gi, "")
    .replace(/\saria-labelledby="[^"]*"/gi, "")
    .replace(/\srole="img"/gi, "");

  return withoutMetadata.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    const cleanAttrs = attrs
      .replace(/\saria-hidden="[^"]*"/gi, "")
      .replace(/\sfocusable="[^"]*"/gi, "")
      .trimEnd();
    return `<svg${cleanAttrs} aria-hidden="true" focusable="false">`;
  });
}
