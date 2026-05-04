import type {
  ModelOutputContract,
  ModelVisibleOutputFieldType,
  ModelResponse,
  ModelVisibleOutputField,
  ModelVisibleOutputItem,
  ModelVisibleOutputProjection,
} from "../../domain/intelligence/index.js";

const DEFAULT_MAX_ITEMS = 3;
const DEFAULT_MAX_FIELD_LENGTH = 180;
const TRUNCATED_MARKER = "...";

export function createModelVisibleOutputProjection(input: {
  readonly outputContract: ModelOutputContract;
  readonly response: ModelResponse;
}): ModelVisibleOutputProjection | undefined {
  if (input.response.status !== "completed" || input.response.validation.status !== "passed") {
    return undefined;
  }

  const outputContract = input.outputContract;
  const maxFieldLength = outputContract.visibleOutput?.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH;
  const rootletKind = rootletKindFromAdviceContractId(outputContract.contractId);

  if (outputContract.format === "text") {
    const text = typeof input.response.textOutput === "string" ? input.response.textOutput : undefined;
    if (text === undefined) {
      return undefined;
    }
    const field = createVisibleField("text", text, maxFieldLength);
    return {
      source: "text_output",
      contractId: outputContract.contractId,
      outputKind: outputContract.outputKind,
      validationStatus: input.response.validation.status,
      rootletKind,
      items: [{ itemId: "text:1", fields: [field] }],
      truncated: field.truncated,
    };
  }

  const structuredOutput = asRecord(input.response.structuredOutput);
  if (structuredOutput === undefined) {
    return undefined;
  }

  const allowedFields = (outputContract.visibleOutput?.fields ?? outputContract.requiredStringFields ?? []).filter(
    (field) => !isSensitiveFieldName(field)
  );
  if (allowedFields.length === 0) {
    return undefined;
  }

  const arrayField = outputContract.visibleOutput?.arrayField;
  const rawItems =
    arrayField === undefined ? [structuredOutput] : arrayItems(structuredOutput[arrayField]);
  const maxItems = outputContract.visibleOutput?.maxItems ?? DEFAULT_MAX_ITEMS;
  const items = rawItems.slice(0, Math.max(0, maxItems)).map((value, index) =>
    createVisibleItem({
      itemId: `${arrayField ?? "output"}:${index + 1}`,
      value,
      allowedFields,
      fieldTypes: outputContract.visibleOutput?.fieldTypes,
      maxFieldLength,
    })
  ).filter((item) => item.fields.length > 0);

  if (items.length === 0) {
    return undefined;
  }

  return {
    source: "structured_output",
    contractId: outputContract.contractId,
    outputKind: outputContract.outputKind,
    validationStatus: input.response.validation.status,
    rootletKind,
    items,
    truncated:
      rawItems.length > items.length ||
      items.some((item) => item.fields.some((field) => field.truncated)),
  };
}

function createVisibleItem(input: {
  readonly itemId: string;
  readonly value: unknown;
  readonly allowedFields: readonly string[];
  readonly fieldTypes?: Readonly<Record<string, ModelVisibleOutputFieldType>>;
  readonly maxFieldLength: number;
}): ModelVisibleOutputItem {
  const record = asRecord(input.value);
  if (record === undefined) {
    return { itemId: input.itemId, fields: [] };
  }
  const fields: ModelVisibleOutputField[] = [];
  for (const fieldName of input.allowedFields) {
    const rawValue = record[fieldName];
    if (rawValue === undefined) {
      return { itemId: input.itemId, fields: [] };
    }
    const formatted = formatVisibleValue(rawValue, input.fieldTypes?.[fieldName]);
    if (formatted === undefined || formatted.trim().length === 0) {
      return { itemId: input.itemId, fields: [] };
    }
    fields.push(createVisibleField(fieldName, formatted, input.maxFieldLength));
  }
  return { itemId: input.itemId, fields };
}

function createVisibleField(name: string, rawValue: string, maxLength: number): ModelVisibleOutputField {
  const value = redactSensitiveText(rawValue.trim());
  const truncated = value.length > maxLength;
  return {
    name,
    value: truncated
      ? `${value.slice(0, Math.max(0, maxLength - TRUNCATED_MARKER.length))}${TRUNCATED_MARKER}`
      : value,
    truncated,
  };
}

function formatVisibleValue(value: unknown, fieldType?: ModelVisibleOutputFieldType): string | undefined {
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
    return value.map((item) => formatVisibleValue(item)).filter(Boolean).join("; ");
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[redacted-secret]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]")
    .replace(/api[_ -]?key\s*[:=]\s*[^;\s]+/gi, "api key=[redacted-secret]")
    .replace(/token\s*[:=]\s*[^;\s]+/gi, "token=[redacted-token]");
}

function arrayItems(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function isSensitiveFieldName(field: string): boolean {
  const normalized = field.toLowerCase();
  return (
    normalized.includes("secret") ||
    normalized.includes("apikey") ||
    normalized.includes("api_key") ||
    normalized.includes("token") ||
    normalized.includes("prompt") ||
    normalized.includes("reasoning") ||
    normalized.includes("raw") ||
    normalized.includes("error")
  );
}

function rootletKindFromAdviceContractId(contractId: string): string | undefined {
  const prefix = "underground.rootlet_candidate_advice.";
  if (!contractId.startsWith(prefix)) {
    return undefined;
  }
  return contractId.slice(prefix.length).split(".")[0];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return undefined;
}
