import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ConfigResponse,
  ModelProviderModelCatalog,
} from "../contracts/config";
import { resolveModelIconSvg } from "../model-icons";
import { resolveModelProviderIdentity } from "../model-provider-logos";
import { EmptyBlock } from "./workspace-common";
import { ModelCatalogPanel } from "./model-catalog-panel";
import { removeRecordKey, useModelCatalogState } from "./model-catalog-state";
import { ModelProviderForm } from "./model-provider-form";
import { ProviderLogo } from "./model-settings-icons";
import { ModelProviderList } from "./model-provider-list";
import {
  modelFormFromProviderItem,
  modelProviderFormId,
  modelProviderItems,
  type ModelForm,
  type ModelProviderListItem,
  type ModelProviderModelItem,
  type ModelProviderProfileItem,
} from "./model-settings-projection";
export type { ModelForm } from "./model-settings-projection";

type ModelProviderProjectionDraft = {
  readonly createdProfiles: readonly ModelProviderProfileItem[];
  readonly removedProfileIds: readonly string[];
  readonly activeProfile?: ModelProviderProfileItem;
  readonly order?: readonly string[];
};

export function ModelSettings(props: {
  readonly config?: ConfigResponse;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly saving?: boolean;
  readonly onSave: (form?: ModelForm) => Promise<void>;
  readonly onCreateCustomProfile: (form?: ModelForm) => Promise<void>;
  readonly onReorderModelProviders: (order: readonly string[]) => Promise<void>;
  readonly onDeleteModelProvider: (profileId: string, fallbackProfileId?: string) => Promise<void>;
  readonly onFetchModels: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly onSaveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly onRevealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
}): React.ReactElement {
  const [providerDraft, setProviderDraft] = useState<ModelProviderProjectionDraft>({
    createdProfiles: [],
    removedProfileIds: [],
  });
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [fetchBusy, setFetchBusy] = useState(false);
  const [modelsFetchBusy, setModelsFetchBusy] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const fetchSeqRef = useRef(0);
  const providerOrderRef = useRef<readonly string[]>([]);
  const revealRef = useRef(props.onRevealModelApiKey);
  revealRef.current = props.onRevealModelApiKey;
  const modelFormRef = useRef(props.modelForm);
  modelFormRef.current = props.modelForm;
  const projectedConfig = useMemo(
    () => applyModelProviderProjectionDraft(props.config, providerDraft),
    [props.config, providerDraft]
  );
  const activeProfileId = projectedConfig?.config?.profileId ?? "";
  const providerItems = useMemo(() => modelProviderItems(projectedConfig), [projectedConfig]);
  const items = useMemo(() => providerItems.filter((item) => item.configured), [providerItems]);
  providerOrderRef.current = items.map((item) => item.key);
  const [selectedKey, setSelectedKey] = useState("");
  const filteredItems = items.filter((item) => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return true;
    return [item.title, item.model, item.baseUrl].some((value) => value.toLowerCase().includes(normalized));
  });
  const selectedItem =
    items.find((item) => item.key === selectedKey) ??
    items.find((item) => item.profileId === activeProfileId) ??
    items[0];
  const selectedActive = selectedItem?.profileId !== undefined && selectedItem.profileId === activeProfileId;
  const selectedSecretConfigured = selectedItem?.profile?.secretConfigured === true || (selectedActive && projectedConfig?.config?.secretConfigured === true);
  const selectedCatalog = selectedItem?.profileId === undefined ? undefined : props.modelCatalogs?.[selectedItem.profileId];
  const catalogState = useModelCatalogState({ selectedItem, selectedCatalog });
  const selectedProfileId = selectedItem?.profileId;
  const selectedModelIconSvg = selectedItem === undefined ? undefined : resolveModelIconSvg(resolveModelProviderIdentity(selectedItem));
  const hasKey = props.modelForm.apiKey.length > 0;
  const hasApiKeyAction = hasKey || selectedSecretConfigured;
  const addableItems = providerItems.filter((item) => !item.configured);

  useEffect(() => {
    setProviderDraft((previous) => reconcileModelProviderProjectionDraft(previous, props.config));
  }, [props.config]);

  useEffect(() => {
    if (items.length === 0) return;
    if (selectedKey.length > 0 && items.some((item) => item.key === selectedKey)) return;
    setSelectedKey(items.find((item) => item.profileId === activeProfileId)?.key ?? items[0]!.key);
  }, [activeProfileId, items, selectedKey]);

  useEffect(() => {
    if (selectedItem === undefined) return;
    const seq = ++fetchSeqRef.current;
    const nextForm = modelFormFromProviderItem(selectedItem);
    setRevealed(false);
    catalogState.setModelQuery("");
    catalogState.setSelectedModelRowId(nextForm.model.trim().length === 0 ? undefined : nextForm.model);
    props.setModelForm(nextForm);

    if (!selectedSecretConfigured || selectedProfileId === undefined) {
      setFetchBusy(false);
      return;
    }

    setFetchBusy(true);
    void revealRef.current(selectedProfileId).then((key) => {
      if (seq !== fetchSeqRef.current) return;
      setFetchBusy(false);
      if (typeof key === "string" && key.length > 0) {
        setRevealed(false);
        if (modelFormRef.current.profileId === nextForm.profileId && modelFormRef.current.apiKey.length === 0) {
          props.setModelForm({ ...modelFormRef.current, apiKey: key, apiKeyCleared: false });
        }
      }
    }).catch(() => {
      if (seq === fetchSeqRef.current) setFetchBusy(false);
    });
  }, [selectedItem?.key, selectedProfileId, selectedSecretConfigured]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function scheduleModelSave(nextForm: ModelForm): void {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      void props.onSave(nextForm).catch(() => undefined);
    }, 700);
  }

  async function saveModelImmediately(nextForm: ModelForm): Promise<void> {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    await props.onSave(nextForm);
  }

  function selectItem(item: ModelProviderListItem): void {
    setAddingProvider(false);
    setSelectedKey(item.key);
  }

  async function addProvider(item: ModelProviderListItem): Promise<void> {
    setAddingProvider(false);
    const nextForm = modelFormFromProviderItem(item);
    const nextProfile = profileFromProviderForm(item, nextForm, projectedConfig?.config?.defaultAiMode);
    const nextProfileId = nextProfile.profileId ?? nextForm.profileId;
    const nextKey = `profile:${nextProfileId}`;
    const previousOrder = providerOrderRef.current;
    const nextOrder = addProviderKey(providerOrderRef.current, item.key, nextKey);
    providerOrderRef.current = nextOrder;
    setSelectedKey(nextKey);
    props.setModelForm(nextForm);
    setProviderDraft((previous) => ({
      ...previous,
      createdProfiles: upsertProfileDraft(previous.createdProfiles, nextProfile),
      removedProfileIds: previous.removedProfileIds.filter((profileId) => profileId !== nextProfile.profileId),
      activeProfile: nextProfile,
      order: nextOrder,
    }));
    if (item.profileId !== undefined) return;
    try {
      await saveModelImmediately(nextForm);
      void props.onReorderModelProviders(providerOrderRef.current.length > 0 ? providerOrderRef.current : nextOrder).catch(() => {
        setProviderDraft((previous) => ({ ...previous, order: undefined }));
      });
    } catch {
      providerOrderRef.current = previousOrder;
      setProviderDraft((previous) => removeCreatedProfileDraft(previous, nextProfileId));
      setSelectedKey((current) => current === nextKey ? item.key : current);
      // The parent owns user-facing error state.
    }
  }

  async function addCustomProvider(): Promise<void> {
    setAddingProvider(false);
    const profileId = `custom_${Date.now().toString(36)}`;
    const nextForm: ModelForm = {
      profileId,
      label: "自定义厂商",
      baseUrl: "https://api.example.com/v1",
      protocolKind: "openai_compatible_chat_completions",
      model: "",
      apiKey: "",
      apiKeyCleared: false,
    };
    const nextProfile = profileFromModelForm(nextForm, "openai_compatible", projectedConfig?.config?.defaultAiMode);
    const nextKey = `profile:${profileId}`;
    const previousOrder = providerOrderRef.current;
    const nextOrder = addProviderKey(providerOrderRef.current, undefined, nextKey);
    providerOrderRef.current = nextOrder;
    setSelectedKey(nextKey);
    props.setModelForm(nextForm);
    setProviderDraft((previous) => ({
      ...previous,
      createdProfiles: upsertProfileDraft(previous.createdProfiles, nextProfile),
      removedProfileIds: previous.removedProfileIds.filter((removedProfileId) => removedProfileId !== profileId),
      activeProfile: nextProfile,
      order: nextOrder,
    }));
    try {
      await props.onCreateCustomProfile(nextForm);
      void props.onReorderModelProviders(providerOrderRef.current.length > 0 ? providerOrderRef.current : nextOrder).catch(() => {
        setProviderDraft((previous) => ({ ...previous, order: undefined }));
      });
    } catch {
      providerOrderRef.current = previousOrder;
      setProviderDraft((previous) => removeCreatedProfileDraft(previous, profileId));
      setSelectedKey((current) => current === nextKey ? "" : current);
      // The parent owns user-facing error state.
    }
  }

  async function reorderProviders(nextOrder: readonly string[]): Promise<void> {
    if (query.trim().length > 0 || sameStringList(providerOrderRef.current, nextOrder)) return;
    providerOrderRef.current = nextOrder;
    setProviderDraft((previous) => ({ ...previous, order: nextOrder }));
    try {
      await props.onReorderModelProviders(nextOrder);
    } catch {
      setProviderDraft((previous) => ({ ...previous, order: undefined }));
      // The parent owns user-facing error state.
    }
  }

  async function deleteProvider(item: ModelProviderListItem): Promise<void> {
    if (item.profileId === undefined) return;
    setAddingProvider(false);
    const deletingActive = item.profileId === activeProfileId;
    const fallbackItem = items.find((candidate) => candidate.key !== item.key);
    const fallbackProfile = deletingActive ? fallbackItem?.profile : undefined;
    if (deletingActive && fallbackProfile?.profileId === undefined) {
      try {
        await props.onDeleteModelProvider(item.profileId);
      } catch {
        // The parent owns user-facing error state.
      }
      return;
    }
    const previousOrder = providerOrderRef.current;
    const nextOrder = items.map((provider) => provider.key).filter((key) => key !== item.key);
    providerOrderRef.current = nextOrder;
    const wasSelected = selectedKey === item.key;
    setProviderDraft((previous) => ({
      ...previous,
      createdProfiles: previous.createdProfiles.filter((profile) => profile.profileId !== item.profileId),
      removedProfileIds: [...new Set([...previous.removedProfileIds, item.profileId!])],
      activeProfile: deletingActive
        ? fallbackProfile
        : previous.activeProfile?.profileId === item.profileId
          ? undefined
          : previous.activeProfile,
      order: nextOrder,
    }));
    if (wasSelected) {
      setSelectedKey(fallbackItem?.key ?? "");
    }
    try {
      await props.onDeleteModelProvider(item.profileId, deletingActive ? fallbackProfile?.profileId : undefined);
    } catch {
      providerOrderRef.current = previousOrder;
      setProviderDraft((previous) => ({
        ...previous,
        removedProfileIds: previous.removedProfileIds.filter((profileId) => profileId !== item.profileId),
        activeProfile: previous.activeProfile?.profileId === fallbackProfile?.profileId ? undefined : previous.activeProfile,
        order: previousOrder,
      }));
      if (wasSelected) {
        setSelectedKey((current) => current === (fallbackItem?.key ?? "") ? item.key : current);
      }
      // The parent owns user-facing error state.
    }
  }

  function updateModelForm(patch: Partial<ModelForm>): void {
    const nextForm = { ...props.modelForm, ...patch };
    props.setModelForm(nextForm);
    scheduleModelSave(nextForm);
  }

  async function clearApiKey(): Promise<void> {
    if (selectedItem === undefined) return;
    fetchSeqRef.current += 1;
    const nextForm = {
      ...props.modelForm,
      profileId: modelProviderFormId(selectedItem),
      apiKey: "",
      apiKeyCleared: selectedSecretConfigured || hasKey,
    };
    setRevealed(false);
    props.setModelForm(nextForm);
    if (selectedItem.profileId !== undefined || selectedSecretConfigured) {
      await saveModelImmediately(nextForm).catch(() => undefined);
      return;
    }
  }

  async function fetchSelectedModels(): Promise<void> {
    if (selectedItem === undefined) return;
    const profileId = selectedItem.profileId ?? modelProviderFormId(selectedItem);
    setModelsFetchBusy(true);
    try {
      if (selectedItem.profileId === undefined) {
        await props.onSave(props.modelForm);
      }
      const catalog = await props.onFetchModels(profileId);
      if (catalog !== undefined) {
        catalogState.setFetchedCatalogs((previous) => ({ ...previous, [catalog.profileId]: catalog }));
      }
    } catch {
      // The parent owns user-facing error state.
    } finally {
      setModelsFetchBusy(false);
    }
  }

  async function saveCatalogModels(models: readonly ModelProviderModelItem[]): Promise<void> {
    if (selectedItem?.profileId === undefined) return;
    const catalog = selectedCatalog ?? catalogState.fetchedCatalog ?? {
      profileId: selectedItem.profileId,
      label: selectedItem.title,
      baseUrl: selectedItem.baseUrl,
      modelsPath: "/models",
      fetchedAt: new Date().toISOString(),
      models: [],
    };
    await props.onSaveModelCatalog(selectedItem.profileId, {
      ...catalog,
      profileId: selectedItem.profileId,
      label: catalog.label ?? selectedItem.title,
      baseUrl: catalog.baseUrl || selectedItem.baseUrl,
      fetchedAt: new Date().toISOString(),
      models,
    });
  }

  async function addCatalogModel(model: ModelProviderModelItem): Promise<void> {
    if (selectedItem?.profileId === undefined) return;
    const profileId = selectedItem.profileId;
    const nextModels = [...catalogState.catalogModels.filter((item) => item.id !== model.id), model];
    try {
      await saveCatalogModels(nextModels);
    } catch {
      return;
    }
    catalogState.setFetchedCatalogs((previous) => {
      const current = previous[profileId];
      if (current === undefined) return previous;
      return {
        ...previous,
        [profileId]: {
          ...current,
          models: current.models.filter((item) => item.id !== model.id),
        },
      };
    });
  }

  async function removeCatalogModel(modelId: string): Promise<void> {
    const nextModels = catalogState.catalogModels.filter((model) => model.id !== modelId);
    try {
      await saveCatalogModels(nextModels);
    } catch {
      return;
    }
    if (props.modelForm.model === modelId) {
      const nextForm = { ...props.modelForm, model: "" };
      props.setModelForm(nextForm);
      catalogState.setSelectedModelRowId(undefined);
      await saveModelImmediately(nextForm).catch(() => undefined);
    }
  }

  function selectCatalogModel(modelId: string): void {
    catalogState.setSelectedModelRowId(modelId);
    if (props.modelForm.model === modelId) return;
    const nextForm = { ...props.modelForm, model: modelId };
    props.setModelForm(nextForm);
    void saveModelImmediately(nextForm).catch(() => undefined);
  }

  async function commitModelDisplayName(modelId: string, value: string): Promise<void> {
    const model = catalogState.catalogModels.find((item) => item.id === modelId);
    if (model === undefined) return;
    const displayName = value.trim().length === 0 ? model.id : value.trim();
    if (displayName === model.displayName) {
      catalogState.setModelNameDrafts((previous) => removeRecordKey(previous, modelId));
      return;
    }
    try {
      await saveCatalogModels(catalogState.catalogModels.map((item) => item.id === modelId ? { ...item, displayName } : item));
      catalogState.setModelNameDrafts((previous) => removeRecordKey(previous, modelId));
    } catch {
      // The parent owns user-facing error state.
    }
  }

  if (selectedItem === undefined) {
    return (
      <div className="settings-provider-manager empty">
        <EmptyBlock>暂无模型服务。请添加一个模型服务。</EmptyBlock>
      </div>
    );
  }

  return (
    <div className="settings-provider-manager">
      <ModelProviderList
        items={filteredItems}
        addableItems={addableItems}
        selectedItem={selectedItem}
        query={query}
        saving={props.saving}
        adding={addingProvider}
        reorderEnabled={query.trim().length === 0}
        onQueryChange={setQuery}
        onSelect={selectItem}
        onToggleAdding={() => setAddingProvider((value) => !value)}
        onCloseAdding={() => setAddingProvider(false)}
        onAddProvider={(item) => void addProvider(item)}
        onAddCustomProvider={() => void addCustomProvider()}
        onReorder={reorderProviders}
        onDeleteProvider={deleteProvider}
      />

      <section className="provider-detail-pane" aria-label="模型服务详情">
        <header className="provider-detail-header">
          <ProviderLogo item={selectedItem} large />
          <div>
            <h3>{selectedItem.title}</h3>
          </div>
        </header>

        <div className="provider-detail-divider" />

        <ModelProviderForm
          item={selectedItem}
          modelForm={props.modelForm}
          revealed={revealed}
          fetchBusy={fetchBusy}
          saving={props.saving}
          hasApiKeyAction={hasApiKeyAction}
          selectedSecretConfigured={selectedSecretConfigured}
          onSetRevealed={setRevealed}
          onUpdateModelForm={updateModelForm}
          onSetModelForm={props.setModelForm}
          onClearApiKey={clearApiKey}
          onScheduleModelSave={scheduleModelSave}
        />

        <ModelCatalogPanel
          catalogModels={catalogState.catalogModels}
          visibleCatalogModels={catalogState.visibleCatalogModels}
          fetchedCandidates={catalogState.fetchedCandidates}
          visibleFetchedCandidates={catalogState.visibleFetchedCandidates}
          fetched={catalogState.fetchedCatalog !== undefined}
          hasModelQuery={catalogState.hasModelQuery}
          showSavedCount={catalogState.showSavedCount}
          showModelSearch={catalogState.showModelSearch}
          modelQuery={catalogState.modelQuery}
          selectedModelRowId={catalogState.selectedModelRowId}
          modelNameDrafts={catalogState.modelNameDrafts}
          selectedModelIconSvg={selectedModelIconSvg}
          saving={props.saving}
          modelsFetchBusy={modelsFetchBusy}
          onModelQueryChange={catalogState.setModelQuery}
          onFetchModels={fetchSelectedModels}
          onSelectCatalogModel={selectCatalogModel}
          onModelNameDraftChange={(modelId, value) => catalogState.setModelNameDrafts((previous) => ({ ...previous, [modelId]: value }))}
          onCommitModelDisplayName={commitModelDisplayName}
          onRemoveCatalogModel={removeCatalogModel}
          onAddCatalogModel={addCatalogModel}
        />
      </section>
    </div>
  );
}

