import type { ToolFileDisplayOperation } from "../tools/contracts.js";

/** Panel/Observation read-model derived from tool execution facts. */
export type ToolDisplayProjection =
  | {
      readonly kind: "search_results";
      readonly query?: string;
      readonly message?: string;
      readonly results: readonly {
        readonly title: string;
        readonly url?: string;
        readonly source?: string;
      }[];
    }
  | {
      readonly kind: "directory_listing";
      readonly path?: string;
      readonly unreadableDirectories?: number;
      readonly unreadableSamples?: readonly { readonly path?: string; readonly errorCode?: string }[];
      readonly entries: readonly {
        readonly path: string;
        readonly kind?: string;
      }[];
    }
  | {
      readonly kind: "file_search_results";
      readonly query?: string;
      readonly path?: string;
      readonly skippedUnreadableFiles?: number;
      readonly matches: readonly { readonly path: string; readonly line?: number; readonly preview?: string }[];
    }
  | {
      readonly kind: "read_result";
      readonly title?: string;
      readonly url?: string;
      readonly uri?: string;
      readonly contentPreview?: string;
      readonly error?: string;
    }
  | {
      readonly kind: "web_fetch";
      readonly title?: string;
      readonly url?: string;
    }
  | {
      readonly kind: "http_response";
      readonly method?: string;
      readonly url?: string;
      readonly statusCode?: number;
      readonly statusText?: string;
      readonly bodyPreview?: string;
    }
  | {
      readonly kind: "file_change_summary";
      readonly path?: string;
      readonly operation?: ToolFileDisplayOperation;
      readonly preview?: string;
    }
  | {
      readonly kind: "file_diff_preview";
      readonly path?: string;
      readonly operation?: ToolFileDisplayOperation;
      readonly preview?: string;
    }
  | {
      /** One tool execution that changed several files. It remains one activity in the transcript. */
      readonly kind: "file_change_group";
      readonly files: readonly {
        readonly path: string;
        readonly operation?: ToolFileDisplayOperation;
        readonly preview?: string;
      }[];
    }
  | {
      readonly kind: "command_summary";
      readonly command?: string;
      readonly args?: readonly string[];
      readonly commandLine?: string;
      readonly exitCode?: number;
      readonly timedOut?: boolean;
      readonly stdoutPreview?: string;
      readonly stderrPreview?: string;
    }
  | {
      /** A bounded task delegated through an Ordinary AgentTool. */
      readonly kind: "agent_task";
      readonly agentName?: string;
      readonly task?: string;
      readonly result?: string;
    }
  | {
      readonly kind: "generic_tool_summary";
      readonly action?: string;
      readonly summary?: string;
      readonly items?: readonly string[];
    };
