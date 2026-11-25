import { supportsEffort, type ProviderId } from './catalog';
export function providerCapabilities(provider:ProviderId,model:string) {
  return {
    images:['openai','claude','codex','gemini','ollama','custom'].includes(provider),
    effort:supportsEffort(provider,model),
    tools:['openai','claude'].includes(provider)?'Artifact':['codex','kiro','antigravity'].includes(provider)?'Tool CLI sesuai permission':'Konteks terpilih',
    streaming:provider==='kiro'?'Buffered + reveal':'Stream; granularitas mengikuti provider',
  };
}
