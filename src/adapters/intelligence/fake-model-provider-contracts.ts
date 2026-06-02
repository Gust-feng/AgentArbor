import type { ModelOutputDelta, ModelToolCall } from "../../domain/intelligence/index.js";

export type FakeModelProviderOptions = {
  readonly providerId?: string;
  readonly model?: string;
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
  readonly failureMessage?: string;
  readonly responses?: readonly FakeModelProviderResponse[];
  readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
};

export type FakeModelProviderResponse = {
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
  readonly failureMessage?: string;
};

export type FakeModelProviderStep = {
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly toolCalls?: readonly ModelToolCall[];
};
