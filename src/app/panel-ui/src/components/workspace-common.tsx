import React from "react";
import { Search } from "lucide-react";

export function PageHeader(props: { readonly title: string; readonly subtitle?: string; readonly actions?: React.ReactNode }): React.ReactElement {
  return (
    <header className="workspace-page-header">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      {props.actions && <div>{props.actions}</div>}
    </header>
  );
}

export function SearchBox(props: { readonly value: string; readonly onChange: (value: string) => void; readonly placeholder: string }): React.ReactElement {
  return (
    <label className="workspace-search">
      <Search size={14} />
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} />
    </label>
  );
}

export function TabBar<T extends string>(props: { readonly tabs: readonly T[]; readonly activeTab: T; readonly onChange: (tab: T) => void }): React.ReactElement {
  return (
    <div className="workspace-tabs">
      {props.tabs.map((tab) => (
        <button type="button" className={props.activeTab === tab ? "active" : ""} onClick={() => props.onChange(tab)} key={tab}>
          {tab}
        </button>
      ))}
    </div>
  );
}

export function EmptyBlock({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <div className="workspace-empty">{children}</div>;
}

export function IconTile({ icon }: { readonly icon: React.ReactNode }): React.ReactElement {
  return <div className="icon-tile">{icon}</div>;
}

export function Toggle(props: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly label: string }): React.ReactElement {
  return (
    <button type="button" className={`toggle ${props.checked ? "checked" : ""}`} aria-label={props.label} aria-pressed={props.checked} onClick={() => props.onChange(!props.checked)}>
      <span />
    </button>
  );
}

export function Pill(props: { readonly tone: "success" | "neutral" | "warning"; readonly children: React.ReactNode }): React.ReactElement {
  return <span className={`pill ${props.tone}`}>{props.children}</span>;
}

export function SettingRow(props: { readonly label: string; readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div className="settings-row">
      <span>{props.label}</span>
      <div>{props.children}</div>
    </div>
  );
}
