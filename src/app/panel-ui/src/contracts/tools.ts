export type ToolDisplayProjection =
  | {
      readonly kind: "search_results";
      readonly query?: string;
      readonly status?: string;
      readonly results: readonly { readonly title: string; readonly url?: string; readonly summary?: string; readonly snippet?: string; readonly refId?: string; readonly source?: string }[];
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "browser_snapshot";
      readonly title?: string;
      readonly url?: string;
      readonly summary?: string;
      readonly text?: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "file_change_summary" | "file_diff_preview";
      readonly path?: string;
      readonly summary?: string;
      readonly preview?: string;
      readonly bytes?: number;
      readonly replacements?: number;
      readonly previousLength?: number;
      readonly nextLength?: number;
      readonly append?: boolean;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "command_summary";
      readonly command?: string;
      readonly args?: readonly string[];
      readonly exitCode?: number;
      readonly outputSummary?: string;
      readonly errorSummary?: string;
    }
  | {
      readonly kind: "generic_tool_summary";
      readonly action?: string;
      readonly summary?: string;
      readonly items?: readonly string[];
    };

export type ToolCatalogItem = {
  readonly name: string;
  readonly displayName?: string;
  readonly displayDescription?: string;
  readonly description?: string;
  readonly category?: string;
  readonly categoryLabel?: string;
  readonly riskLevel?: string;
  readonly riskLabel?: string;
  readonly operationType?: string;
  readonly operationLabel?: string;
  readonly enabled: boolean;
  readonly available?: boolean;
  readonly unavailableReason?: string;
  readonly requiresConfirmation?: boolean;
  readonly confirmationLabel?: string;
};

export type ToolsResponse = {
  readonly tools?: {
    readonly webSearch?: {
      readonly provider?: string;
      readonly maxResults?: number;
      readonly secretConfigured?: boolean;
    };
    readonly catalog?: {
      readonly tools?: readonly ToolCatalogItem[];
    };
  };
};
