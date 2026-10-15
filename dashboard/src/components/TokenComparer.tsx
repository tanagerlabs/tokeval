import { useEffect, useId, useRef, useState } from "react";
import type { TokenizationResult } from "../lib/tokenizer";
import { TokenCard } from "./TokenCard";

interface TokenComparerProps {
  initialText: string;
  initialResults: TokenizationResult[];
}

const EXAMPLE_TEXT = "TokenLab으로 AI 비용을 알아봐요 🔬";

export function TokenComparer({
  initialText,
  initialResults,
}: TokenComparerProps) {
  const inputId = useId();
  const requestId = useRef(0);
  const lastTokenizedText = useRef(initialText);
  const [text, setText] = useState(initialText);
  const [results, setResults] = useState(initialResults);
  const [status, setStatus] = useState<"ready" | "loading" | "error">(
    "ready",
  );

  useEffect(() => {
    if (lastTokenizedText.current === text) {
      setStatus("ready");
      return;
    }

    let cancelled = false;
    const currentRequest = ++requestId.current;
    setStatus("loading");

    const timeout = window.setTimeout(async () => {
      try {
        const { tokenizeAll } = await import("../lib/tokenizer");
        const nextResults = await tokenizeAll(text);
        if (cancelled || currentRequest !== requestId.current) return;

        lastTokenizedText.current = text;
        setResults(nextResults);
        setStatus("ready");
      } catch {
        if (!cancelled && currentRequest === requestId.current) {
          setStatus("error");
        }
      }
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [text]);

  const byteCount = new TextEncoder().encode(text).length;
  const characterCount = Array.from(text).length;
  const tokenDifference = Math.abs(
    results[0].tokens.length - results[1].tokens.length,
  );

  return (
    <section className="comparer" aria-label="Tokenizer comparison">
      <div className="input-panel">
        <div className="field-header">
          <label htmlFor={inputId}>Text</label>
          <div>
            <button type="button" onClick={() => setText("")}>Clear</button>
            <button type="button" onClick={() => setText(EXAMPLE_TEXT)}>
              Show example
            </button>
          </div>
        </div>
        <textarea
          id={inputId}
          value={text}
          maxLength={4000}
          rows={7}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type or paste text here…"
        />
      </div>

      <div className="comparison-header">
        <span>Comparison</span>
        <span aria-live="polite">
          {status === "loading" && "Updating both tokenizers…"}
          {status === "error" && "Could not tokenize this text"}
          {status === "ready" &&
            `${results[0].tokens.length} vs ${results[1].tokens.length} · difference ${tokenDifference}`}
        </span>
      </div>

      <div className={`results-list ${status === "loading" ? "is-loading" : ""}`}>
        {results.map((result) => (
          <article className="result-panel" key={result.profile.encoding}>
            <header className="result-panel__header">
              <div>
                <h2>{result.profile.modelExamples}</h2>
                <code>{result.profile.encoding}</code>
              </div>
              <p>
                <strong>{result.tokens.length}</strong>
                {result.tokens.length === 1 ? " token" : " tokens"}
              </p>
            </header>
            <TokenCard result={result} />
            <p className="result-panel__revision">
              Local · {result.tokenizerRevision}
            </p>
          </article>
        ))}

        <article className="result-panel result-panel--planned">
          <header className="result-panel__header">
            <div>
              <h2>TokenLab Korean-aware</h2>
              <code>Planned</code>
            </div>
            <p>Not measured</p>
          </header>
          <div className="planned-output">
            A result will appear here when a versioned experimental tokenizer
            is ready.
          </div>
        </article>
      </div>

      <dl className="input-metrics">
        <div>
          <dt>Characters</dt>
          <dd>{characterCount}</dd>
        </div>
        <div>
          <dt>UTF-8 bytes</dt>
          <dd>{byteCount}</dd>
        </div>
      </dl>

      <p className="unicode-note">
        Token IDs appear beneath each piece. Angle brackets indicate a token
        containing only part of a UTF-8 character; exact bytes are shown instead
        of invented text.
      </p>
    </section>
  );
}
