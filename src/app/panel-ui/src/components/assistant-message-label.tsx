import React from "react";
import type { AssistantModelBadge } from "./chat-session-projection";

export function AssistantMessageLabel(props: {
  readonly model?: AssistantModelBadge;
  readonly fallbackLabel?: string;
}): React.ReactElement {
  const modelLabel = assistantMessageModelLabel(props.model) ?? fallbackLabel(props.fallbackLabel);
  return (
    <div className="assistant-message-label">
      {props.model?.iconSvg !== undefined && (
        <span className="assistant-message-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: props.model.iconSvg }} />
      )}
      {modelLabel !== undefined && <span className="assistant-message-model">{modelLabel}</span>}
    </div>
  );
}

function assistantMessageModelLabel(model: AssistantModelBadge | undefined): string | undefined {
  if (model === undefined) return undefined;
  const name = model.modelName.trim();
  return name.length > 0 ? name : undefined;
}

function fallbackLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
