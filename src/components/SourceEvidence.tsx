'use client';
import { useState } from 'react';
import Dialog from './Dialog';
export interface Evidence {label:string;timestamp:string;excerpt?:string;truncated?:boolean;kind?:string;target?:string;vmId?:string}
export default function SourceEvidence({sources}:{sources:Evidence[]}) {
  const [selected,setSelected]=useState<Evidence>();
  return <><div className="mt-3 flex flex-wrap gap-2">{sources.map((source,index)=><button type="button" key={index} className="ui-button text-xs" onClick={()=>setSelected(source)}>{source.label}</button>)}</div>{selected&&<Dialog title="Bukti sumber" onClose={()=>setSelected(undefined)} className="max-w-3xl"><p className="text-sm break-all">{selected.label}</p><p className="text-xs text-gray-500 my-2">Diambil: {new Date(selected.timestamp).toLocaleString()}</p><pre className="text-xs whitespace-pre-wrap break-words rounded-xl bg-gray-100 dark:bg-gray-900 p-3 max-h-80 overflow-auto">{selected.excerpt??'Cuplikan tidak tersimpan pada pesan lama.'}</pre>{selected.truncated&&<p className="text-xs mt-2">Cuplikan dibatasi 2.000 karakter dari konteks yang dikirim.</p>}<p className="text-xs text-gray-500 mt-2">Cuplikan saat analisis; bukan log terbaru. Penyaringan kredensial bersifat best effort.</p></Dialog>}</>;
}
