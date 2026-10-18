import { useEffect, useId, useRef, useState } from "react";
import { OPEN_MODEL_PROFILES } from "../lib/open-model-profiles";
import type { TokenizationResult } from "../lib/tokenizer";
import { ProviderLogo } from "./ProviderLogo";
import { TokenCard } from "./TokenCard";

interface TokenComparerProps {
  initialText: string;
  initialResults: TokenizationResult[];
}

function resultKey(result: TokenizationResult): string {
  return result.profile.id || result.profile.encoding;
}

export function TokenComparer({
  initialText,
  initialResults,
}: TokenComparerProps) {
  const hasPreloadedOpenResults = OPEN_MODEL_PROFILES.every((profile) =>
    initialResults.some((result) => result.profile.id === profile.id),
  );
  const inputId = useId();
  const requestId = useRef(0);
  const lastTokenizedKey = useRef(
    hasPreloadedOpenResults ? `all:0:${initialText}` : `initial:${initialText}`,
  );
  const [text, setText] = useState(initialText);
  const [results, setResults] = useState(initialResults);
  const [reducedTokenizerIds, setReducedTokenizerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [retryVersion, setRetryVersion] = useState(0);
  const [status, setStatus] = useState<"ready" | "loading" | "error">(
    hasPreloadedOpenResults ? "ready" : "loading",
  );

  useEffect(() => {
    const tokenizationKey = `all:${retryVersion}:${text}`;
    if (lastTokenizedKey.current === tokenizationKey) {
      setStatus("ready");
      return;
    }

    let cancelled = false;
    const currentRequest = ++requestId.current;
    setStatus("loading");

    const timeout = window.setTimeout(async () => {
      try {
        const { tokenizeAll } = await import("../lib/tokenizer");
        const coreResults = await tokenizeAll(text);
        const openResults = await import("../lib/open-tokenizer-client").then(
          ({ tokenizeOpenModelsInWorker }) =>
            tokenizeOpenModelsInWorker(text),
        );
        if (cancelled || currentRequest !== requestId.current) return;

        lastTokenizedKey.current = tokenizationKey;
        setResults([...coreResults, ...openResults]);
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
  }, [retryVersion, text]);

  function toggleTokenizer(tokenizerId: string): void {
    setReducedTokenizerIds((current) => {
      const next = new Set(current);
      if (next.has(tokenizerId)) next.delete(tokenizerId);
      else next.add(tokenizerId);
      return next;
    });
  }

  const byteCount = new TextEncoder().encode(text).length;
  const characterCount = Array.from(text).length;
  const tokenCounts = results.map((result) => result.tokens.length);
  const minimumTokens = tokenCounts.length > 0 ? Math.min(...tokenCounts) : 0;
  const maximumTokens = tokenCounts.length > 0 ? Math.max(...tokenCounts) : 0;
  const comparisonSummary =
    tokenCounts.length > 0
      ? `${results.length} models · ${minimumTokens}–${maximumTokens} tokens · spread ${maximumTokens - minimumTokens}`
      : "0 models";
  const hasOpenResults = results.some((result) =>
    OPEN_MODEL_PROFILES.some((profile) => profile.id === result.profile.id),
  );

  return (
    <section className="comparer" aria-label="Tokenizer comparison">
      <div className="input-panel">
        <div className="field-header">
          <label htmlFor={inputId}>Text</label>
          <button type="button" onClick={() => setText("")}>Clear</button>
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

      <div className="comparison-header">
        <span>Comparison</span>
        <div className="comparison-header__actions">
          <span aria-live="polite">
            {status === "loading" &&
              `Updating ${2 + OPEN_MODEL_PROFILES.length} tokenizers…`}
            {status === "error" && "Could not update all tokenizers"}
            {status === "ready" && comparisonSummary}
          </span>
        </div>
      </div>

      <div className={`results-list ${status === "loading" ? "is-loading" : ""}`}>
        {results.map((result) => {
          const tokenizerId = resultKey(result);
          const isReduced = reducedTokenizerIds.has(tokenizerId);
          const toggleLabel = `${isReduced ? "Expand" : "Reduce"} ${result.profile.modelExamples}`;

          return (
            <article
              className={`result-panel ${isReduced ? "result-panel--reduced" : ""}`}
              key={tokenizerId}
            >
              <header className="result-panel__header">
                <div className="result-panel__identity">
                  <ProviderLogo provider={result.profile.provider} />
                  <div className="result-panel__name">
                    <h2>{result.profile.modelExamples}</h2>
                    <code>{result.profile.encoding}</code>
                  </div>
                </div>
                <div className="result-panel__actions">
                  <p>
                    <strong>{result.tokens.length}</strong>
                    {result.tokens.length === 1 ? " token" : " tokens"}
                  </p>
                  <button
                    className="result-panel__toggle"
                    type="button"
                    aria-expanded={!isReduced}
                    aria-label={toggleLabel}
                    title={toggleLabel}
                    onClick={() => toggleTokenizer(tokenizerId)}
                  >
                    <svg
                      className="result-panel__toggle-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="m7 14 5-5 5 5" />
                    </svg>
                  </button>
                </div>
              </header>
              <div
                className="result-panel__body"
                aria-hidden={isReduced}
                inert={isReduced}
              >
                <div className="result-panel__body-inner">
                  <TokenCard result={result} />
                  <p className="result-panel__revision">
                    Local · {result.profile.sourceUrl ? (
                      <a
                        href={result.profile.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {result.tokenizerRevision}
                      </a>
                    ) : result.tokenizerRevision}
                  </p>
                </div>
              </div>
            </article>
          );
        })}

        {!hasOpenResults &&
          OPEN_MODEL_PROFILES.map((profile) => (
            <article
              className={`result-panel result-panel--pending ${reducedTokenizerIds.has(profile.id) ? "result-panel--reduced" : ""}`}
              key={profile.id}
            >
              <header className="result-panel__header">
                <div className="result-panel__identity">
                  <ProviderLogo provider={profile.provider} />
                  <div className="result-panel__name">
                    <h2>{profile.modelExamples}</h2>
                    <code>{profile.encoding}</code>
                  </div>
                </div>
                <div className="result-panel__actions">
                  <p>
                    {status === "error" ? "Unavailable" : "Loading tokenizer…"}
                  </p>
                  <button
                    className="result-panel__toggle"
                    type="button"
                    aria-expanded={!reducedTokenizerIds.has(profile.id)}
                    aria-label={`${reducedTokenizerIds.has(profile.id) ? "Expand" : "Reduce"} ${profile.modelExamples}`}
                    title={`${reducedTokenizerIds.has(profile.id) ? "Expand" : "Reduce"} ${profile.modelExamples}`}
                    onClick={() => toggleTokenizer(profile.id)}
                  >
                    <svg
                      className="result-panel__toggle-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="m7 14 5-5 5 5" />
                    </svg>
                  </button>
                </div>
              </header>
            </article>
          ))}

        {status === "error" && (
          <div className="provider-error" role="alert">
            Open-model tokenizer files could not be loaded. Your text stayed in
            this browser. {" "}
            <button
              type="button"
              onClick={() => setRetryVersion((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        )}

      </div>
    </section>
  );
}
