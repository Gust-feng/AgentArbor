import React from "react";
import { Plus, Search } from "lucide-react";
import type { ModelProviderListItem } from "./model-settings-projection";
import { ProviderLogo } from "./model-settings-icons";

export function ModelProviderList(props: {
  readonly items: readonly ModelProviderListItem[];
  readonly selectedItem: ModelProviderListItem;
  readonly query: string;
  readonly saving?: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onSelect: (item: ModelProviderListItem) => void;
  readonly onCreateCustomProfile: () => void;
}): React.ReactElement {
  return (
    <aside className="provider-list-pane" aria-label="模型服务">
      <label className="provider-search">
        <Search size={16} />
        <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索" />
      </label>
      <div className="provider-list">
        {props.items.map((item) => {
          const selected = item.key === props.selectedItem.key;
          return (
            <article className={`provider-row ${selected ? "selected" : ""}`} key={item.key}>
              <button type="button" className="provider-row-main" onClick={() => props.onSelect(item)}>
                <ProviderLogo item={item} />
                <span>
                  <strong>{item.title}</strong>
                </span>
              </button>
            </article>
          );
        })}
      </div>
      <button type="button" className="provider-add-button" onClick={props.onCreateCustomProfile} disabled={props.saving}>
        <Plus size={16} />
        添加
      </button>
    </aside>
  );
}
