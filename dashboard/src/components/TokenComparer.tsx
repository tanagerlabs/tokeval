import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
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
import {
  buildModelCatalog,
  defaultModelOrder,
} from "../lib/model-catalog";
import { OPEN_MODEL_PROFILES } from "../lib/open-model-profiles";
import { hasCrossedSwapEdge, moveItem } from "../lib/model-order";
import {
  removeTokenizationResults,
  replaceTokenizationResults,
} from "../lib/tokenization-results";
import type { TokenizationResult } from "../lib/tokenizer";
import { ProviderLogo } from "./ProviderLogo";
import { EmptyTokenOutput, TokenCard } from "./TokenCard";
import { TokenCountPlaceholder } from "./TokenCountPlaceholder";

interface TokenComparerProps {
  initialText: string;
  initialResults: TokenizationResult[];
  initialHostedResults: HostedResult[];
}

const HOSTED_DEBOUNCE_MS = 650;
const XAI_HOSTED_DEBOUNCE_MS = 1300;
const CORE_MODEL_IDS = ["openai-o200k", "openai-cl100k"] as const;

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
  handle: HTMLElement;
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
const CARD_DRAG_EXCLUSION_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  ".result-panel__name h2",
  ".result-panel__name code",
  ".result-panel__actions > p",
  ".estimate-badge",
  ".exact-badge",
  ".token",
  ".empty-output",
  ".hosted-output-note",
  ".result-panel__revision",
].join(",");

interface VerticalBounds {
  top: number;
  height: number;
}

interface EstimateBadgeProps {
  provider: "anthropic" | "google";
}

function EstimateBadge({ provider }: EstimateBadgeProps) {
  const tooltipId = useId();
  const providerName = provider === "anthropic" ? "Anthropic" : "Google";

  return (
    <span
      className="estimate-badge"
      tabIndex={0}
      aria-describedby={tooltipId}
    >
      estimate
      <span className="estimate-badge__tooltip" id={tooltipId} role="tooltip">
        {providerName} does not expose raw token pieces for this model. TokEval
        subtracts an empty-wrapper count from the same wrapper containing your
        text. Additional boundary contexts are used only if the primary
        differential is invalid. The estimate can differ from the provider&apos;s
        full structured-input count.
      </span>
    </span>
  );
}

