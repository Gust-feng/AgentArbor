export const DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS = 180_000;

// Producer-managed text windows need room for paths, headers, status, and
// continuation metadata before ToolCenter applies the full-result limit.
export const TOOL_OUTPUT_METADATA_RESERVE_CHARS = 4_096;
export const DEFAULT_MAX_INLINE_TOOL_CONTENT_JSON_CHARS =
  DEFAULT_MAX_INLINE_TOOL_OUTPUT_CHARS - TOOL_OUTPUT_METADATA_RESERVE_CHARS;
