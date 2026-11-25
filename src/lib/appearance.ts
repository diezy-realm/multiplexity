export const FONT_OPTIONS = ['Segoe UI', 'Arial', 'Inter', 'Consolas', 'Cascadia Code', 'JetBrains Mono'] as const;
export interface Appearance { theme: 'dark' | 'light'; fontFamily: string; fontSize: number; terminalFontSize: number; colors: Record<string, string> }
export const defaultAppearance: Appearance = { theme: 'dark', fontFamily: 'Segoe UI', fontSize: 16, terminalFontSize: 14, colors: {} };
export const THEME_KEYS = ['editor.background','editor.foreground','sideBar.background','sideBar.foreground','panel.background','panel.border','input.background','input.foreground','input.border','button.background','button.foreground','terminal.background','terminal.foreground','terminalCursor.foreground','focusBorder','foreground','terminal.ansiBlack','terminal.ansiRed','terminal.ansiGreen','terminal.ansiYellow','terminal.ansiBlue','terminal.ansiMagenta','terminal.ansiCyan','terminal.ansiWhite','terminal.ansiBrightBlack','terminal.ansiBrightRed','terminal.ansiBrightGreen','terminal.ansiBrightYellow','terminal.ansiBrightBlue','terminal.ansiBrightMagenta','terminal.ansiBrightCyan','terminal.ansiBrightWhite'];
export function validAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== 'object') return false;
  const item = value as Appearance;
  return ['dark','light'].includes(item.theme) && FONT_OPTIONS.includes(item.fontFamily as typeof FONT_OPTIONS[number]) && Number.isInteger(item.fontSize) && item.fontSize >= 11 && item.fontSize <= 22 && Number.isInteger(item.terminalFontSize) && item.terminalFontSize >= 10 && item.terminalFontSize <= 28 && !!item.colors && typeof item.colors === 'object' && !Array.isArray(item.colors) && Object.entries(item.colors).every(([key,color]) => THEME_KEYS.includes(key) && typeof color === 'string' && /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(color));
}

export function terminalAppearance(value: Appearance) {
  const colors = value.colors;
  const theme: Record<string,string> = {
    background: colors['terminal.background'] || colors['editor.background'] || (value.theme === 'dark' ? '#000000' : '#ffffff'),
    foreground: colors['terminal.foreground'] || colors['editor.foreground'] || (value.theme === 'dark' ? '#ffffff' : '#171717'),
    cursor: colors['terminalCursor.foreground'] || (value.theme === 'dark' ? '#ffffff' : '#171717'),
  };
  for (const name of ['Black','Red','Green','Yellow','Blue','Magenta','Cyan','White','BrightBlack','BrightRed','BrightGreen','BrightYellow','BrightBlue','BrightMagenta','BrightCyan','BrightWhite']) {
    if (colors[`terminal.ansi${name}`]) theme[name[0].toLowerCase() + name.slice(1)] = colors[`terminal.ansi${name}`];
  }
  return { fontSize:value.terminalFontSize, fontFamily:['Consolas','Cascadia Code','JetBrains Mono'].includes(value.fontFamily) ? `"${value.fontFamily}", monospace` : 'Consolas, "Courier New", monospace', theme };
}
