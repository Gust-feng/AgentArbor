import type {
  ModelOutputContract,
  ModelVisibleOutputFieldType,
} from "../../domain/intelligence/index.js";

export const DEFAULT_VISIBLE_FIELD_LENGTH = 180;
export const VISIBLE_TRUNCATED_MARKER = "...";

export function visibleOutputFieldNames(outputContract: ModelOutputContract): readonly string[] {
  return (outputContract.visibleOutput?.fields ?? outputContract.requiredStringFields ?? [])
    .filter((fieldName) => !isSensitiveVisibleOutputFieldName(fieldName));
}

export function truncateVisibleOutputValue(value: string, maxLength: number): {
  readonly value: string;
  readonly truncated: boolean;
} {
  const truncated = value.length > maxLength;
  return {
    value: truncated
      ? `${value.slice(0, Math.max(0, maxLength - VISIBLE_TRUNCATED_MARKER.length))}${VISIBLE_TRUNCATED_MARKER}`
      : value,
    truncated,
  };
}

export function formatVisibleOutputValue(
  value: unknown,
  fieldType?: ModelVisibleOutputFieldType
): string | undefined {
  if (fieldType === "string") {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  }
  if (fieldType === "string_array") {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const values = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length > 0 ? values.join("; ") : undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatVisibleOutputValue(item)).filter(Boolean).join("; ");
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function isSensitiveVisibleOutputFieldName(fieldName: string): boolean {
  const normalized = fieldName.toLowerCase();
  return normalized.includes("secret") ||
    normalized.includes("apikey") ||
    normalized.includes("api_key") ||
    normalized.includes("token") ||
    normalized.includes("prompt") ||
    normalized.includes("reasoning") ||
    normalized.includes("raw") ||
    normalized.includes("error");
}
