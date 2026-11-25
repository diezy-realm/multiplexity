'use client';
import {useEffect,useState} from 'react';
import {parse,type ParseError} from 'jsonc-parser';
import {THEME_KEYS,type Appearance} from '@/lib/appearance';

export default function ThemeJsonEditor({appearance,onApply}:{appearance:Appearance;onApply:(value:Appearance)=>Promise<void>}) {
 const [text,setText]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
 useEffect(()=>setText(JSON.stringify({name:'Multiplexity custom',type:appearance.theme,colors:appearance.colors},null,2)),[appearance]);
 async function apply(){setBusy(true);setError('');try{const errors:ParseError[]=[];const value=parse(text,errors,{allowTrailingComma:true});if(errors.length || !value || !['dark','light'].includes(value.type) || !value.colors || typeof value.colors!=='object' || Array.isArray(value.colors)) throw new Error('Gunakan type dark/light dan object colors.');const entries=Object.entries(value.colors);if(entries.some(([key,color])=>!THEME_KEYS.includes(key)||typeof color!=='string'||!/^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(color)))throw new Error('Key warna tidak didukung atau nilai hex tidak valid.');await onApply({...appearance,theme:value.type,colors:value.colors});}catch(error){setError(error instanceof Error?error.message:'Konfigurasi gagal.');}finally{setBusy(false);}}
 return <div className="space-y-2"><label className="block text-sm">Theme JSON / JSONC<textarea aria-label="Theme JSON" value={text} maxLength={100000} rows={10} onChange={event=>setText(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-3 font-mono text-xs" /></label><button disabled={busy} onClick={()=>void apply()} className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm">Terapkan JSON</button><p className="text-xs text-gray-500">Format color theme VS Code: type dan colors. Komentar dan trailing comma didukung.</p>{error && <p role="alert" className="text-xs text-red-500">{error}</p>}</div>;
}
