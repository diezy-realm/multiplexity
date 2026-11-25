import { expect, it } from 'vitest';
import { defaultAppearance, validAppearance, terminalAppearance } from '@/lib/appearance';

it('accepts supported VS Code colors and rejects unsafe CSS values and sizes', () => {
  expect(validAppearance({ ...defaultAppearance, colors: { 'editor.background': '#102030', 'terminal.ansiRed': '#f00' } })).toBe(true);
  expect(validAppearance({ ...defaultAppearance, colors: { 'editor.background': 'url(https://example.com)' } })).toBe(false);
  expect(validAppearance({ ...defaultAppearance, fontSize: 200 })).toBe(false);
  expect(validAppearance({ ...defaultAppearance, colors: { unsupported: '#ffffff' } })).toBe(false);
});

it('maps imported terminal colors and font preferences to xterm', () => {
  const options = terminalAppearance({ ...defaultAppearance, fontFamily: 'Cascadia Code', terminalFontSize: 18, colors: { 'editor.background': '#112233', 'terminal.foreground': '#abcdef', 'terminal.ansiBrightRed': '#ff0000' } });
  expect(options.fontSize).toBe(18);
  expect(options.fontFamily).toContain('Cascadia Code');
  expect(options.theme).toMatchObject({ background: '#112233', foreground: '#abcdef', brightRed: '#ff0000' });
});
