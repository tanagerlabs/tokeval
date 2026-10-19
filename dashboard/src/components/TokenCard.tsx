import type { TokenPiece, TokenizationResult } from "../lib/tokenizer";

interface TokenCardProps {
  result: Pick<TokenizationResult, "profile" | "tokens">;
}

interface EmptyTokenOutputProps {
  label: string;
}

export const EMPTY_TOKEN_OUTPUT_MESSAGE = "Enter some text above.";

export function EmptyTokenOutput({ label }: EmptyTokenOutputProps) {
  return (
    <section className="token-output" aria-label={`${label} result`}>
      <p className="empty-output">{EMPTY_TOKEN_OUTPUT_MESSAGE}</p>
    </section>
  );
}

function visibleText(text: string): string {
  if (text.length === 0) return "empty";

  return text
    .replaceAll(" ", "␠")
    .replaceAll("\n", "↵")
    .replaceAll("\t", "⇥");
}

function byteHex(token: TokenPiece): string {
  return token.bytes
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

export function TokenCard({ result }: TokenCardProps) {
  const { profile, tokens } = result;

  if (tokens.length === 0) {
    return <EmptyTokenOutput label={profile.label} />;
  }

  return (
    <section className="token-output" aria-label={`${profile.label} result`}>
      <ol
        className="token-stream"
        aria-label={`${profile.label} token breakdown`}
      >
        {tokens.map((token) => {
          const isByteFragment = token.text === null;
          const label = token.text === null
            ? `‹${byteHex(token)}›`
            : visibleText(token.text);

          return (
            <li
              className={isByteFragment ? "token token--bytes" : "token"}
              key={`${token.index}-${token.id}`}
              tabIndex={0}
              title={`Token ${token.id} · bytes ${token.byteStart}–${token.byteEnd} · ${byteHex(token)}`}
            >
              <span className="token__text">{label}</span>
              <span className="token__id">{token.id}</span>
            </li>
          );
        })}
      </ol>

    </section>
  );
}

