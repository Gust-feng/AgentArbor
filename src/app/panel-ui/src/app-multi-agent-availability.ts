/**
 * Product release boundary for the unfinished Multi-Agent workbench entry.
 * Keep the feature implementation intact while the public entry is paused.
 */
export const MULTI_AGENT_ENTRY_AVAILABLE = false;

export function isMultiAgentEntryEnabled(userPreference: boolean): boolean {
  return MULTI_AGENT_ENTRY_AVAILABLE && userPreference;
}