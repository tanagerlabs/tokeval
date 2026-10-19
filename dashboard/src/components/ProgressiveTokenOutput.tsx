import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const ROWS_PER_PAGE = 3;

interface RowMeasurement {
  key: unknown;
  rowEnds: number[];
  rowEndsWithControl: number[];
}

interface ProgressiveTokenOutputProps {
  ariaLabel: string;
  children: ReactNode[];
  className?: string;
  measurementKey: unknown;
  streamAriaHidden?: boolean;
  streamAriaLabel?: string;
}

export function tokenRowEnds(offsets: readonly number[]): number[] {
  const rowEnds: number[] = [];
  let rowTop: number | null = null;

  offsets.forEach((offset, index) => {
    if (rowTop !== null && Math.abs(offset - rowTop) >= 1) {
      rowEnds.push(index);
    }
    rowTop = offset;
  });
  if (offsets.length > 0) rowEnds.push(offsets.length);
  return rowEnds;
}

export function tokenRowEndsWithReservedWidth(
  offsets: readonly number[],
  rightEdges: readonly number[],
  availableWidth: number,
  reservedWidth: number,
): number[] {
  const rowEnds = tokenRowEnds(offsets);
  let rowStart = 0;

  return rowEnds.map((rowEnd) => {
    let reservedEnd = rowEnd;
    while (
      reservedEnd > rowStart &&
      (rightEdges[reservedEnd - 1] ?? 0) + reservedWidth > availableWidth
    ) {
      reservedEnd -= 1;
    }
    rowStart = rowEnd;
    return reservedEnd;
  });
}

export function ProgressiveTokenOutput({
  ariaLabel,
  children,
  className = "",
  measurementKey,
  streamAriaHidden = false,
  streamAriaLabel,
}: ProgressiveTokenOutputProps) {
  const streamId = useId();
  const outputRef = useRef<HTMLElement>(null);
  const streamRef = useRef<HTMLOListElement>(null);
  const moreSizerRef = useRef<HTMLSpanElement>(null);
  const [visibleRows, setVisibleRows] = useState(ROWS_PER_PAGE);
  const [measurement, setMeasurement] = useState<RowMeasurement | null>(null);
  const measurementIsCurrent = measurement !== null &&
    Object.is(measurement.key, measurementKey);
  const rowEnds = measurementIsCurrent ? measurement.rowEnds : [];
  const visibleRowIndex = Math.min(visibleRows, rowEnds.length) - 1;
  const unreservedVisibleCount = measurementIsCurrent
    ? rowEnds[visibleRowIndex] ?? children.length
    : children.length;
  const hasMore = measurementIsCurrent && unreservedVisibleCount < children.length;
  const visibleCount = hasMore
    ? measurement.rowEndsWithControl[visibleRowIndex] ?? unreservedVisibleCount
    : unreservedVisibleCount;
  const isInitialPage = hasMore && visibleRows === ROWS_PER_PAGE;

  useLayoutEffect(() => {
    if (measurementIsCurrent) return;
    const stream = streamRef.current;
    if (!stream) return;
    const elements = Array.from(stream.children, (element) => element as HTMLElement);
    const offsets = elements.map((element) => element.offsetTop);
    const rightEdges = elements.map((element) => element.offsetLeft + element.offsetWidth);
    const gap = Number.parseFloat(getComputedStyle(stream).columnGap) || 0;
    const reservedWidth = (moreSizerRef.current?.offsetWidth ?? 0) + gap;
    setMeasurement({
      key: measurementKey,
      rowEnds: tokenRowEnds(offsets),
      rowEndsWithControl: tokenRowEndsWithReservedWidth(
        offsets,
        rightEdges,
        stream.clientWidth,
        reservedWidth,
      ),
    });
    setVisibleRows(ROWS_PER_PAGE);
  }, [measurementIsCurrent, measurementKey]);

  useEffect(() => {
    const output = outputRef.current;
    if (!output || typeof ResizeObserver === "undefined") return;
    let previousWidth = output.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = output.getBoundingClientRect().width;
      if (Math.abs(width - previousWidth) < 1) return;
      previousWidth = width;
      setMeasurement(null);
      setVisibleRows(ROWS_PER_PAGE);
    });
    observer.observe(output);
    return () => observer.disconnect();
  }, [measurementKey]);

  return (
    <section
      className={`token-output ${isInitialPage ? "token-output--initial-page" : ""} ${className}`.trim()}
      aria-label={ariaLabel}
      ref={outputRef}
    >
      <ol
        className="token-stream"
        id={streamId}
        ref={streamRef}
        aria-hidden={(streamAriaHidden && !hasMore) || undefined}
        aria-label={streamAriaHidden ? undefined : streamAriaLabel}
        role={streamAriaHidden && hasMore ? "presentation" : undefined}
      >
        {children.slice(0, visibleCount)}
        {hasMore && (
          <li className="token-stream__more-item" role="presentation">
            <button
              className="token-stream__more"
              type="button"
              aria-controls={streamId}
              onClick={() => setVisibleRows((current) => current + ROWS_PER_PAGE)}
            >
              View more
            </button>
          </li>
        )}
      </ol>
      <span ref={moreSizerRef} className="token-stream__more-sizer" aria-hidden="true">
        View more
      </span>
    </section>
  );
}
