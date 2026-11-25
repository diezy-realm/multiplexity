'use client';
import type { ProgressStage } from '@/lib/ai/stream-events';
export interface RunStep {stage:ProgressStage;at:string}
const labels:Record<ProgressStage,string>={sources:'Membaca sumber',connecting:'Menghubungkan provider',thinking:'Memproses permintaan',tool:'Aktivitas tool',buffered:'Menunggu respons lengkap CLI',saving:'Menyimpan hasil'};
export default function RunTimeline({steps}:{steps:RunStep[]}) {
  if(!steps.length)return null;
  return <details className="my-2 text-xs text-gray-500"><summary className="cursor-pointer">Aktivitas · {steps.length}</summary><ol className="mt-2 border-l pl-3 space-y-2">{steps.map((step,index)=><li key={index}><time className="tabular-nums mr-2">{new Date(step.at).toLocaleTimeString()}</time>{labels[step.stage]}</li>)}</ol></details>;
}
