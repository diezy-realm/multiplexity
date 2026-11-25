export default function ChangePreview({before,after}:{before:string;after:string}) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs"><section className="min-w-0"><h3 className="mb-2 font-medium">Sebelum</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border p-3">{before||'(kosong)'}</pre></section><section className="min-w-0"><h3 className="mb-2 font-medium">Sesudah</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border p-3">{after||'(kosong)'}</pre></section></div>;
}