function ExactBadge() {
  return (
    <span
      className="exact-badge"
      aria-label="Exact raw-content token count"
      title="Exact raw-content token count from exposed tokenizer output."
    >
      exact
    </span>
  );
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
  initialHostedResults,
}: TokenComparerProps) {
  const inputId = useId();
  const reorderHelpId = useId();
  const addModelId = useId();
  const modelCatalog = useMemo(
    () => buildModelCatalog(initialResults),
    [initialResults],
  );
  const initialModelOrder = useMemo(
    () => defaultModelOrder(modelCatalog),
    [modelCatalog],
  );
  const initialOpenModelIds = OPEN_MODEL_PROFILES
    .filter((profile) => initialModelOrder.includes(profile.id))
    .map((profile) => profile.id);
  const initialCoreModelIds = CORE_MODEL_IDS.filter((id) =>
    initialModelOrder.includes(id)
  );
  const hasPreloadedCoreResults = initialCoreModelIds.every((id) =>
    initialResults.some((result) => result.profile.id === id),
  );
  const hasPreloadedOpenResults = initialOpenModelIds.every((id) =>
    initialResults.some((result) => result.profile.id === id),
  );
  const hasPreloadedHostedResults = HOSTED_MODEL_PROFILES
    .filter((profile) => initialModelOrder.includes(profile.id))
    .every((profile) =>
      initialHostedResults.some((result) => result.profile.id === profile.id),
    );
  const requestId = useRef(0);
  const hostedAbortController = useRef<AbortController | null>(null);
  const lastHostedTokenizedKey = useRef(
    hasPreloadedHostedResults
      ? `hosted:0:${initialText}`
      : "initial-hosted-results-missing",
  );
  const rowElements = useRef(new Map<string, HTMLElement>());
  const previousRowPositions = useRef<Map<string, number> | null>(null);
  const dragState = useRef<DragState | null>(null);
  const lastTokenizedKey = useRef(
    hasPreloadedCoreResults && hasPreloadedOpenResults
      ? `local:0:${initialText}`
      : `initial:${initialText}`,
  );
  const [text, setText] = useState(initialText);
  const [results, setResults] = useState(initialResults);
  const [reducedTokenizerIds, setReducedTokenizerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [retryVersion, setRetryVersion] = useState(0);
  const [hostedRetryVersion, setHostedRetryVersion] = useState(0);
  const [hostedStatus, setHostedStatus] = useState<HostedStatus>("ready");
  const [hostedResults, setHostedResults] = useState<HostedResult[]>(
    initialHostedResults,
  );
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [status, setStatus] = useState<"ready" | "loading" | "error">(
    hasPreloadedCoreResults && hasPreloadedOpenResults ? "ready" : "loading",
  );
  const [modelOrder, setModelOrder] = useState(initialModelOrder);
  const [selectedAddModelId, setSelectedAddModelId] = useState("");
  const modelOrderRef = useRef(modelOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");

  modelOrderRef.current = modelOrder;

  const activeHostedProfiles = HOSTED_MODEL_PROFILES.filter((profile) =>
    modelOrder.includes(profile.id),
  );
  const activeCoreModelIds = CORE_MODEL_IDS.filter((id) =>
    modelOrder.includes(id)
  );
  const activeOpenModelIds = OPEN_MODEL_PROFILES
    .filter((profile) => modelOrder.includes(profile.id))
    .map((profile) => profile.id);
  const activeHostedProfilesRef = useRef(activeHostedProfiles);
  const activeCoreModelIdsRef = useRef<readonly string[]>(activeCoreModelIds);
  const activeOpenModelIdsRef = useRef<readonly string[]>(activeOpenModelIds);

  activeHostedProfilesRef.current = activeHostedProfiles;
  activeCoreModelIdsRef.current = activeCoreModelIds;
  activeOpenModelIdsRef.current = activeOpenModelIds;

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
    if (text.length === 0) {
      setStatus("ready");
      return;
    }

    const tokenizationKey = `local:${retryVersion}:${text}`;
    if (lastTokenizedKey.current === tokenizationKey) {
      setStatus("ready");
      return;
    }

    let cancelled = false;
    const currentRequest = ++requestId.current;
    // Selection is intentionally read through refs instead of being an effect
    // dependency. Adding, removing, or reordering cards must not tokenize text;
    // only a text edit (or an explicit retry) starts this work.
    const activeCoreIds = [...activeCoreModelIdsRef.current];
    const activeOpenIds = [...activeOpenModelIdsRef.current];
    const activeLocalIds = new Set([...activeCoreIds, ...activeOpenIds]);
    setResults((current) =>
      current.filter((result) => activeLocalIds.has(resultKey(result)))
    );
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

      const activeCoreIdSet = new Set(activeCoreIds);
      const activeOpenIdSet = new Set(activeOpenIds);
      const coreTask = activeCoreIds.length === 0
        ? Promise.resolve([] as TokenizationResult[])
        : import("../lib/tokenizer")
        .then(({ tokenizeAll }) => tokenizeAll(text, activeCoreIds))
        .then((next) => {
          updateGroup(next, activeCoreIdSet);
          return next;
        });
      const openTask = activeOpenIds.length === 0
        ? Promise.resolve([] as TokenizationResult[])
        : import("../lib/open-tokenizer-client")
        .then(({ tokenizeOpenModelsInWorker }) =>
          tokenizeOpenModelsInWorker(text, activeOpenIds),
        )
        .then((next) => {
          updateGroup(next, activeOpenIdSet);
          return next;
        });
      const outcomes = await Promise.allSettled([coreTask, openTask]);
      if (!isCurrentRequest()) return;

      const failedGroups = outcomes.flatMap((outcome, index) =>
        outcome.status === "rejected"
          ? [index === 0 ? activeCoreIdSet : activeOpenIdSet]
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

    // As with local tokenizers, list changes update this ref without starting a
    // provider request. A text edit or explicit retry is the only trigger.
    const requestedProfiles = [...activeHostedProfilesRef.current];
    if (requestedProfiles.length === 0) {
      setHostedStatus("ready");
      setHostedResults([]);
      setHostedError(null);
      return;
    }
    if (text.length === 0) {
      setHostedStatus("ready");
      setHostedResults([]);
      setHostedError(null);
      return;
    }

    const tokenizationKey = `hosted:${hostedRetryVersion}:${text}`;
    if (lastHostedTokenizedKey.current === tokenizationKey) {
      setHostedStatus("ready");
      setHostedError(null);
      return;
    }

    const controller = new AbortController();
    hostedAbortController.current = controller;
    setHostedStatus("loading");
    setHostedError(null);

    const hostedDebounceMs = requestedProfiles.some(
      (profile) => profile.provider === "xai",
    )
      ? XAI_HOSTED_DEBOUNCE_MS
      : HOSTED_DEBOUNCE_MS;
    const timeout = window.setTimeout(async () => {
      try {
        const nextResults = await compareHostedText(
          text,
          controller.signal,
          requestedProfiles,
        );
        if (controller.signal.aborted) return;
        setHostedResults(nextResults);
        lastHostedTokenizedKey.current = tokenizationKey;
        setHostedStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setHostedError(error instanceof HostedApiError ? error.code : "REQUEST_FAILED");
        setHostedStatus("error");
      }
    }, hostedDebounceMs);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [hostedRetryVersion, text]);

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

  function addModel(): void {
    const current = modelOrderRef.current;
    const addable = modelCatalog.filter(
      (profile) => !current.includes(profile.id),
    );
    const profile =
      addable.find((candidate) => candidate.id === selectedAddModelId) ??
      addable[0];
    if (!profile) return;

    applyModelOrder([...current, profile.id]);
    setSelectedAddModelId("");
    setReorderAnnouncement(
      `${profile.modelExamples} added at position ${current.length + 1}.`,
    );
  }

  function removeModel(modelId: string, modelName: string): void {
    if (dragState.current?.id === modelId) finishDrag();
    const next = modelOrderRef.current.filter((id) => id !== modelId);
    applyModelOrder(next);
    setReducedTokenizerIds((current) => {
      const updated = new Set(current);
      updated.delete(modelId);
      return updated;
    });
    setReorderAnnouncement(`${modelName} removed from the comparison.`);
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
    event: PointerEvent<HTMLElement>,
    modelId: string,
    modelName: string,
  ): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest(CARD_DRAG_EXCLUSION_SELECTOR)
    ) {
      return;
    }

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
    event: KeyboardEvent<HTMLElement>,
    modelId: string,
    modelName: string,
  ): void {
    if (event.target !== event.currentTarget) return;
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

  function renderRemoveButton(modelId: string, modelName: string) {
    const label = `Remove ${modelName}`;

    return (
      <button
        className="result-panel__remove"
        type="button"
        aria-label={label}
        title={label}
        onClick={() => removeModel(modelId, modelName)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7.5 7.5 9 9m0-9-9 9" />
        </svg>
      </button>
    );
  }

  const byteCount = new TextEncoder().encode(text).length;
  const characterCount = Array.from(text).length;
  const selectedModelIds = new Set(modelOrder);
  const addableProfiles = modelCatalog.filter(
    (profile) => !selectedModelIds.has(profile.id),
  );
  const effectiveAddModelId =
    addableProfiles.find((profile) => profile.id === selectedAddModelId)?.id ??
    addableProfiles[0]?.id ??
    "";
  const visibleLocalResults = results.filter((result) =>
    selectedModelIds.has(resultKey(result)),
  );
  const visibleHostedResults = hostedResults.filter((result) =>
    selectedModelIds.has(result.profile.id),
  );
  const tokenCounts = text.length === 0
    ? modelOrder.map(() => 0)
    : [
        ...visibleLocalResults.map((result) => result.tokens.length),
        ...visibleHostedResults.flatMap((result) =>
          result.status === "ok" &&
          (result.contentTokenCount !== null || result.tokenCount !== null)
            ? [result.contentTokenCount ?? result.tokenCount!]
            : [],
        ),
      ];
  const minimumTokens = tokenCounts.length > 0 ? Math.min(...tokenCounts) : 0;
  const maximumTokens = tokenCounts.length > 0 ? Math.max(...tokenCounts) : 0;
  const comparisonSummary =
    tokenCounts.length > 0
      ? `${modelOrder.length} models · ${minimumTokens}–${maximumTokens} tokens · spread ${maximumTokens - minimumTokens}`
      : `${modelOrder.length} models`;
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
            {text.length > 0 && status === "loading" &&
              `Updating ${activeCoreModelIds.length + activeOpenModelIds.length} tokenizers…`}
            {text.length > 0 && status === "error" &&
              "Could not update all tokenizers"}
            {(text.length === 0 || status === "ready") && comparisonSummary}
          </span>
        </div>
      </div>

      <div className="model-picker">
        <label htmlFor={addModelId}>Add a model or tokenizer</label>
        <select
          id={addModelId}
          value={effectiveAddModelId}
          disabled={addableProfiles.length === 0}
          onChange={(event) => setSelectedAddModelId(event.target.value)}
        >
          {addableProfiles.length === 0 ? (
            <option value="">All available models are shown</option>
          ) : (
            addableProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.modelExamples} — {profile.label}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          disabled={addableProfiles.length === 0}
          onClick={addModel}
        >
          <span aria-hidden="true">+</span> Add
        </button>
      </div>

      <p className="visually-hidden" id={reorderHelpId}>
        Drag the card surface to reorder, or focus the card and use the up and
        down arrow keys. Home and End move a model to the start or end of the
        list. Text, token boxes, and card controls do not start dragging.
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement}
      </p>
      <div
        className={`results-list ${text.length > 0 && status === "loading" ? "is-loading" : ""} ${draggingId ? "results-list--dragging" : ""}`}
      >
        {modelOrder.map((modelId) => {
          const localResult = results.find(
            (candidate) => resultKey(candidate) === modelId,
          );

          if (localResult) {
            const isReduced = reducedTokenizerIds.has(modelId);
            const modelName = localResult.profile.modelExamples;
            const displayCount = text.length === 0
              ? 0
              : localResult.tokens.length;
            const toggleLabel = `${isReduced ? "Expand" : "Reduce"} ${modelName}`;

            return (
              <article
                className={`result-panel ${isReduced ? "result-panel--reduced" : ""} ${draggingId === modelId ? "result-panel--dragging" : ""}`}
                key={modelId}
                ref={(element) => setRowElement(modelId, element)}
                tabIndex={0}
                aria-describedby={reorderHelpId}
                onPointerDown={(event) => beginDrag(event, modelId, modelName)}
                onPointerUp={(event) => finishDrag(event.pointerId)}
                onPointerCancel={(event) => finishDrag(event.pointerId)}
                onKeyDown={(event) => reorderWithKeyboard(event, modelId, modelName)}
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
                    <ExactBadge />
                    <p>
                      <strong>{displayCount}</strong>
                      {displayCount === 1 ? " token" : " tokens"}
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
                    {renderRemoveButton(modelId, modelName)}
                  </div>
                </header>
                <div
                  className="result-panel__body"
                  aria-hidden={isReduced}
                  inert={isReduced}
                >
                  <div className="result-panel__body-inner">
                    {text.length === 0 ? (
                      <EmptyTokenOutput label={localResult.profile.label} />
                    ) : (
                      <TokenCard result={localResult} />
                    )}
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
                tabIndex={0}
                aria-describedby={reorderHelpId}
                onPointerDown={(event) => beginDrag(event, modelId, modelName)}
                onPointerUp={(event) => finishDrag(event.pointerId)}
                onPointerCancel={(event) => finishDrag(event.pointerId)}
                onKeyDown={(event) => reorderWithKeyboard(event, modelId, modelName)}
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
                    <ExactBadge />
                    <p>
                      {text.length === 0 ? (
                        <><strong>0</strong> tokens</>
                      ) : status === "error" ? (
                        "Unavailable"
                      ) : status === "ready" ? (
                        "Edit text to calculate"
                      ) : (
                        "Loading tokenizer…"
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
                    {renderRemoveButton(modelId, modelName)}
                  </div>
                </header>
                {text.length === 0 && (
                  <div
                    className="result-panel__body"
                    aria-hidden={isReduced}
                    inert={isReduced}
                  >
                    <div className="result-panel__body-inner">
                      <EmptyTokenOutput label={pendingProfile.label} />
                      <p className="result-panel__revision">
                        Local · {pendingProfile.encoding}
                      </p>
                    </div>
                  </div>
                )}
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
          const contentCount = result?.status === "ok"
            ? result.contentTokenCount
            : null;
          const displayCount = text.length === 0 ? 0 : contentCount ?? count;
          const usesEstimate = profile.provider === "anthropic" ||
            profile.provider === "google";
          const isEstimated = text.length > 0 && result?.status === "ok" &&
            result.contentCountKind === "estimated";
          const resolvedModel = result?.resolvedModel ?? profile.encoding;

          return (
            <article
              className={`result-panel result-panel--hosted ${isReduced ? "result-panel--reduced" : ""} ${draggingId === modelId ? "result-panel--dragging" : ""}`}
              key={modelId}
              ref={(element) => setRowElement(modelId, element)}
              tabIndex={0}
              aria-describedby={reorderHelpId}
              onPointerDown={(event) => beginDrag(event, modelId, modelName)}
              onPointerUp={(event) => finishDrag(event.pointerId)}
              onPointerCancel={(event) => finishDrag(event.pointerId)}
              onKeyDown={(event) => reorderWithKeyboard(event, modelId, modelName)}
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
                  {usesEstimate && profile.provider !== "xai" ? (
                    <EstimateBadge provider={profile.provider} />
                  ) : (
                    <ExactBadge />
                  )}
                  <p aria-live="polite">
                    {text.length === 0 && <><strong>0</strong> tokens</>}
                    {text.length > 0 && hostedStatus === "loading" &&
                      "Counting…"}
                    {text.length > 0 && hostedStatus === "error" && "Unavailable"}
                    {text.length > 0 && hostedStatus === "ready" && isUnavailable &&
                      "Unavailable"}
                    {text.length > 0 && hostedStatus === "ready" && !result &&
                      "Edit text to calculate"}
                    {text.length > 0 && hostedStatus === "ready" && displayCount !== null && (
                      <>
                        <strong>{displayCount}</strong>
                        {contentCount !== null || profile.supportsBoundaries
                          ? displayCount === 1 ? " token" : " tokens"
                          : displayCount === 1 ? " input token" : " input tokens"}
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
                  {renderRemoveButton(modelId, modelName)}
                </div>
              </header>
              <div
                className="result-panel__body"
                aria-hidden={isReduced}
                inert={isReduced}
              >
                <div className="result-panel__body-inner">
                  {text.length === 0 && (
                    <EmptyTokenOutput label={profile.label} />
                  )}
                  {text.length > 0 && hostedStatus === "loading" && (
                    <p className="hosted-output-note">Contacting provider…</p>
                  )}
                  {text.length > 0 && hostedStatus === "error" && (
                    <p className="hosted-output-note">{hostedErrorMessage(rowError)}</p>
                  )}
                  {text.length > 0 && hostedStatus === "ready" && isUnavailable && (
                    <p className="hosted-output-note">{hostedErrorMessage(rowError)}</p>
                  )}
                  {text.length > 0 && hostedStatus === "ready" && !result && (
                    <p className="hosted-output-note">
                      Edit the input text to calculate this model.
                    </p>
                  )}
                  {text.length > 0 && hostedStatus === "ready" &&
                    result?.status === "ok" &&
                    result.tokens === null &&
                    displayCount !== null && (
                      <>
                        <TokenCountPlaceholder
                          count={displayCount}
                          label={modelName}
                          approximate={isEstimated}
                        />
                        {isEstimated ? (
                          <p className="hosted-output-note">
                            Empty boxes represent an approximate raw-content count from
                            differential measurements
                            {result.contentTokenCountMin !== null &&
                            result.contentTokenCountMax !== null
                              ? ` (observed range ${result.contentTokenCountMin}–${result.contentTokenCountMax})`
                              : ""}. {profile.provider === "anthropic"
                                ? "Anthropic"
                                : "Google"} reports {result.tokenCount} tokens for the
                            complete structured input. Actual token IDs and
                            boundaries are unavailable.
                            {profile.provider === "google" && (
                              <> Google&apos;s current local package does not support Gemini 4
                              Argon; an exact Gemini 3 Pro Preview local tokenizer is available
                              from the Add menu.</>
                            )}
                          </p>
                        ) : (
                          <p className="hosted-output-note">
                            Full token breakdown is not supported for this provider/model.
                            Empty boxes represent the provider-reported structured-input total,
                            which can include provider-added formatting or system tokens.
                            {profile.provider === "google" && (
                              <> Google&apos;s current local package does not support Gemini 4
                              Argon; an exact Gemini 3 Pro Preview local tokenizer is available
                              from the Add menu.</>
                            )}
                          </p>
                        )}
                      </>
                    )}
                  {text.length > 0 && hostedStatus === "ready" &&
                    result?.status === "ok" &&
                    result.tokens !== null && (
                      <TokenCard result={{ profile, tokens: result.tokens }} />
                    )}
                  <p className="result-panel__revision">
                    {usesEstimate
                      ? "Estimated raw content · hosted differential count"
                      : `Hosted ${profile.supportsBoundaries ? "breakdown" : "count"}`} · {" "}
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

        {hostedStatus === "error" && activeHostedProfiles.length > 0 && (
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
