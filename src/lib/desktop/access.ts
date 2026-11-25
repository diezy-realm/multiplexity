import { timingSafeEqual } from 'crypto';
import { parse as parseCookie } from 'cookie';

export function hasDesktopAccess(cookieHeader?: string): boolean {
  const expected = process.env.DESKTOP_ACCESS_TOKEN;
  if (process.env.DESKTOP_MODE !== '1' || !expected || !cookieHeader) return false;
  const actual = parseCookie(cookieHeader)['desktop-access'];
  if (typeof actual !== 'string') return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
