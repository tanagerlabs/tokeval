import type { TokenizerProvider } from "../lib/tokenizer";
import { providerCatalogEntry } from "../lib/catalog";

interface ProviderLogoProps {
  provider: TokenizerProvider;
}

export function ProviderLogo({ provider }: ProviderLogoProps) {
  const catalogEntry = providerCatalogEntry(provider);
  return (
    <span
      className={`provider-logo provider-logo--${provider}`}
      aria-hidden="true"
    >
      <span className="provider-logo__mark" />
      <span className="provider-logo__fallback">{catalogEntry?.mark ?? "AI"}</span>
    </span>
  );
}