function applyModelProviderProjectionDraft(
  config: ConfigResponse | undefined,
  draft: ModelProviderProjectionDraft
): ConfigResponse | undefined {
  if (
    config === undefined ||
    (draft.createdProfiles.length === 0 &&
      draft.removedProfileIds.length === 0 &&
      draft.activeProfile === undefined &&
      draft.order === undefined)
  ) {
    return config;
  }
  const removedProfileIds = new Set(draft.removedProfileIds);
  const profiles = new Map<string, ModelProviderProfileItem>();
  for (const profile of config.profiles ?? []) {
    if (profile.profileId !== undefined && !removedProfileIds.has(profile.profileId)) {
      profiles.set(profile.profileId, profile);
    }
  }
  for (const profile of draft.createdProfiles) {
    if (profile.profileId !== undefined && !removedProfileIds.has(profile.profileId)) {
      profiles.set(profile.profileId, profile);
    }
  }
  const nextProfiles = [...profiles.values()];
  const currentProfileId = config.config?.profileId;
  const currentConfigRemoved = currentProfileId !== undefined && removedProfileIds.has(currentProfileId);
  const activeProfile =
    draft.activeProfile ??
    (currentConfigRemoved ? nextProfiles[0] : config.config) ??
    nextProfiles[0];
  return {
    ...config,
    config: activeProfile,
    profile: activeProfile,
    profiles: nextProfiles,
    modelProviderOrder: draft.order ?? config.modelProviderOrder,
    modelCatalogs: config.modelCatalogs?.filter((catalog) => !removedProfileIds.has(catalog.profileId)),
  };
}

