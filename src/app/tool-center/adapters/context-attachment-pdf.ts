import { inflateRawSync } from "node:zlib";

export type ExtractedPdfText = {
  readonly text: string;
  readonly reason?: string;
  readonly facts: {
    readonly streamCount: number;
    readonly decodedStreams: number;
    readonly skippedStreams: number;
    readonly textFragments: number;
  };
};

export function extractPdfText(buffer: Buffer): ExtractedPdfText {
  if (!buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1").includes("%PDF-")) {
    return {
      text: "",
      reason: "invalid_pdf_header",
      facts: { streamCount: 0, decodedStreams: 0, skippedStreams: 0, textFragments: 0 },
    };
  }
  const source = buffer.toString("latin1");
  const chunks: string[] = [];
  let streamCount = 0;
  let decodedStreams = 0;
  let skippedStreams = 0;
  const streamPattern = /stream\r?\n?([\s\S]*?)\r?\n?endstream/giu;
  for (const match of source.matchAll(streamPattern)) {
    streamCount += 1;
    const rawStream = match[1] ?? "";
    const dictionaryStart = source.lastIndexOf("<<", match.index ?? 0);
    const dictionaryEnd = source.lastIndexOf(">>", match.index ?? 0);
    const dictionary = dictionaryStart >= 0 && dictionaryEnd > dictionaryStart
      ? source.slice(dictionaryStart, dictionaryEnd + 2)
      : "";
    const decoded = decodePdfStream(Buffer.from(rawStream, "latin1"), dictionary);
    if (decoded === undefined) {
      skippedStreams += 1;
      continue;
    }
    decodedStreams += 1;
    chunks.push(...extractPdfTextFragments(decoded.toString("latin1")));
  }
  const text = normalizeExtractedPdfText(chunks.filter(isUsefulPdfText).join("\n"));
  return {
    text,
    reason: text.length === 0 ? "no_extractable_pdf_text" : undefined,
    facts: {
      streamCount,
      decodedStreams,
      skippedStreams,
      textFragments: chunks.length,
    },
  };
}

function decodePdfStream(stream: Buffer, dictionary: string): Buffer | undefined {
  const hasFilter = /\/Filter\b/u.test(dictionary);
  if (!hasFilter) {
    return stream;
  }
  if (/\/FlateDecode\b/u.test(dictionary)) {
    try {
      return inflateRawSync(stream);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractPdfTextFragments(value: string): readonly string[] {
  const fragments: string[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === "(") {
      const parsed = readPdfLiteralString(value, index);
      if (parsed !== undefined) {
        fragments.push(parsed.value);
        index = parsed.nextIndex;
        continue;
      }
    }
    if (char === "<" && value[index + 1] !== "<") {
      const parsed = readPdfHexString(value, index);
      if (parsed !== undefined) {
        fragments.push(parsed.value);
        index = parsed.nextIndex;
        continue;
      }
    }
    index += 1;
  }
  return fragments;
}

function readPdfLiteralString(value: string, startIndex: number): { readonly value: string; readonly nextIndex: number } | undefined {
  let index = startIndex + 1;
  let depth = 1;
  const bytes: number[] = [];
  while (index < value.length) {
    const char = value[index]!;
    if (char === "\\") {
      const escaped = value[index + 1];
      if (escaped === undefined) {
        return undefined;
      }
      const octal = /^[0-7]{1,3}/u.exec(value.slice(index + 1, index + 4))?.[0];
      if (octal !== undefined) {
        bytes.push(Number.parseInt(octal, 8));
        index += 1 + octal.length;
        continue;
      }
      const mapped = pdfEscapedByte(escaped);
      if (mapped !== undefined) {
        bytes.push(mapped);
      }
      index += 2;
      continue;
    }
    if (char === "(") {
      depth += 1;
      bytes.push(char.charCodeAt(0));
      index += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: decodePdfStringBytes(Buffer.from(bytes)),
          nextIndex: index + 1,
        };
      }
      bytes.push(char.charCodeAt(0));
      index += 1;
      continue;
    }
    bytes.push(char.charCodeAt(0) & 0xff);
    index += 1;
  }
  return undefined;
}

function readPdfHexString(value: string, startIndex: number): { readonly value: string; readonly nextIndex: number } | undefined {
  const endIndex = value.indexOf(">", startIndex + 1);
  if (endIndex < 0) {
    return undefined;
  }
  const hex = value.slice(startIndex + 1, endIndex).replace(/\s+/gu, "");
  if (hex.length === 0 || !/^[0-9a-f]+$/iu.test(hex)) {
    return undefined;
  }
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
  return {
    value: decodePdfStringBytes(Buffer.from(padded, "hex")),
    nextIndex: endIndex + 1,
  };
}

function pdfEscapedByte(value: string): number | undefined {
  if (value === "n") return 0x0a;
  if (value === "r") return 0x0d;
  if (value === "t") return 0x09;
  if (value === "b") return 0x08;
  if (value === "f") return 0x0c;
  if (value === "\n" || value === "\r") return undefined;
  return value.charCodeAt(0) & 0xff;
}

function decodePdfStringBytes(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const codes: number[] = [];
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      codes.push(bytes.readUInt16BE(index));
    }
    return String.fromCharCode(...codes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  return bytes.toString("utf8");
}

function isUsefulPdfText(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) {
    return false;
  }
  const printable = [...text].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;
  }).length;
  return printable / Math.max(1, text.length) > 0.8 && /[\p{L}\p{N}]/u.test(text);
}

function normalizeExtractedPdfText(value: string): string {
  return value
    .replace(/\u0000/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
