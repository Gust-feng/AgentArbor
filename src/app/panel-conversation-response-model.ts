import type { SanitizedModelProviderConfig } from "../domain/config/index.js";
import type { PanelConversationTurnModel } from "./panel-conversation-contracts.js";
import { turnModelFromConfig } from "./panel-conversation-projection.js";

export type ConversationModelCallIdentity = {
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly model?: string;
};

export function turnModelFromConfigAndModelCall(
  config: SanitizedModelProviderConfig,
  call: ConversationModelCallIdentity | undefined
): PanelConversationTurnModel {
  return turnModelFromConcreteModelCall(call) ?? {
    ...turnModelFromConfig(config),
    model: nonEmpty(call?.model) ?? config.model,
  };
}

export function turnModelFromModelCallFallback(
  call: ConversationModelCallIdentity | undefined,
  fallbackProfileId: string
): PanelConversationTurnModel | undefined {
  const concrete = turnModelFromConcreteModelCall(call);
  if (concrete !== undefined) {
    return concrete;
  }
  const model = nonEmpty(call?.model);
  if (model === undefined) {
    return undefined;
  }
  const providerKind = nonEmpty(call?.providerKind);
  return {
    profileId: providerKind ?? fallbackProfileId,
    providerKind,
    protocolKind: nonEmpty(call?.protocolKind),
    model,
  };
}

function turnModelFromConcreteModelCall(
  call: ConversationModelCallIdentity | undefined
): PanelConversationTurnModel | undefined {
  const model = nonEmpty(call?.model);
  const providerKind = nonEmpty(call?.providerKind);
  if (model === undefined || providerKind?.toLowerCase() !== "fake") {
    return undefined;
  }
  return {
    profileId: "fake",
    label: "Fake",
    providerKind: "fake",
    protocolKind: nonEmpty(call?.protocolKind),
    model,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
