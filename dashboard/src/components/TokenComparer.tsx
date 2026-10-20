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
  readHostedSessionCache,
  type HostedModelProfile,
  type HostedResult,
  type HostedStatus,
} from "../lib/hosted-tokenizer";
import {
  buildModelCatalog,
  defaultModelOrder,
} from "../lib/model-catalog";
import { OPEN_MODEL_PROFILES } from "../lib/open-model-profiles";
import { CORE_CATALOG_MODELS } from "../lib/catalog";
import {
  hasCrossedSwapEdge,
  moveItem,
  rankModelIdsByCount,
} from "../lib/model-order";
import {
  removeTokenizationResults,
  replaceTokenizationResults,
} from "../lib/tokenization-results";
import type { TokenizationResult } from "../lib/tokenizer";
import { ModelPicker } from "./ModelPicker";
import { ProviderLogo } from "./ProviderLogo";
import { EmptyTokenOutput, TokenCard } from "./TokenCard";
import { TokenCountPlaceholder } from "./TokenCountPlaceholder";

interface TokenComparerProps {
  initialText: string;
  initialResults: TokenizationResult[];
  initialHostedResults: HostedResult[];
  hostedProfiles?: HostedModelProfile[];
}

const HOSTED_DEBOUNCE_MS = 650;
const XAI_HOSTED_DEBOUNCE_MS = 1300;
const CORE_MODEL_IDS = CORE_CATALOG_MODELS.map((profile) => profile.id);
const JS_TIKTOKEN_REVISION_PATTERN = /^js-tiktoken@(\d+\.\d+\.\d+)$/;

function resultKey(result: TokenizationResult): string {
  return result.profile.id || result.profile.encoding;
}

function tokenizerKey(profile: TokenizationResult["profile"]): string {
  return profile.tokenizerId ?? profile.id;
}

function localTokenCount(result: TokenizationResult): number {
  return result.tokenCount ?? result.tokens.length;
}

function hostedTokenCount(result: HostedResult): number | undefined {
  if (result.status !== "ok") return undefined;
  return result.contentTokenCount ?? result.tokenCount ?? undefined;
}

