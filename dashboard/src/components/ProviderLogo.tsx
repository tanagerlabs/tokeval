import type { TokenizerProvider } from "../lib/tokenizer";

interface ProviderLogoProps {
  provider: TokenizerProvider;
}

export function ProviderLogo({ provider }: ProviderLogoProps) {
  return (
    <span
      className={`provider-logo provider-logo--${provider}`}
      aria-hidden="true"
    >
      <span className="provider-logo__mark" />
    </span>
  );
}
