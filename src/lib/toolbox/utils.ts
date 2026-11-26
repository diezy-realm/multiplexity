export function stripAnsiCodes(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

export function expandNestedJsonStrings(value: unknown, depth = 0, maxDepth = 5): unknown {
  if (depth >= maxDepth || value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      trimmed.length >= 2 &&
      ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')))
    ) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return expandNestedJsonStrings(parsed, depth + 1, maxDepth);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandNestedJsonStrings(item, depth + 1, maxDepth));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = expandNestedJsonStrings(obj[key], depth + 1, maxDepth);
    }
    return out;
  }
  return value;
}

export function formatJsonText(raw: string): { ok: boolean; output: string; error?: string } {
  const clean = stripAnsiCodes(raw).trim();
  if (!clean) return { ok: true, output: '' };
  try {
    const parsed = JSON.parse(clean) as unknown;
    return {
      ok: true,
      output: JSON.stringify(expandNestedJsonStrings(parsed), null, 2),
    };
  } catch (err) {
    return {
      ok: false,
      output: clean,
      error: err instanceof Error ? err.message : 'JSON tidak valid.',
    };
  }
}

export function decodeJwtOffline(token: string): {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error?: string;
} {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length < 2) {
    return { error: 'Format JWT harus memiliki minimal header.payload.' };
  }
  try {
    const decodePart = (segment: string) => {
      const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    };
    return {
      header: decodePart(parts[0]),
      payload: decodePart(parts[1]),
    };
  } catch {
    return { error: 'Gagal decode Base64Url/JSON pada JWT.' };
  }
}

export function filterLinesWithRegex(
  text: string,
  pattern: string,
): { matches: string[]; error?: string } {
  if (!pattern.trim()) return { matches: text.split(/\r?\n/) };
  try {
    const re = new RegExp(pattern, 'i');
    return {
      matches: text.split(/\r?\n/).filter((line) => re.test(line)),
    };
  } catch (err) {
    return {
      matches: [],
      error: err instanceof Error ? err.message : 'Pola regex tidak valid.',
    };
  }
}