function tokenizerRevisionUrl(result: TokenizationResult): string | undefined {
  const jsTiktokenVersion = result.tokenizerRevision.match(
    JS_TIKTOKEN_REVISION_PATTERN,
  )?.[1];
  if (jsTiktokenVersion) {
    return `https://www.npmjs.com/package/js-tiktoken/v/${jsTiktokenVersion}`;
  }
  return result.profile.sourceUrl;
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
  hostedProfiles = HOSTED_MODEL_PROFILES,
}: TokenComparerProps) {
  const inputId = useId();
  const reorderHelpId = useId();
  const modelCatalog = useMemo(
    () => buildModelCatalog(initialResults, hostedProfiles),
    [initialResults, hostedProfiles],
  );
  const initialModelOrder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const result of initialResults) {
      counts.set(resultKey(result), localTokenCount(result));
    }
    for (const result of initialHostedResults) {
      const count = hostedTokenCount(result);
      if (count !== undefined) counts.set(result.profile.id, count);
    }
    return rankModelIdsByCount(defaultModelOrder(modelCatalog), counts);
  }, [initialHostedResults, initialResults, modelCatalog]);
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
  const hasPreloadedHostedResults = hostedProfiles
    .filter((profile) => initialModelOrder.includes(profile.id))
    .every((profile) =>
      initialHostedResults.some((result) => result.profile.id === profile.id),
    );
  const requestId = useRef(0);
  const hostedAbortController = useRef<AbortController | null>(null);
  const addedHostedControllers = useRef(new Set<AbortController>());
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
  const resultsRef = useRef(results);
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
  const [addingModelIds, setAddingModelIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [addModelErrors, setAddModelErrors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const modelOrderRef = useRef(modelOrder);
  const textRef = useRef(text);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");

  modelOrderRef.current = modelOrder;
  textRef.current = text;
  resultsRef.current = results;

  const activeHostedProfiles = hostedProfiles.filter((profile) =>
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

  useEffect(() => {
    if (
      text.length === 0 ||
      status === "loading" ||
      hostedStatus === "loading" ||
      addingModelIds.size > 0 ||
      dragState.current
    ) {
      return;
    }

    const activeIds = new Set(modelOrderRef.current);
    const counts = new Map<string, number>();
    for (const result of results) {
      const id = resultKey(result);
      if (activeIds.has(id)) counts.set(id, localTokenCount(result));
    }
    if (hostedStatus === "ready") {
      for (const result of hostedResults) {
        if (!activeIds.has(result.profile.id)) continue;
        const count = hostedTokenCount(result);
        if (count !== undefined) counts.set(result.profile.id, count);
      }
    }
    const currentOrder = modelOrderRef.current;
    const rankedOrder = rankModelIdsByCount(currentOrder, counts);
    if (rankedOrder.some((id, index) => id !== currentOrder[index])) {
      applyModelOrder(rankedOrder);
      setReorderAnnouncement(
        "Models ranked from the fewest displayed tokens to the most.",
      );
    }
  }, [addingModelIds, hostedResults, hostedStatus, results, status, text]);

  useEffect(() => {
    for (const controller of addedHostedControllers.current) controller.abort();
    addedHostedControllers.current.clear();
    setAddingModelIds(new Set());
    setAddModelErrors(new Map());
  }, [text]);

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
    // dependency. This bulk pass is reserved for text edits and explicit
    // retries; additions use the targeted path below, while removals and
    // reordering do not re-tokenize existing cards.
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

    // As with local tokenizers, this bulk pass is reserved for text edits and
    // explicit retries. Newly added providers use the targeted path below.
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

    const cachedResults = readHostedSessionCache(text, requestedProfiles);
    if (cachedResults) {
      setHostedResults(cachedResults);
      lastHostedTokenizedKey.current = tokenizationKey;
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

  function finishAddedModels(
    modelIds: readonly string[],
    sourceText: string,
    errorCode?: string,
  ): void {
    if (textRef.current !== sourceText) return;
    const ids = new Set(modelIds);
    setAddingModelIds((current) => new Set(
      Array.from(current).filter((id) => !ids.has(id)),
    ));
    setAddModelErrors((current) => {
      const next = new Map(current);
      for (const id of modelIds) {
        if (errorCode) next.set(id, errorCode);
        else next.delete(id);
      }
      return next;
    });
  }

  function evaluateAddedModels(modelIds: readonly string[]): void {
    const sourceText = textRef.current;
    if (sourceText.length === 0) return;

    setAddingModelIds((current) => new Set([...current, ...modelIds]));
    setAddModelErrors((current) => {
      const next = new Map(current);
      for (const id of modelIds) next.delete(id);
      return next;
    });

    const reusableResults: TokenizationResult[] = [];
    const reusedIds = new Set<string>();
    for (const modelId of modelIds) {
      const profile = modelCatalog.find((candidate) => candidate.id === modelId);
      if (!profile || profile.kind === "hosted") continue;
      const reusable = resultsRef.current.find((result) =>
        tokenizerKey(result.profile) === tokenizerKey(profile)
      );
      if (!reusable) continue;
      reusableResults.push({ ...reusable, profile });
      reusedIds.add(modelId);
    }
    if (reusableResults.length > 0) {
      setResults((current) => replaceTokenizationResults(
        current,
        reusableResults,
        reusedIds,
      ));
      finishAddedModels([...reusedIds], sourceText);
    }

    const pendingModelIds = modelIds.filter((id) => !reusedIds.has(id));
    const coreIds = CORE_MODEL_IDS.filter((id) => pendingModelIds.includes(id));
    const openIds = OPEN_MODEL_PROFILES
      .filter((profile) => pendingModelIds.includes(profile.id))
      .map((profile) => profile.id);
    const addedHostedProfiles = hostedProfiles.filter((profile) =>
      pendingModelIds.includes(profile.id)
    );

    if (coreIds.length > 0) {
      const coreIdSet = new Set<string>(coreIds);
      void import("../lib/tokenizer")
        .then(({ tokenizeAll }) => tokenizeAll(sourceText, coreIds))
        .then((next) => {
          if (textRef.current !== sourceText) return;
          setResults((current) =>
            replaceTokenizationResults(current, next, coreIdSet)
          );
          finishAddedModels(coreIds, sourceText);
        })
        .catch((error: unknown) => {
          console.error("Added local tokenizer failed.", error);
          finishAddedModels(coreIds, sourceText, "LOCAL_TOKENIZER_FAILED");
        });
    }

    if (openIds.length > 0) {
      const openIdSet = new Set<string>(openIds);
      void import("../lib/open-tokenizer-client")
        .then(({ tokenizeOpenModelsInWorker }) =>
          tokenizeOpenModelsInWorker(sourceText, openIds)
        )
        .then((next) => {
          if (textRef.current !== sourceText) return;
          setResults((current) =>
            replaceTokenizationResults(current, next, openIdSet)
          );
          finishAddedModels(openIds, sourceText);
        })
        .catch((error: unknown) => {
          console.error("Added open-model tokenizer failed.", error);
          finishAddedModels(openIds, sourceText, "LOCAL_TOKENIZER_FAILED");
        });
    }

    if (addedHostedProfiles.length > 0) {
      const controller = new AbortController();
      const hostedIds = addedHostedProfiles.map((profile) => profile.id);
      addedHostedControllers.current.add(controller);
      void compareHostedText(sourceText, controller.signal, addedHostedProfiles)
        .then((next) => {
          if (controller.signal.aborted || textRef.current !== sourceText) return;
          const hostedIdSet = new Set<string>(hostedIds);
          setHostedResults((current) => [
            ...current.filter((result) => !hostedIdSet.has(result.profile.id)),
            ...next,
          ]);
          finishAddedModels(hostedIds, sourceText);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const code = error instanceof HostedApiError
            ? error.code
            : "REQUEST_FAILED";
          finishAddedModels(hostedIds, sourceText, code);
        })
        .finally(() => addedHostedControllers.current.delete(controller));
    }
  }

  function addModels(modelIds: string[]): void {
    const current = modelOrderRef.current;
    const catalogIds = new Set(modelCatalog.map((profile) => profile.id));
    const newIds = modelIds.filter((id) =>
      catalogIds.has(id) && !current.includes(id)
    );
    if (newIds.length === 0) return;

    applyModelOrder([...newIds, ...current]);
    evaluateAddedModels(newIds);
    const modelNames = newIds.flatMap((id) => {
      const profile = modelCatalog.find((candidate) => candidate.id === id);
      return profile ? [profile.modelExamples] : [];
    });
    setReorderAnnouncement(
      `${modelNames.join(", ")} added to the top of the comparison.`,
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
    setAddingModelIds((current) => {
      const updated = new Set(current);
      updated.delete(modelId);
      return updated;
    });
    setAddModelErrors((current) => {
      const updated = new Map(current);
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
  const visibleLocalResults = results.filter((result) =>
    selectedModelIds.has(resultKey(result)),
  );
  const visibleHostedResults = hostedResults.filter((result) =>
    selectedModelIds.has(result.profile.id),
  );
  const tokenCounts = text.length === 0
    ? modelOrder.map(() => 0)
    : [
        ...visibleLocalResults.map(localTokenCount),
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
      ? `${modelOrder.length} models · ${minimumTokens}–${maximumTokens} tokens · spread ${maximumTokens - minimumTokens}${text.length > 0 ? " · ranked by fewest tokens" : ""}`
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

      <ModelPicker
        profiles={modelCatalog}
        activeModelIds={selectedModelIds}
        onAdd={addModels}
      />

      <p className="visually-hidden" id={reorderHelpId}>
        Drag the card surface to reorder, or focus the card and use the up and
        down arrow keys. Home and End move a model to the start or end of the
        list. Text, token boxes, and card controls do not start dragging. A new
        text calculation ranks the cards by their displayed token count again.
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement}
      </p>
      <div
        className={`results-list ${text.length > 0 && status === "loading" ? "is-loading" : ""} ${draggingId ? "results-list--dragging" : ""}`}
      >
        {modelOrder.map((modelId) => {
          const isAdding = addingModelIds.has(modelId);
          const addError = addModelErrors.get(modelId) ?? null;
          const localResult = results.find(
            (candidate) => resultKey(candidate) === modelId,
          );

          if (localResult && !isAdding && !addError) {
            const isReduced = reducedTokenizerIds.has(modelId);
            const modelName = localResult.profile.modelExamples;
            const displayCount = text.length === 0
              ? 0
              : localResult.tokenCount ?? localResult.tokens.length;
            const revisionUrl = tokenizerRevisionUrl(localResult);
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
                    ) : localResult.profile.supportsBoundaries === false ? (
                      <>
                        <TokenCountPlaceholder
                          count={displayCount}
                          label={modelName}
                          approximate={false}
                        />
                        <p className="hosted-output-note">
                          {localResult.profile.boundaryLimitation ??
                            "This tokenizer exposes an exact local count, but not lossless raw-input token boundaries."}
                          {" "}Empty boxes represent the exact token total.
                        </p>
                      </>
                    ) : (
                      <TokenCard result={localResult} />
                    )}
                    <p className="result-panel__revision">
                      Local · {revisionUrl ? (
                        <a
                          href={revisionUrl}
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
                      ) : addError || status === "error" ? (
                        "Unavailable"
                      ) : isAdding || status === "loading" ? (
                        "Loading tokenizer…"
                      ) : (
                        "Edit text to calculate"
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
                {(text.length === 0 || isAdding || addError) && (
                  <div
                    className="result-panel__body"
                    aria-hidden={isReduced}
                    inert={isReduced}
                  >
                    <div className="result-panel__body-inner">
                      {text.length === 0 ? (
                        <EmptyTokenOutput label={pendingProfile.label} />
                      ) : (
                        <p className="hosted-output-note">
                          {addError
                            ? "This tokenizer could not be loaded."
                            : "Loading tokenizer…"}
                        </p>
                      )}
                      <p className="result-panel__revision">
                        Local · {pendingProfile.encoding}
                      </p>
                    </div>
                  </div>
                )}
              </article>
            );
          }

          const profile = hostedProfiles.find(
            (candidate) => candidate.id === modelId,
          );
          if (!profile) return null;

          const result = isAdding || addError
            ? undefined
            : hostedResults.find(
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
                    {text.length > 0 && isAdding && "Counting…"}
                    {text.length > 0 && addError && "Unavailable"}
                    {text.length > 0 && !isAdding && !addError && hostedStatus === "loading" &&
                      "Counting…"}
                    {text.length > 0 && !isAdding && !addError && hostedStatus === "error" && "Unavailable"}
                    {text.length > 0 && !isAdding && !addError && hostedStatus === "ready" && isUnavailable &&
                      "Unavailable"}
                    {text.length > 0 && !isAdding && !addError && hostedStatus === "ready" && !result &&
                      "Edit text to calculate"}
                    {text.length > 0 && !isAdding && !addError && hostedStatus === "ready" && displayCount !== null && (
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
                  {text.length > 0 && !isAdding && !addError &&
                    hostedStatus === "loading" && (
                    <p className="hosted-output-note">Contacting provider…</p>
                  )}
                  {text.length > 0 && isAdding && (
                    <p className="hosted-output-note">Contacting provider…</p>
                  )}
                  {text.length > 0 && addError && (
                    <p className="hosted-output-note">{hostedErrorMessage(addError)}</p>
                  )}
                  {text.length > 0 && !isAdding && !addError &&
                    hostedStatus === "error" && (
                    <p className="hosted-output-note">{hostedErrorMessage(rowError)}</p>
                  )}
                  {text.length > 0 && !isAdding && !addError &&
                    hostedStatus === "ready" && isUnavailable && (
                    <p className="hosted-output-note">{hostedErrorMessage(rowError)}</p>
                  )}
                  {text.length > 0 && !isAdding && !addError &&
                    hostedStatus === "ready" && !result && (
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
