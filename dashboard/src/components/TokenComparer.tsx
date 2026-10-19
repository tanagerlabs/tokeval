import { useEffect, useId, useRef, useState } from "react";
import {
  compareHostedText,
  HOSTED_MODEL_PROFILES,
  HostedApiError,
  type HostedResult,
  type HostedStatus,
} from "../lib/hosted-tokenizer";
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

function hostedErrorMessage(code: string | null): string {
  if (code === "API_NOT_CONFIGURED") return "Hosted API is not configured for this deployment.";
  if (code === "FEATURE_DISABLED") return "This provider is not enabled on the server yet.";
  if (code === "MISSING_PROVIDER_CREDENTIALS") return "Provider credentials are not configured.";
  if (code === "UPSTREAM_RATE_LIMITED" || code === "RATE_LIMITED") {
    return "The provider is temporarily rate limited.";
  }
  if (code === "UPSTREAM_TIMEOUT") return "The provider did not respond in time.";
  if (code === "UPSTREAM_MODEL_UNAVAILABLE") return "The configured model is unavailable.";
  return "The hosted result is temporarily unavailable.";
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
  const hostedAbortController = useRef<AbortController | null>(null);
  const lastTokenizedKey = useRef(
    hasPreloadedOpenResults ? `all:0:${initialText}` : `initial:${initialText}`,
  );
  const [text, setText] = useState(initialText);
  const [results, setResults] = useState(initialResults);
  const [reducedTokenizerIds, setReducedTokenizerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [retryVersion, setRetryVersion] = useState(0);
  const [hostedRetryVersion, setHostedRetryVersion] = useState(0);
  const [hostedEnabled, setHostedEnabled] = useState(false);
  const [hostedStatus, setHostedStatus] = useState<HostedStatus>("disabled");
  const [hostedResults, setHostedResults] = useState<HostedResult[]>([]);
  const [hostedError, setHostedError] = useState<string | null>(null);
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

  useEffect(() => {
    hostedAbortController.current?.abort();

    if (!hostedEnabled) {
      setHostedStatus("disabled");
      setHostedError(null);
      return;
    }
    if (text.length === 0) {
      setHostedStatus("ready");
      setHostedResults([]);
      setHostedError(null);
      return;
    }

    const controller = new AbortController();
    hostedAbortController.current = controller;
    setHostedStatus("loading");
    setHostedError(null);

    const timeout = window.setTimeout(async () => {
      try {
        const nextResults = await compareHostedText(text, controller.signal);
        if (controller.signal.aborted) return;
        setHostedResults(nextResults);
        setHostedStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setHostedError(error instanceof HostedApiError ? error.code : "REQUEST_FAILED");
        setHostedStatus("error");
      }
    }, 650);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [hostedEnabled, hostedRetryVersion, text]);

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
  const tokenCounts = [
    ...results.map((result) => result.tokens.length),
    ...hostedResults.flatMap((result) =>
      result.status === "ok" && result.tokenCount !== null ? [result.tokenCount] : [],
    ),
  ];
  const minimumTokens = tokenCounts.length > 0 ? Math.min(...tokenCounts) : 0;
  const maximumTokens = tokenCounts.length > 0 ? Math.max(...tokenCounts) : 0;
  const comparisonSummary =
    tokenCounts.length > 0
      ? `${results.length + HOSTED_MODEL_PROFILES.length} models · ${minimumTokens}–${maximumTokens} tokens · spread ${maximumTokens - minimumTokens}`
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

      <div className="hosted-control">
        <p>
          <strong>Hosted counts</strong>
          <span>
            {hostedEnabled
              ? " Text is sent to Anthropic, Google, and xAI for the rows below."
              : " Disabled by default; local tokenizer rows stay in this browser."}
          </span>
        </p>
        <button
          type="button"
          aria-pressed={hostedEnabled}
          onClick={() => setHostedEnabled((current) => !current)}
        >
          {hostedEnabled ? "Disable" : "Enable"}
        </button>
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

        {HOSTED_MODEL_PROFILES.map((profile) => {
          const result = hostedResults.find(
            (candidate) => candidate.profile.id === profile.id,
          );
          const isReduced = reducedTokenizerIds.has(profile.id);
          const toggleLabel = `${isReduced ? "Expand" : "Reduce"} ${profile.modelExamples}`;
          const isUnavailable = result?.status === "unavailable";
          const rowError = isUnavailable ? result.error?.code ?? null : hostedError;
          const count = result?.status === "ok" ? result.tokenCount : null;
          const resolvedModel = result?.resolvedModel ?? profile.encoding;

          return (
            <article
              className={`result-panel result-panel--hosted ${isReduced ? "result-panel--reduced" : ""}`}
              key={profile.id}
            >
              <header className="result-panel__header">
                <div className="result-panel__identity">
                  <ProviderLogo provider={profile.provider} />
                  <div className="result-panel__name">
                    <h2>{profile.modelExamples}</h2>
                    <code>{resolvedModel}</code>
                  </div>
                </div>
                <div className="result-panel__actions">
                  <p aria-live="polite">
                    {!hostedEnabled && "Off"}
                    {hostedEnabled && text.length === 0 && "Waiting for text"}
                    {hostedEnabled && text.length > 0 && hostedStatus === "loading" &&
                      "Counting…"}
                    {hostedEnabled && hostedStatus === "error" && "Unavailable"}
                    {hostedEnabled && hostedStatus === "ready" && isUnavailable &&
                      "Unavailable"}
                    {hostedEnabled && hostedStatus === "ready" && count !== null && (
                      <>
                        <strong>{count}</strong>
                        {count === 1 ? " token" : " tokens"}
                      </>
                    )}
                  </p>
                  <button
                    className="result-panel__toggle"
                    type="button"
                    aria-expanded={!isReduced}
                    aria-label={toggleLabel}
                    title={toggleLabel}
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
              <div
                className="result-panel__body"
                aria-hidden={isReduced}
                inert={isReduced}
              >
                <div className="result-panel__body-inner">
                  {!hostedEnabled && (
                    <p className="hosted-output-note">
                      Enable hosted counts above to request this provider's result.
                    </p>
                  )}
                  {hostedEnabled && text.length === 0 && (
                    <p className="hosted-output-note">Enter text above to request a count.</p>
                  )}
                  {hostedEnabled && text.length > 0 && hostedStatus === "loading" && (
                    <p className="hosted-output-note">Contacting provider…</p>
                  )}
                  {hostedEnabled && hostedStatus === "error" && (
                    <p className="hosted-output-note">{hostedErrorMessage(rowError)}</p>
                  )}
                  {hostedEnabled && hostedStatus === "ready" && isUnavailable && (
                    <p className="hosted-output-note">{hostedErrorMessage(rowError)}</p>
                  )}
                  {hostedEnabled &&
                    hostedStatus === "ready" &&
                    result?.status === "ok" &&
                    result.tokens === null && (
                      <p className="hosted-output-note">
                        Token breakdown unavailable from this provider; the total above
                        is provider reported.
                      </p>
                    )}
                  {hostedEnabled &&
                    hostedStatus === "ready" &&
                    result?.status === "ok" &&
                    result.tokens !== null && (
                      <TokenCard result={{ profile, tokens: result.tokens }} />
                    )}
                  <p className="result-panel__revision">
                    Hosted {profile.supportsBoundaries ? "breakdown" : "count"} · {" "}
                    <a href={profile.sourceUrl} target="_blank" rel="noreferrer">
                      provider API
                    </a>
                  </p>
                </div>
              </div>
            </article>
          );
        })}

        {hostedEnabled && hostedStatus === "error" && (
          <div className="provider-error" role="alert">
            Hosted providers could not be reached. Local results remain available. {" "}
            <button
              type="button"
              onClick={() => setHostedRetryVersion((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        )}

      </div>
    </section>
  );
}
