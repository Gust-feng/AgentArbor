export function redactSensitiveText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted-secret]")
    .replace(/\btvly-[A-Za-z0-9_-]{6,}\b/g, "[redacted-secret]")
    .replace(/\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/gi, "[redacted-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted-token]")
    .replace(/\b(?:api[_ -]?key|apikey)\s*[:=]\s*[^;\s]+/gi, "[redacted-secret]")
    .replace(/\btoken\s*[:=]\s*[^;\s]+/gi, "[redacted-token]")
    .replace(/\b(?:secret|password)\s*[:=]\s*[^;\s]+/gi, "[redacted-secret]");
}
