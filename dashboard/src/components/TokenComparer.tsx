import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  compareHostedText,
  HOSTED_MODEL_PROFILES,
  HostedApiError,
  type HostedResult,
  type HostedStatus,
} from "../lib/hosted-tokenizer";
import { OPEN_MODEL_PROFILES } from "../lib/open-model-profiles";
import { hasCrossedSwapEdge, moveItem } from "../lib/model-order";
import {
  removeTokenizationResults,
  replaceTokenizationResults,
} from "../lib/tokenization-results";
import type { TokenizationResult } from "../lib/tokenizer";
import { ProviderLogo } from "./ProviderLogo";
import { TokenCard } from "./TokenCard";

interface TokenComparerProps {
  initialText: string;
  initialResults: TokenizationResult[];
}

const CORE_MODEL_IDS = new Set(["openai-o200k", "openai-cl100k"]);
const OPEN_MODEL_IDS = new Set(OPEN_MODEL_PROFILES.map((profile) => profile.id));

function resultKey(result: TokenizationResult): string {
  return result.profile.id || result.profile.encoding;
}

function hostedErrorMessage(code: string | null): string {
  if (code === "API_NOT_CONFIGURED") return "Hosted API is not configured for this deployment.";
  if (code === "NETWORK_OR_CORS") {
    return "Could not reach the hosted API. Check that the Worker is running and this page origin is allowed.";
  }
  if (code === "FEATURE_DISABLED") return "This provider is not enabled on the server yet.";
  if (code === "MISSING_PROVIDER_CREDENTIALS") return "Provider credentials are not configured.";
  if (code === "ANTHROPIC_WORKSPACE_REQUIRED") {
    return "Anthropic requires ANTHROPIC_WORKSPACE_ID for this API key.";
  }
  if (code === "UPSTREAM_RATE_LIMITED" || code === "RATE_LIMITED") {
    return "The provider is temporarily rate limited.";
  }
  if (code === "UPSTREAM_TIMEOUT") return "The provider did not respond in time.";
  if (code === "UPSTREAM_MODEL_UNAVAILABLE") return "The configured model is unavailable.";
  return "The hosted result is temporarily unavailable.";
}

interface DragState {
  id: string;
  modelName: string;
  pointerId: number;
  handle: HTMLButtonElement;
  grabOffset: number;
  clientY: number;
  lastClientY: number;
  lastSwapClientY: number | null;
  lastSwapDirection: -1 | 1 | null;
  translateY: number;
}

const REORDER_ANIMATION = {
  duration: 220,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};

const REVERSE_DIRECTION_HYSTERESIS = 24;

interface VerticalBounds {
  top: number;
  height: number;
}

function naturalVerticalBounds(element: HTMLElement): VerticalBounds {
  const bounds = element.getBoundingClientRect();
  const transform = window.getComputedStyle(element).transform;
  let translateY = 0;

  if (transform !== "none") {
    try {
      translateY = new DOMMatrixReadOnly(transform).m42;
    } catch {
      // A malformed or unsupported transform should not interrupt dragging.
    }
  }

  const top = bounds.top - translateY;
  return { top, height: bounds.height };
}

