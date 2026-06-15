export type ToolErrorFactValue =
  | string
  | number
  | boolean
  | null
  | readonly ToolErrorFactValue[]
  | { readonly [key: string]: ToolErrorFactValue };

export type ToolErrorFacts = Readonly<Record<string, ToolErrorFactValue>>;

export type ToolDisplayProjection =
  | {
      readonly kind: "search_results";
      readonly query?: string;
      readonly status?: string;
      readonly message?: string;
      readonly results: readonly { readonly title: string; readonly url?: string; readonly summary?: string; readonly snippet?: string; readonly refId?: string; readonly source?: string }[];
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "read_result";
      readonly ref?: string;
      readonly source?: string;
      readonly status?: string;
      readonly title?: string;
      readonly url?: string;
      readonly uri?: string;
      readonly sourceSearchRef?: string;
      readonly contentPreview?: string;
      readonly error?: string;
      readonly errorFacts?: ToolErrorFacts;
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
      readonly kind: "http_response";
      readonly method?: string;
      readonly url?: string;
      readonly statusCode?: number;
      readonly statusText?: string;
      readonly durationMs?: number;
      readonly bodyPreview?: string;
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
      readonly commandLine?: string;
      readonly cwd?: string;
      readonly shell?: string;
      readonly exitCode?: number;
      readonly timedOut?: boolean;
      readonly cancelled?: boolean;
      readonly background?: boolean;
      readonly pid?: number;
      readonly logRef?: string;
      readonly logPath?: string;
      readonly stopCommand?: string;
      readonly durationMs?: number;
      readonly waitForPort?: number;
      readonly portReady?: boolean;
      readonly stdoutTruncated?: boolean;
      readonly stderrTruncated?: boolean;
      readonly stdoutChars?: number;
      readonly stderrChars?: number;
      readonly stdoutOmittedChars?: number;
      readonly stderrOmittedChars?: number;
      readonly outputSummary?: string;
      readonly errorSummary?: string;
    }
  | {
      readonly kind: "generic_tool_summary";
      readonly action?: string;
      readonly summary?: string;
      readonly items?: readonly string[];
    };

export type ToolResultEnvelope = {
  readonly agentSummary: string;
  readonly evidenceRefs: readonly string[];
  readonly uiDisplay?: ToolDisplayProjection;
  readonly tokenEstimate: number;
  readonly truncated: boolean;
  readonly redacted: boolean;
  readonly diagnosticRef?: string;
  readonly rawRetention: "none" | "diagnostic_ref_only";
  readonly errorDomain?: string;
  readonly errorFacts?: ToolErrorFacts;
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

export type McpServerCatalogItem = {
  readonly serverId: string;
  readonly label: string;
  readonly transport: "stdio" | "http" | "sse";
  readonly enabled: boolean;
  readonly confirmationMode?: "always" | "unsafe_only" | "never";
  readonly toolExposureMode?: "none" | "all" | "selected";
  readonly availability: "configured" | "disabled" | "unavailable";
  readonly runtimeStatus?: "disabled" | "unavailable" | "configured" | "connecting" | "connected" | "error";
  readonly errorSummary?: string;
  readonly commandSummary?: string;
  readonly url?: string;
  readonly envSecretRefCount: number;
  readonly authSecretRefCount?: number;
  readonly enabledTools?: readonly string[];
  readonly autoApprovedTools?: readonly string[];
  readonly lastConnectedAt?: string;
  readonly lastError?: string;
  readonly tools: readonly ToolCatalogItem[];
  readonly exposedTools?: readonly ToolCatalogItem[];
  readonly updatedAt: string;
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
  readonly mcpCatalog?: readonly McpServerCatalogItem[];
};

export type McpEnvironmentCheckResponse = {
  readonly ok: boolean;
  readonly status:
    | "ready"
    | "missing_command"
    | "not_found"
    | "check_failed"
    | "installing"
    | "installed"
    | "unsupported"
    | "install_failed";
  readonly command?: string;
  readonly resolvedCommand?: string;
  readonly managed?: boolean;
  readonly installable?: boolean;
  readonly message: string;
  readonly checkedAt: string;
};

export type McpServerPreset = {
  readonly presetId: string;
  readonly label: string;
  readonly description: string;
  readonly server: {
    readonly serverId: string;
    readonly label?: string;
    readonly transport?: "stdio" | "http" | "sse";
    readonly commandLine?: string;
    readonly url?: string;
    readonly envSecretRefs?: readonly string[];
    readonly confirmationMode?: "always" | "unsafe_only" | "never";
    readonly toolExposureMode?: "none" | "all" | "selected";
    readonly enabled?: boolean;
  };
};

export type McpReferenceResponse = {
  readonly ok?: boolean;
  readonly serverId?: string;
  readonly errorCode?: string;
  readonly errorSummary?: string;
  readonly prompts: readonly {
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly arguments?: readonly {
      readonly name: string;
      readonly description?: string;
      readonly required?: boolean;
    }[];
  }[];
  readonly resources: readonly {
    readonly uri: string;
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly mimeType?: string;
    readonly size?: number;
  }[];
  readonly resourceTemplates: readonly {
    readonly uriTemplate: string;
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly mimeType?: string;
  }[];
};
