import type {
  ModelOutputContract,
  ModelVisibleOutputFieldType,
} from "../../domain/intelligence/index.js";
import { redactSensitiveText } from "../redaction.js";
import {
  DEFAULT_VISIBLE_FIELD_LENGTH,
  truncateVisibleOutputValue,
  visibleOutputFieldNames,
} from "./visible-output-fields.js";

export type VisibleOutputStreamProjector = {
  push(delta: string): string;
};

export function createVisibleOutputStreamProjector(
  outputContract: ModelOutputContract
): VisibleOutputStreamProjector {
  if (outputContract.format === "text") {
    return {
      push(delta: string): string {
        return delta;
      },
    };
  }

  let source = "";
  let previousVisibleText = "";
  return {
    push(delta: string): string {
      if (delta.length === 0) {
        return "";
      }
      source += delta;
      const nextVisibleText = visibleStructuredOutputText(outputContract, source);
      if (!nextVisibleText.startsWith(previousVisibleText)) {
        return "";
      }
      const visibleDelta = nextVisibleText.slice(previousVisibleText.length);
      previousVisibleText = nextVisibleText;
      return visibleDelta;
    },
  };
}

export function visibleStructuredOutputText(
  outputContract: ModelOutputContract,
  source: string
): string {
  const fields = visibleOutputFieldNames(outputContract);
  if (fields.length === 0) {
    return "";
  }
  const maxFieldLength = outputContract.visibleOutput?.maxFieldLength ?? DEFAULT_VISIBLE_FIELD_LENGTH;
  return fields
    .map((fieldName) => visibleFieldText({
      fieldName,
      fieldType: outputContract.visibleOutput?.fieldTypes?.[fieldName],
      source,
      maxFieldLength,
    }))
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join("\n\n");
}

function visibleFieldText(input: {
  readonly fieldName: string;
  readonly fieldType?: ModelVisibleOutputFieldType;
  readonly source: string;
  readonly maxFieldLength: number;
}): string | undefined {
  const valueStart = findTopLevelFieldValueStart(input.source, input.fieldName);
  if (valueStart === undefined) {
    return undefined;
  }
  const rawValue = input.fieldType === "string_array"
    ? parseJsonStringArray(input.source, valueStart)
    : parseJsonString(input.source, valueStart) ?? parseJsonStringArray(input.source, valueStart);
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return undefined;
  }
  const value = redactSensitiveText(rawValue);
  return truncateVisibleOutputValue(value, input.maxFieldLength).value;
}

function findTopLevelFieldValueStart(source: string, fieldName: string): number | undefined {
  const pattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const valueStart = match.index + match[0].length;
    if (isLikelyTopLevelField(source, match.index)) {
      return valueStart;
    }
  }
  return undefined;
}

function isLikelyTopLevelField(source: string, keyStart: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < keyStart; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth === 1 && !inString;
}

function parseJsonString(source: string, start: number): string | undefined {
  if (source[start] !== "\"") {
    return undefined;
  }
  const chars: string[] = [];
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (escaped) {
      const decoded = decodeJsonEscape(source, index);
      chars.push(decoded.value);
      index = decoded.nextIndex - 1;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      break;
    }
    chars.push(char);
  }
  return chars.join("");
}

function parseJsonStringArray(source: string, start: number): string | undefined {
  if (source[start] !== "[") {
    return undefined;
  }
  const values: string[] = [];
  let index = start + 1;
  while (index < source.length) {
    index = skipJsonWhitespaceAndCommas(source, index);
    const char = source[index] ?? "";
    if (char.length === 0 || char === "]") {
      break;
    }
    if (char === "\"") {
      const value = parseJsonString(source, index);
      if (value !== undefined && value.trim().length > 0) {
        values.push(value.trim());
      }
      index = nextStringBoundary(source, index + 1);
      continue;
    }
    if (char === "{" || char === "[") {
      index = skipJsonCompositeValue(source, index);
      continue;
    }
    index = skipJsonPrimitiveValue(source, index);
  }
  return values.length === 0 ? undefined : values.join("; ");
}

function skipJsonWhitespaceAndCommas(source: string, start: number): number {
  let index = start;
  while (index < source.length && (/[\s,]/u).test(source[index] ?? "")) {
    index += 1;
  }
  return index;
}

function skipJsonCompositeValue(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return source.length;
}

function skipJsonPrimitiveValue(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (char === "," || char === "]") {
      return index;
    }
  }
  return source.length;
}

function nextStringBoundary(source: string, start: number): number {
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      return index + 1;
    }
  }
  return source.length;
}

function decodeJsonEscape(source: string, index: number): { readonly value: string; readonly nextIndex: number } {
  const value = source[index] ?? "";
  switch (value) {
    case "n":
      return { value: "\n", nextIndex: index + 1 };
    case "r":
      return { value: "\r", nextIndex: index + 1 };
    case "t":
      return { value: "\t", nextIndex: index + 1 };
    case "b":
      return { value: "\b", nextIndex: index + 1 };
    case "f":
      return { value: "\f", nextIndex: index + 1 };
    case "\"":
    case "\\":
    case "/":
      return { value, nextIndex: index + 1 };
    case "u":
      return decodeUnicodeEscape(source, index);
    default:
      return { value, nextIndex: index + 1 };
  }
}

function decodeUnicodeEscape(source: string, index: number): { readonly value: string; readonly nextIndex: number } {
  const first = unicodeCodeUnit(source, index + 1);
  if (first === undefined) {
    return { value: "", nextIndex: source.length };
  }
  const afterFirst = index + 5;
  if (isHighSurrogate(first) && source[afterFirst] === "\\" && source[afterFirst + 1] === "u") {
    const second = unicodeCodeUnit(source, afterFirst + 2);
    if (second === undefined) {
      return { value: "", nextIndex: source.length };
    }
    if (isLowSurrogate(second)) {
      return {
        value: String.fromCodePoint(0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)),
        nextIndex: afterFirst + 6,
      };
    }
  }
  return {
    value: String.fromCharCode(first),
    nextIndex: afterFirst,
  };
}

function unicodeCodeUnit(source: string, start: number): number | undefined {
  const text = source.slice(start, start + 4);
  if (!/^[0-9a-fA-F]{4}$/u.test(text)) {
    return undefined;
  }
  return Number.parseInt(text, 16);
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xD800 && value <= 0xDBFF;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xDC00 && value <= 0xDFFF;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
