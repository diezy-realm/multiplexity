import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg';
import claudeSvg from '@lobehub/icons-static-svg/icons/claude-color.svg';
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import ollamaSvg from '@lobehub/icons-static-svg/icons/ollama.svg';
import codexSvg from '@lobehub/icons-static-svg/icons/codex-color.svg';
import kiroSvg from '@lobehub/icons-static-svg/icons/kiro-color.svg';
import antigravitySvg from '@lobehub/icons-static-svg/icons/antigravity-color.svg';
import { Cpu } from 'lucide-react';
import type { ProviderId } from '@/lib/ai/catalog';

const PROVIDER_ICONS: Partial<Record<ProviderId, string>> = {
  openai: openaiSvg,
  claude: claudeSvg,
  gemini: geminiSvg,
  ollama: ollamaSvg,
  codex: codexSvg,
  kiro: kiroSvg,
  antigravity: antigravitySvg,
};

export default function ProviderBrandIcon({
  provider,
  size = 18,
  className = '',
}: {
  provider: ProviderId;
  size?: number;
  className?: string;
}) {
  const src = PROVIDER_ICONS[provider];
  if (!src) {
    return <Cpu aria-hidden="true" size={size} className={`shrink-0 ${className}`} />;
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
