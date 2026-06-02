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
} from "./model-settings-projection";
export type { ModelForm } from "./model-settings-projection";

export function ModelSettings(props: {
  readonly config?: ConfigResponse;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly saving?: boolean;
  readonly onSave: (form?: ModelForm) => Promise<void>;
  readonly onCreateCustomProfile: () => void;
  readonly onFetchModels: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly onSaveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly onRevealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [fetchBusy, setFetchBusy] = useState(false);
  const [modelsFetchBusy, setModelsFetchBusy] = useState(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const fetchSeqRef = useRef(0);
  const revealRef = useRef(props.onRevealModelApiKey);
  revealRef.current = props.onRevealModelApiKey;
  const modelFormRef = useRef(props.modelForm);
  modelFormRef.current = props.modelForm;
  const activeProfileId = props.config?.config?.profileId ?? "";
  const items = useMemo(() => modelProviderItems(props.config), [props.config]);
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
  const selectedSecretConfigured = selectedItem?.profile?.secretConfigured === true || (selectedActive && props.config?.config?.secretConfigured === true);
  const selectedCatalog = selectedItem?.profileId === undefined ? undefined : props.modelCatalogs?.[selectedItem.profileId];
  const catalogState = useModelCatalogState({ selectedItem, selectedCatalog });
  const selectedProfileId = selectedItem?.profileId;
  const selectedModelIconSvg = selectedItem === undefined ? undefined : resolveModelIconSvg(resolveModelProviderIdentity(selectedItem));
  const hasKey = props.modelForm.apiKey.length > 0;
  const hasApiKeyAction = hasKey || selectedSecretConfigured;

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
    setSelectedKey(item.key);
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
        selectedItem={selectedItem}
        query={query}
        saving={props.saving}
        onQueryChange={setQuery}
        onSelect={selectItem}
        onCreateCustomProfile={props.onCreateCustomProfile}
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
