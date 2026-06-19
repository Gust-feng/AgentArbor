import React from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import type { ModelForm, ModelProviderListItem } from "./model-settings-projection";
import { requestPathOptionsForProvider } from "./model-settings-projection";

export function ModelProviderForm(props: {
  readonly item: ModelProviderListItem;
  readonly modelForm: ModelForm;
  readonly revealed: boolean;
  readonly fetchBusy: boolean;
  readonly saving?: boolean;
  readonly hasApiKeyAction: boolean;
  readonly selectedSecretConfigured: boolean;
  readonly onSetRevealed: (value: boolean) => void;
  readonly onUpdateModelForm: (patch: Partial<ModelForm>) => void;
  readonly onSetModelForm: (form: ModelForm) => void;
  readonly onClearApiKey: () => Promise<void>;
  readonly onScheduleModelSave: (form: ModelForm) => void;
}): React.ReactElement {
  return (
    <div className="provider-form">
      <label>
        <span>API Key</span>
        <div className="api-key-field">
          <input
            type={props.revealed ? "text" : "password"}
            className={props.revealed ? undefined : "api-key-input-masked"}
            value={props.modelForm.apiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              const nextApiKey = event.target.value;
              const nextForm = {
                ...props.modelForm,
                apiKey: nextApiKey,
                apiKeyCleared: nextApiKey.length === 0 && props.selectedSecretConfigured,
              };
              props.onSetModelForm(nextForm);
              props.onScheduleModelSave(nextForm);
            }}
            placeholder={props.fetchBusy ? "加载中…" : "请输入密钥"}
          />
          <span className="api-key-actions">
            <button
              type="button"
              className="api-key-action"
              aria-label={props.revealed ? "隐藏 API Key" : "查看 API Key"}
              disabled={!props.hasApiKeyAction || props.fetchBusy || props.saving}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => props.onSetRevealed(!props.revealed)}
            >
              {props.revealed ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              type="button"
              className="api-key-action"
              aria-label="清空 API Key"
              disabled={!props.hasApiKeyAction || props.saving}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => void props.onClearApiKey()}
            >
              <Trash2 size={15} />
            </button>
          </span>
        </div>
      </label>
      <label>
        <span>Base URL</span>
        <div className="provider-base-url-field">
          <input
            value={props.modelForm.baseUrl || props.item.baseUrl}
            onChange={(event) => {
              props.onUpdateModelForm({ baseUrl: event.target.value });
            }}
            placeholder="https://api.example.com/v1"
          />
        </div>
      </label>
      {props.item.preset === undefined && (
        <details className="provider-advanced-options">
          <summary>高级兼容设置</summary>
          <label>
            <span>协议</span>
            <select
              value={props.modelForm.protocolKind || props.item.protocolKind}
              aria-label="协议"
              onChange={(event) => props.onUpdateModelForm({ protocolKind: event.target.value })}
            >
              {requestPathOptionsForProvider(props.item).map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </details>
      )}
    </div>
  );
}
