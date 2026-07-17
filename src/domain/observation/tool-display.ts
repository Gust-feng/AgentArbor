import type { ToolErrorFacts, ToolFileDisplayOperation } from "../tools/contracts.js";

/** Panel/Observation read-model derived from tool execution facts. */
export type ToolDisplayProjection =
  | {
      readonly kind: "search_results";
      readonly query?: string;
      readonly status?: string;
      readonly message?: string;
      readonly results: readonly {
        readonly title: string;
        readonly url?: string;
        readonly refId?: string;
        readonly source?: string;
        readonly snippet?: string;
      }[];
      readonly resultsReturned?: number;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "directory_listing";
      readonly path?: string;
      readonly depth?: number;
      readonly entriesReturned?: number;
      readonly totalEntries?: number;
      readonly unreadableDirectories?: number;
      readonly unreadableSamples?: readonly { readonly path?: string; readonly errorCode?: string }[];
      readonly entries: readonly {
        readonly path: string;
        readonly name?: string;
        readonly kind?: string;
        readonly bytes?: number;
        readonly depth?: number;
      }[];
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "file_search_results";
      readonly query?: string;
      readonly path?: string;
      readonly engine?: string;
      readonly searchedFiles?: number;
      readonly skippedFactsAvailable?: boolean;
      readonly skippedFiles?: number;
      readonly skippedBinaryFiles?: number;
      readonly skippedTooLargeFiles?: number;
      readonly skippedUnreadableFiles?: number;
      readonly skippedDirectories?: number;
      readonly skippedOtherEntries?: number;
      readonly skippedSamples?: readonly {
        readonly path?: string;
        readonly reason?: string;
        readonly bytes?: number;
        readonly errorCode?: string;
      }[];
      readonly matches: readonly { readonly path: string; readonly line?: number; readonly preview?: string }[];
      readonly matchesReturned?: number;
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
      readonly summary?: string;
      readonly preview?: string;
      readonly error?: string;
      readonly errorFacts?: ToolErrorFacts;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "browser_snapshot";
      readonly title?: string;
      readonly url?: string;
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
      readonly kind: "file_change_summary";
      readonly path?: string;
      readonly operation?: ToolFileDisplayOperation;
      readonly bytes?: number;
      readonly append?: boolean;
      readonly replacements?: number;
      readonly previousLength?: number;
      readonly nextLength?: number;
      readonly preview?: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "file_diff_preview";
      readonly path?: string;
      readonly operation?: ToolFileDisplayOperation;
      readonly replacements?: number;
      readonly previousLength?: number;
      readonly nextLength?: number;
      readonly preview?: string;
      readonly truncated?: boolean;
    }
  | {
      /** One tool execution that changed several files. It remains one activity in the transcript. */
      readonly kind: "file_change_group";
      readonly files: readonly {
        readonly path: string;
        readonly operation?: ToolFileDisplayOperation;
        readonly preview?: string;
        readonly replacements?: number;
        readonly truncated?: boolean;
      }[];
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
      readonly stdoutPreview?: string;
      readonly stderrPreview?: string;
    }
  | {
      readonly kind: "generic_tool_summary";
      readonly action?: string;
      readonly summary?: string;
      readonly items?: readonly string[];
    };
