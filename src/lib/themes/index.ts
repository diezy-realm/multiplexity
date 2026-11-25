import { additionalThemes } from './additional';
import source from './presets.json';
import type { Appearance } from '@/lib/appearance';
export const themePresets = [...source.presets, ...additionalThemes] as {id:string;name:string;theme:Appearance['theme'];colors:Record<string,string>}[];
export function selectedPreset(appearance: Appearance) {
  return themePresets.find(preset => preset.theme === appearance.theme && JSON.stringify(preset.colors) === JSON.stringify(appearance.colors))?.id || (Object.keys(appearance.colors).length ? 'custom' : appearance.theme);
}
