'use client';
import { useEffect, useState } from 'react';
import type { ProgressStage } from '@/lib/ai/stream-events';
const labels:Record<ProgressStage,string>={sources:'Membaca sumber',connecting:'Menghubungkan',thinking:'Memproses',tool:'Menjalankan tool',buffered:'Menunggu hasil CLI',saving:'Menyimpan hasil'};
export default function ChatProgress({ stage, answering }: {stage:ProgressStage;answering:boolean}){
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{const start=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[]);
  return <div className="chat-progress flex items-center gap-3 text-xs text-gray-500" role="status" aria-live="polite"><span className="typing-dots" aria-hidden><i /><i /><i /></span><span>{answering?'Menulis jawaban':labels[stage] || 'Memproses'}</span><span className="tabular-nums" aria-hidden>{elapsed}s</span></div>;
}
