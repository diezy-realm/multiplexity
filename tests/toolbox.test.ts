import { describe, expect, it } from 'vitest';
import {
  decodeJwtOffline,
  expandNestedJsonStrings,
  filterLinesWithRegex,
  formatJsonText,
  stripAnsiCodes,
} from '@/lib/toolbox/utils';

describe('toolbox offline utilities', () => {
  it('strips ANSI codes and expands nested JSON strings', () => {
    const raw = '\x1b[32m{"outer":"{\\"inner\\":123}"}\x1b[0m';
    expect(stripAnsiCodes(raw)).toBe('{"outer":"{\\"inner\\":123}"}');
    const formatted = formatJsonText(raw);
    expect(formatted.ok).toBe(true);
    expect(formatted.output).toContain('"inner": 123');
    expect(expandNestedJsonStrings('{"a":"[1,2]"}')).toEqual({ a: [1, 2] });
  });

  it('decodes JWT offline without network calls', () => {
    const h = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
    const p = btoa(JSON.stringify({ sub: 'dev-1', role: 'pilot' })).replace(/=/g, '');
    const res = decodeJwtOffline(`Bearer ${h}.${p}.sig`);
    expect(res.error).toBeUndefined();
    expect(res.header?.alg).toBe('HS256');
    expect(res.payload?.sub).toBe('dev-1');
  });

  it('filters log lines with regex and reports invalid patterns safely', () => {
    const ok = filterLinesWithRegex('INFO ok\nERROR boom\nWARN retry', 'ERROR|WARN');
    expect(ok.matches).toEqual(['ERROR boom', 'WARN retry']);
    const bad = filterLinesWithRegex('abc', '([unclosed');
    expect(bad.error).toBeTruthy();
  });
});
