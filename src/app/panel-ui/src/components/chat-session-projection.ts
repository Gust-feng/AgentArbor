import { resolveModelIconSvgForModel } from "../model-icons";
import { resolveModelProviderIdentity, type ModelProviderIdentity } from "../model-provider-logos";
import type { ConversationTurn } from "../contracts/conversation";
import type { ChatModelOption } from "./chat-empty";

export type AssistantModelBadge = {
  readonly modelName: string;
  readonly providerLabel: string;
  readonly providerIdentity: ModelProviderIdentity;
  readonly iconSvg?: string;
};

export function assistantModelForTurn(
  turn: ConversationTurn,
  models: readonly ChatModelOption[],
  selectedModelId: string
): AssistantModelBadge | undefined {
  if (turn.responseModel !== undefined) {
    if (isSyntheticResponseModel(turn)) {
      return undefined;
    }
    const matched = models.find(
      (model) =>
        model.profileId === turn.responseModel?.profileId &&
        model.modelId === turn.responseModel?.model
    );
    if (matched !== undefined) {
      return modelBadgeFromOption(matched);
    }
    const identity = resolveModelProviderIdentity({
      title: turn.responseModel.label,
      profileId: turn.responseModel.profileId,
      baseUrl: turn.responseModel.baseUrl,
      model: turn.responseModel.model,
    });
    return {
      modelName: turn.responseModel.model ?? turn.responseModel.label ?? "模型",
      providerLabel: turn.responseModel.label ?? "模型",
      providerIdentity: identity,
      iconSvg: resolveModelIconSvgForModel({
        providerIdentity: identity,
        modelId: turn.responseModel.model,
        displayName: turn.responseModel.label,
      }),
    };
  }
  return selectedComposerModel(models, selectedModelId);
}

export function selectedComposerModel(
  models: readonly ChatModelOption[],
  selectedModelId: string
): AssistantModelBadge | undefined {
  const selected = models.find((model) => model.id === selectedModelId);
  return selected === undefined ? undefined : modelBadgeFromOption(selected);
}

function isSyntheticResponseModel(turn: ConversationTurn): boolean {
  const profileId = turn.responseModel?.profileId?.trim().toLowerCase() ?? "";
  const model = turn.responseModel?.model?.trim().toLowerCase() ?? "";
  const providerKind = turn.responseModel?.providerKind?.trim().toLowerCase() ?? "";
  return profileId === "default" && model.length === 0 ||
    profileId === "fake" ||
    profileId === "none" ||
    model === "fake" ||
    model === "none" ||
    providerKind === "fake" ||
    providerKind === "none";
}

function modelBadgeFromOption(model: ChatModelOption): AssistantModelBadge {
  return {
    modelName: model.name,
    providerLabel: model.providerLabel,
    providerIdentity: model.providerIdentity,
    iconSvg: model.iconSvg,
  };
}