function reconcileModelProviderProjectionDraft(
  draft: ModelProviderProjectionDraft,
  config: ConfigResponse | undefined
): ModelProviderProjectionDraft {
  if (config === undefined) return draft;
  const serverProfileIds = new Set((config.profiles ?? []).map((profile) => profile.profileId).filter(isDefinedString));
  const nextCreatedProfiles = draft.createdProfiles.filter((profile) => profile.profileId === undefined || !serverProfileIds.has(profile.profileId));
  const nextRemovedProfileIds = draft.removedProfileIds.filter((profileId) => serverProfileIds.has(profileId));
  const nextActiveProfile = draft.activeProfile?.profileId === config.config?.profileId ? undefined : draft.activeProfile;
  const nextOrder = sameStringList(draft.order, config.modelProviderOrder) ? undefined : draft.order;
  if (
    sameProfileList(nextCreatedProfiles, draft.createdProfiles) &&
    sameStringList(nextRemovedProfileIds, draft.removedProfileIds) &&
    nextActiveProfile === draft.activeProfile &&
    nextOrder === draft.order
  ) {
    return draft;
  }
  return {
    createdProfiles: nextCreatedProfiles,
    removedProfileIds: nextRemovedProfileIds,
    activeProfile: nextActiveProfile,
    order: nextOrder,
  };
}

