'use client';
import { useState, type ReactNode } from 'react';
import Dialog from './Dialog';
export interface Confirmation {title:string;target?:string;description:string;action:()=>Promise<void>}
export default function ConfirmDialog({confirmation,onClose,children}:{confirmation:Confirmation;onClose:()=>void;children?:ReactNode}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog title={confirmation.title} onClose={()=>{if(!busy)onClose();}}><p className="text-sm">{confirmation.description}</p>{confirmation.target&&<p className="my-3 rounded-xl bg-gray-100 dark:bg-gray-900 p-3 text-xs font-mono break-all">{confirmation.target}</p>}{children}{error&&<p role="alert" className="text-sm text-red-500">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className="ui-button" disabled={busy} onClick={onClose}>Batal</button><button type="button" className="ui-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await confirmation.action();onClose();}catch(error){setError(error instanceof Error?error.message:'Aksi gagal.');}finally{setBusy(false);}}}>{busy?'Memproses…':'Lanjutkan'}</button></div></Dialog>;
}
