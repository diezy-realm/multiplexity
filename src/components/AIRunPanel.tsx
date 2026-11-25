'use client';
import MarkdownOutput from './MarkdownOutput';
import ChatProgress from './ChatProgress';
import RunTimeline,{type RunStep} from './RunTimeline';
import type {ProgressStage} from '@/lib/ai/stream-events';
export default function AIRunPanel({text,busy,stage,steps=[]}:{text:string;busy:boolean;stage:ProgressStage;steps?:RunStep[]}) {
  return <div className="min-w-0">{text&&<MarkdownOutput content={text} pending={busy}/>}<RunTimeline steps={steps}/>{busy&&<ChatProgress stage={stage} answering={!!text}/>}</div>;
}