function profileFromProviderForm(
  item: ModelProviderListItem,
  form: ModelForm,
  defaultAiMode: ModelProviderProfileItem["defaultAiMode"] | undefined
): ModelProviderProfileItem {
  return profileFromModelForm(
    form,
    item.profile?.providerKind ?? item.preset?.providerKind ?? "openai_compatible",
    defaultAiMode
  );
}

function profileFromModelForm(
  form: ModelForm,
  providerKind: string,
  defaultAiMode: ModelProviderProfileItem["defaultAiMode"] | undefined
): ModelProviderProfileItem {
  return {
    profileId: form.profileId,
    label: form.label.trim() || form.profileId,
    providerKind,
    protocolKind: form.protocolKind || "openai_compatible_chat_completions",
    baseUrl: form.baseUrl,
    model: form.model,
    defaultAiMode,
    secretConfigured: form.apiKey.length > 0 ? true : undefined,
  };
}

function upsertProfileDraft(
  profiles: readonly ModelProviderProfileItem[],
  nextProfile: ModelProviderProfileItem
): readonly ModelProviderProfileItem[] {
  return [
    ...profiles.filter((profile) => profile.profileId !== nextProfile.profileId),
    nextProfile,
  ];
}

function removeCreatedProfileDraft(
  draft: ModelProviderProjectionDraft,
  profileId: string
): ModelProviderProjectionDraft {
  const profileKey = `profile:${profileId}`;
  const order = draft.order?.filter((key) => key !== profileKey);
  return {
    ...draft,
    createdProfiles: draft.createdProfiles.filter((profile) => profile.profileId !== profileId),
    activeProfile: draft.activeProfile?.profileId === profileId ? undefined : draft.activeProfile,
    order: order === undefined || order.length === 0 ? undefined : order,
  };
}

function addProviderKey(
  currentKeys: readonly string[],
  previousKey: string | undefined,
  nextKey: string
): readonly string[] {
  const withoutAddedKey = currentKeys.filter((key) => key !== nextKey && key !== previousKey);
  return [...withoutAddedKey, nextKey];
}

function sameStringList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameProfileList(
  left: readonly ModelProviderProfileItem[],
  right: readonly ModelProviderProfileItem[]
): boolean {
  return left.length === right.length && left.every((profile, index) => profile === right[index]);
}

function isDefinedString(value: string | undefined): value is string {
  return value !== undefined;
}
