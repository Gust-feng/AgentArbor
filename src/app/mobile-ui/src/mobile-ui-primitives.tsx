import type { ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

export function IconButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly ariaControls?: string;
  readonly ariaExpanded?: boolean;
  readonly ariaHasPopup?: "menu" | "dialog" | boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      className="aa-mobile-icon-button"
      type="button"
      aria-label={props.label}
      aria-controls={props.ariaControls}
      aria-expanded={props.ariaExpanded}
      aria-haspopup={props.ariaHasPopup}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Notice(props: { readonly children: ReactNode; readonly tone?: "error" | "info" | "warning" }) {
  const tone = props.tone ?? "error";
  const icon = tone === "error" ? <CircleAlert /> : tone === "warning" ? <TriangleAlert /> : <Info />;
  return <div className="aa-mobile-notice" data-tone={tone} role={tone === "error" ? "alert" : "status"}>{icon}{props.children}</div>;
}
