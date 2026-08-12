import type {
  ModelCapabilityOverrideSettings,
  ModelProviderModelCatalog,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { resolveModelCapabilities } from "../model-runtime/model-capability-registry.js";
import type { RemoteEvent } from "../remote-collaboration/index.js";

export type RemoteModelOption = NonNullable<Extract<RemoteEvent, { readonly kind: "conversation.index" }>["modelOptions"]>[number];

export function projectRemoteModelOptions(input: {
  readonly profiles: readonly SanitizedModelProviderConfig[];
  readonly catalogs: readonly ModelProviderModelCatalog[];
  readonly active: SanitizedModelProviderConfig;
  readonly capabilityOverrides: readonly ModelCapabilityOverrideSettings[];
}): RemoteModelOption[] {
  const catalogByProfile = new Map(input.catalogs.map((catalog) => [catalog.profileId, catalog]));
  return input.profiles.flatMap((profile) => {
    if (profile.enabled === false) return [];
    const catalog = catalogByProfile.get(profile.profileId);
    const models = new Map<string, string>();
    if (profile.model !== undefined) models.set(profile.model, profile.model);
    for (const model of catalog?.models ?? []) models.set(model.id, model.displayName || model.id);
    return [...models.entries()].flatMap(([model, label]) => {
      const id = encodeRemoteModelSelectionId(profile.profileId, model);
      if (id.length > 160) return [];
      const capabilities = resolveModelCapabilities({ profile: { ...profile, model }, overrides: input.capabilityOverrides });
      return [{
        id,
        label,
        ...(profile.label === undefined ? {} : { providerLabel: profile.label }),
        supportsTools: capabilities.supportsToolCalling,
        supportsVision: capabilities.supportsVisionInput,
        isDefault: profile.profileId === input.active.profileId && model === input.active.model,
      }];
    });
  }).slice(0, 256);
}

export function resolveRemoteModelSelection(
  options: readonly RemoteModelOption[],
  selectionId: string,
): { readonly profileId: string; readonly model: string } | undefined {
  if (!options.some((option) => option.id === selectionId)) return undefined;
  return decodeRemoteModelSelectionId(selectionId);
}

function encodeRemoteModelSelectionId(profileId: string, model: string): string {
  return JSON.stringify([profileId, model]);
}

function decodeRemoteModelSelectionId(value: string): { readonly profileId: string; readonly model: string } | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") return undefined;
    if (parsed[0].trim().length === 0 || parsed[1].trim().length === 0) return undefined;
    return { profileId: parsed[0], model: parsed[1] };
  } catch {
    return undefined;
  }
}
