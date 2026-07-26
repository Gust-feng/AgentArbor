import { asOptionalRecord } from "../values/index.js";
import type {
  ModelOutputContract,
  ModelVisibleOutputFieldType,
  ModelResponse,
  ModelVisibleOutputField,
  ModelVisibleOutputItem,
  ModelVisibleOutputProjection,
} from "../../domain/intelligence/index.js";
import { redactSensitiveText } from "../redaction.js";
import {
  DEFAULT_VISIBLE_FIELD_LENGTH,
  formatVisibleOutputValue,
  truncateVisibleOutputValue,
  visibleOutputFieldNames,
} from "./visible-output-fields.js";

const DEFAULT_MAX_ITEMS = 3;

export function createModelVisibleOutputProjection(input: {
  readonly outputContract: ModelOutputContract;
  readonly response: ModelResponse;
}): ModelVisibleOutputProjection | undefined {
  if (input.response.status !== "completed" || input.response.validation.status !== "passed") {
    return undefined;
  }

  const outputContract = input.outputContract;
  const maxFieldLength = outputContract.visibleOutput?.maxFieldLength ?? DEFAULT_VISIBLE_FIELD_LENGTH;
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

  const structuredOutput = asOptionalRecord(input.response.structuredOutput);
  if (structuredOutput === undefined) {
    return undefined;
  }

  const allowedFields = visibleOutputFieldNames(outputContract);
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
  const record = asOptionalRecord(input.value);
  if (record === undefined) {
    return { itemId: input.itemId, fields: [] };
  }
  const fields: ModelVisibleOutputField[] = [];
  for (const fieldName of input.allowedFields) {
    const rawValue = record[fieldName];
    if (rawValue === undefined) {
      return { itemId: input.itemId, fields: [] };
    }
    const formatted = formatVisibleOutputValue(rawValue, input.fieldTypes?.[fieldName]);
    if (formatted === undefined || formatted.trim().length === 0) {
      return { itemId: input.itemId, fields: [] };
    }
    fields.push(createVisibleField(fieldName, formatted, input.maxFieldLength));
  }
  return { itemId: input.itemId, fields };
}

function createVisibleField(name: string, rawValue: string, maxLength: number): ModelVisibleOutputField {
  const value = redactSensitiveText(rawValue);
  const truncated = truncateVisibleOutputValue(value, maxLength);
  return {
    name,
    value: truncated.value,
    truncated: truncated.truncated,
  };
}

function arrayItems(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function rootletKindFromAdviceContractId(contractId: string): string | undefined {
  const prefix = "underground.rootlet_candidate_advice.";
  if (!contractId.startsWith(prefix)) {
    return undefined;
  }
  return contractId.slice(prefix.length).split(".")[0];
}

