import type { ModelOutputDelta, ModelRequest } from "../../domain/intelligence/index.js";
import { nowIso } from "../../kernel/id.js";

export function emitFakeOutputDeltas(input: {
  readonly request: ModelRequest;
  readonly providerId: string;
  readonly model: string;
  readonly output: unknown;
  readonly textOutput?: string;
  readonly emit?: (delta: ModelOutputDelta) => void;
}): void {
  if (input.emit === undefined) {
    return;
  }
  const text =
    typeof input.textOutput === "string" && input.textOutput.trim().length > 0
      ? input.textOutput
      : typeof input.output === "string"
        ? input.output
        : input.output === undefined
          ? ""
          : JSON.stringify(input.output);
  const chunks = chunkText(text, 80);
  chunks.forEach((delta, index) => {
    input.emit?.({
      requestId: input.request.requestId,
      purpose: input.request.purpose,
      providerId: input.providerId,
      model: input.model,
      delta,
      index: index + 1,
      createdAt: nowIso(),
    });
  });
}

function chunkText(value: string, maxLength: number): readonly string[] {
  const text = value.trim();
  if (text.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}