export function TokenComparer({
  initialText,
  initialResults,
}: TokenComparerProps) {
  const hasPreloadedOpenResults = OPEN_MODEL_PROFILES.every((profile) =>
    initialResults.some((result) => result.profile.id === profile.id),
  );
  const inputId = useId();
  const reorderHelpId = useId();
  const requestId = useRef(0);
  const hostedAbortController = useRef<AbortController | null>(null);
  const rowElements = useRef(new Map<string, HTMLElement>());
  const previousRowPositions = useRef<Map<string, number> | null>(null);
  const dragState = useRef<DragState | null>(null);
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
  const [modelOrder, setModelOrder] = useState(() =>
    Array.from(
      new Set([
        ...initialResults.map(resultKey),
        ...OPEN_MODEL_PROFILES.map((profile) => profile.id),
        ...HOSTED_MODEL_PROFILES.map((profile) => profile.id),
      ]),
    ),
  );
  const modelOrderRef = useRef(modelOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");

  modelOrderRef.current = modelOrder;

  useLayoutEffect(() => {
    const previous = previousRowPositions.current;
    previousRowPositions.current = null;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (previous && !reduceMotion) {
      for (const [id, element] of rowElements.current) {
        if (id === dragState.current?.id) continue;
        const previousTop = previous.get(id);
        if (previousTop === undefined) continue;
        const delta = previousTop - element.getBoundingClientRect().top;
        if (Math.abs(delta) < 0.5) continue;

        if (typeof element.animate !== "function") continue;
        element.animate(
          [
            { transform: `translateY(${delta}px)` },
            { transform: "translateY(0)" },
          ],
          REORDER_ANIMATION,
        );
      }
    }

    const activeDrag = dragState.current;
    if (activeDrag) positionDraggedRow(activeDrag);
  }, [modelOrder]);

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
      const isCurrentRequest = () =>
        !cancelled && currentRequest === requestId.current;
      const updateGroup = (
        next: TokenizationResult[],
        groupIds: ReadonlySet<string>,
      ) => {
        if (!isCurrentRequest()) return;
        setResults((current) =>
          replaceTokenizationResults(current, next, groupIds),
        );
      };

      const coreTask = import("../lib/tokenizer")
        .then(({ tokenizeAll }) => tokenizeAll(text))
        .then((next) => {
          updateGroup(next, CORE_MODEL_IDS);
          return next;
        });
      const openTask = import("../lib/open-tokenizer-client")
        .then(({ tokenizeOpenModelsInWorker }) =>
          tokenizeOpenModelsInWorker(text),
        )
        .then((next) => {
          updateGroup(next, OPEN_MODEL_IDS);
          return next;
        });
      const outcomes = await Promise.allSettled([coreTask, openTask]);
      if (!isCurrentRequest()) return;

      const failedGroups = outcomes.flatMap((outcome, index) =>
        outcome.status === "rejected"
          ? [index === 0 ? CORE_MODEL_IDS : OPEN_MODEL_IDS]
          : [],
      );
      if (failedGroups.length > 0) {
        const failedIds = new Set(
          failedGroups.flatMap((groupIds) => Array.from(groupIds)),
        );
        setResults((current) => removeTokenizationResults(current, failedIds));
        console.error(
          "Local tokenizer update failed.",
          outcomes.map((outcome, index) => ({
            group: index === 0 ? "core" : "open-model",
            status: outcome.status,
            error:
              outcome.status === "rejected" && outcome.reason instanceof Error
                ? outcome.reason.name
                : null,
            message:
              outcome.status === "rejected" && outcome.reason instanceof Error
                ? outcome.reason.message
                : null,
          })),
        );
        setStatus("error");
        return;
      }

      lastTokenizedKey.current = tokenizationKey;
      setStatus("ready");
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

  useEffect(() => {
    if (!draggingId) return;

    function handlePointerMove(event: globalThis.PointerEvent): void {
      const activeDrag = dragState.current;
      if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      continueDrag(event.pointerId, event.clientY);
    }

    function handlePointerEnd(event: globalThis.PointerEvent): void {
      finishDrag(event.pointerId);
    }

    function handleWindowBlur(): void {
      finishDrag();
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") finishDrag();
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState !== "visible") finishDrag();
    }

    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [draggingId]);

  function toggleTokenizer(tokenizerId: string): void {
    setReducedTokenizerIds((current) => {
      const next = new Set(current);
      if (next.has(tokenizerId)) next.delete(tokenizerId);
      else next.add(tokenizerId);
      return next;
    });
  }

  function setRowElement(id: string, element: HTMLElement | null): void {
    if (element) rowElements.current.set(id, element);
    else rowElements.current.delete(id);
  }

  function captureRowPositions(): Map<string, number> {
    return new Map(
      Array.from(rowElements.current, ([id, element]) => [
        id,
        element.getBoundingClientRect().top,
      ]),
    );
  }

  function applyModelOrder(next: string[]): void {
    const current = modelOrderRef.current;
    if (
      next.length === current.length &&
      next.every((id, index) => id === current[index])
    ) {
      return;
    }

    previousRowPositions.current = captureRowPositions();
    modelOrderRef.current = next;
    setModelOrder(next);
  }

  function positionDraggedRow(activeDrag: DragState): void {
    const element = rowElements.current.get(activeDrag.id);
    if (!element) return;

    const currentTop = element.getBoundingClientRect().top;
    const naturalTop = currentTop - activeDrag.translateY;
    activeDrag.translateY =
      activeDrag.clientY - activeDrag.grabOffset - naturalTop;
    element.style.setProperty("--drag-y", `${activeDrag.translateY}px`);
  }

  function beginDrag(
    event: PointerEvent<HTMLButtonElement>,
    modelId: string,
    modelName: string,
  ): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const element = rowElements.current.get(modelId);
    if (!element) return;

    event.preventDefault();
    element.getAnimations().forEach((animation) => animation.cancel());
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = element.getBoundingClientRect();
    dragState.current = {
      id: modelId,
      modelName,
      pointerId: event.pointerId,
      handle: event.currentTarget,
      grabOffset: event.clientY - bounds.top,
      clientY: event.clientY,
      lastClientY: event.clientY,
      lastSwapClientY: null,
      lastSwapDirection: null,
      translateY: 0,
    };
    setReorderAnnouncement("");
    setDraggingId(modelId);
  }

  function continueDrag(pointerId: number, clientY: number): void {
    const activeDrag = dragState.current;
    if (!activeDrag || activeDrag.pointerId !== pointerId) return;

    const pointerDelta = clientY - activeDrag.lastClientY;
    const direction: -1 | 0 | 1 =
      pointerDelta < -0.5 ? -1 : pointerDelta > 0.5 ? 1 : 0;
    activeDrag.lastClientY = clientY;
    activeDrag.clientY = clientY;
    positionDraggedRow(activeDrag);

    if (direction === 0) return;
    if (
      activeDrag.lastSwapClientY !== null &&
      activeDrag.lastSwapDirection !== direction &&
      Math.abs(clientY - activeDrag.lastSwapClientY) <
        REVERSE_DIRECTION_HYSTERESIS
    ) {
      return;
    }

    const current = modelOrderRef.current;
    const currentIndex = current.indexOf(activeDrag.id);
    if (currentIndex < 0) return;
    const neighborIndex = currentIndex + direction;
    const neighborId = current[neighborIndex];
    const activeElement = rowElements.current.get(activeDrag.id);
    const neighborElement = rowElements.current.get(neighborId);
    if (!activeElement || !neighborElement) return;

    const activeTop = clientY - activeDrag.grabOffset;
    const activeHeight = activeElement.offsetHeight;
    const neighborBounds = naturalVerticalBounds(neighborElement);
    const shouldSwap = hasCrossedSwapEdge(
      direction,
      activeTop,
      activeHeight,
      neighborBounds.top,
      neighborBounds.height,
    );

    if (!shouldSwap) return;

    applyModelOrder(moveItem(current, currentIndex, neighborIndex));
    activeDrag.lastSwapClientY = clientY;
    activeDrag.lastSwapDirection = direction;
  }

  function finishDrag(pointerId?: number): void {
    const activeDrag = dragState.current;
    if (
      !activeDrag ||
      (pointerId !== undefined && activeDrag.pointerId !== pointerId)
    ) {
      return;
    }

    if (activeDrag.handle.hasPointerCapture(activeDrag.pointerId)) {
      activeDrag.handle.releasePointerCapture(activeDrag.pointerId);
    }

    const element = rowElements.current.get(activeDrag.id);
    const releasedOffset = activeDrag.translateY;
    element?.style.removeProperty("--drag-y");
    dragState.current = null;
    setDraggingId(null);

    if (
      element &&
      typeof element.animate === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      Math.abs(releasedOffset) >= 0.5
    ) {
      element.animate(
        [
          { transform: `translateY(${releasedOffset}px) scale(1.01)` },
          { transform: "translateY(0) scale(1)" },
        ],
        { ...REORDER_ANIMATION, duration: 180 },
      );
    }

    const position = modelOrderRef.current.indexOf(activeDrag.id) + 1;
    setReorderAnnouncement(
      `${activeDrag.modelName} moved to position ${position} of ${modelOrderRef.current.length}.`,
    );
  }

  function reorderWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    modelId: string,
    modelName: string,
  ): void {
    const current = modelOrderRef.current;
    const fromIndex = current.indexOf(modelId);
    let toIndex = fromIndex;

    if (event.key === "ArrowUp") toIndex -= 1;
    else if (event.key === "ArrowDown") toIndex += 1;
    else if (event.key === "Home") toIndex = 0;
    else if (event.key === "End") toIndex = current.length - 1;
    else return;

    event.preventDefault();
    toIndex = Math.max(0, Math.min(current.length - 1, toIndex));
    if (toIndex === fromIndex) return;

    applyModelOrder(moveItem(current, fromIndex, toIndex));
    setReorderAnnouncement(
      `${modelName} moved to position ${toIndex + 1} of ${current.length}.`,
    );
  }

  function renderDragHandle(modelId: string, modelName: string) {
    const label = `Reorder ${modelName}`;

    return (
      <button
        className="result-panel__drag-handle"
        type="button"
        aria-label={label}
        aria-describedby={reorderHelpId}
        title={`${label} (drag or use arrow keys)`}
        onPointerDown={(event) => beginDrag(event, modelId, modelName)}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.pointerId)}
        onKeyDown={(event) => reorderWithKeyboard(event, modelId, modelName)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8" cy="7" r="1.25" />
          <circle cx="16" cy="7" r="1.25" />
          <circle cx="8" cy="12" r="1.25" />
          <circle cx="16" cy="12" r="1.25" />
          <circle cx="8" cy="17" r="1.25" />
          <circle cx="16" cy="17" r="1.25" />
        </svg>
      </button>
    );
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
              : " Disabled by default. Click Enable to send the current text to Anthropic, Google, and xAI."}
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

      <p className="visually-hidden" id={reorderHelpId}>
        Drag to reorder, or use the up and down arrow keys. Home and End move a
        model to the start or end of the list.
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement}
      </p>
      <div
        className={`results-list ${status === "loading" ? "is-loading" : ""} ${draggingId ? "results-list--dragging" : ""}`}
      >
        {modelOrder.map((modelId) => {
          const localResult = results.find(
            (candidate) => resultKey(candidate) === modelId,
          );

          if (localResult) {
            const isReduced = reducedTokenizerIds.has(modelId);
            const modelName = localResult.profile.modelExamples;
            const toggleLabel = `${isReduced ? "Expand" : "Reduce"} ${modelName}`;

            return (
              <article
                className={`result-panel ${isReduced ? "result-panel--reduced" : ""} ${draggingId === modelId ? "result-panel--dragging" : ""}`}
                key={modelId}
                ref={(element) => setRowElement(modelId, element)}
              >
                <header className="result-panel__header">
                  <div className="result-panel__identity">
                    <ProviderLogo provider={localResult.profile.provider} />
                    <div className="result-panel__name">
                      <h2>{modelName}</h2>
                      <code>{localResult.profile.encoding}</code>
                    </div>
                  </div>
                  <div className="result-panel__actions">
                    <p>
                      <strong>{localResult.tokens.length}</strong>
                      {localResult.tokens.length === 1 ? " token" : " tokens"}
                    </p>
                    <button
                      className="result-panel__toggle"
                      type="button"
                      aria-expanded={!isReduced}
                      aria-label={toggleLabel}
                      title={toggleLabel}
                      onClick={() => toggleTokenizer(modelId)}
                    >
                      <svg
                        className="result-panel__toggle-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="m7 14 5-5 5 5" />
                      </svg>
                    </button>
                    {renderDragHandle(modelId, modelName)}
                  </div>
                </header>
                <div
                  className="result-panel__body"
                  aria-hidden={isReduced}
                  inert={isReduced}
                >
                  <div className="result-panel__body-inner">
                    <TokenCard result={localResult} />
                    <p className="result-panel__revision">
                      Local · {localResult.profile.sourceUrl ? (
                        <a
                          href={localResult.profile.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {localResult.tokenizerRevision}
                        </a>
                      ) : localResult.tokenizerRevision}
                    </p>
                  </div>
                </div>
              </article>
            );
          }

          const pendingProfile =
            initialResults.find((candidate) => resultKey(candidate) === modelId)?.profile ??
            OPEN_MODEL_PROFILES.find((profile) => profile.id === modelId);

          if (pendingProfile) {
            const isReduced = reducedTokenizerIds.has(modelId);
            const modelName = pendingProfile.modelExamples;
            const toggleLabel = `${isReduced ? "Expand" : "Reduce"} ${modelName}`;

            return (
              <article
                className={`result-panel result-panel--pending ${isReduced ? "result-panel--reduced" : ""} ${draggingId === modelId ? "result-panel--dragging" : ""}`}
                key={modelId}
                ref={(element) => setRowElement(modelId, element)}
              >
                <header className="result-panel__header">
                  <div className="result-panel__identity">
                    <ProviderLogo provider={pendingProfile.provider} />
                    <div className="result-panel__name">
                      <h2>{modelName}</h2>
                      <code>{pendingProfile.encoding}</code>
                    </div>
                  </div>
                  <div className="result-panel__actions">
                    <p>
                      {status === "error" ? "Unavailable" : "Loading tokenizer…"}
                    </p>
                    <button
                      className="result-panel__toggle"
                      type="button"
                      aria-expanded={!isReduced}
                      aria-label={toggleLabel}
                      title={toggleLabel}
                      onClick={() => toggleTokenizer(modelId)}
                    >
                      <svg
                        className="result-panel__toggle-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="m7 14 5-5 5 5" />
                      </svg>
                    </button>
                    {renderDragHandle(modelId, modelName)}
                  </div>
                </header>
              </article>
            );
          }

          const profile = HOSTED_MODEL_PROFILES.find(
            (candidate) => candidate.id === modelId,
          );
          if (!profile) return null;

          const result = hostedResults.find(
            (candidate) => candidate.profile.id === profile.id,
          );
          const isReduced = reducedTokenizerIds.has(modelId);
          const modelName = profile.modelExamples;
          const toggleLabel = `${isReduced ? "Expand" : "Reduce"} ${modelName}`;
          const isUnavailable = result?.status === "unavailable";
          const rowError = isUnavailable ? result.error?.code ?? null : hostedError;
          const count = result?.status === "ok" ? result.tokenCount : null;
          const resolvedModel = result?.resolvedModel ?? profile.encoding;

          return (
            <article
              className={`result-panel result-panel--hosted ${isReduced ? "result-panel--reduced" : ""} ${draggingId === modelId ? "result-panel--dragging" : ""}`}
              key={modelId}
              ref={(element) => setRowElement(modelId, element)}
            >
              <header className="result-panel__header">
                <div className="result-panel__identity">
                  <ProviderLogo provider={profile.provider} />
                  <div className="result-panel__name">
                    <h2>{modelName}</h2>
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
                    onClick={() => toggleTokenizer(modelId)}
                  >
                    <svg
                      className="result-panel__toggle-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="m7 14 5-5 5 5" />
                    </svg>
                  </button>
                  {renderDragHandle(modelId, modelName)}
                </div>
              </header>
              <div
                className="result-panel__body"
                aria-hidden={isReduced}
                inert={isReduced}
              >
                <div className="result-panel__body-inner">
                  {!hostedEnabled && (
                    <div className="hosted-output-note">
                      Hosted requests are off. {" "}
                      <button type="button" onClick={() => setHostedEnabled(true)}>
                        Enable hosted counts
                      </button>
                    </div>
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
