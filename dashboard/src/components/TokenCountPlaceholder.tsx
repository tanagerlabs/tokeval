import { ProgressiveTokenOutput } from "./ProgressiveTokenOutput";

interface TokenCountPlaceholderProps {
  count: number;
  label: string;
  approximate?: boolean;
}

export function TokenCountPlaceholder({
  count,
  label,
  approximate = false,
}: TokenCountPlaceholderProps) {
  return (
    <ProgressiveTokenOutput
      ariaLabel={`${label}: ${approximate ? "approximately " : ""}${count} content tokens; individual tokens unavailable`}
      className="token-output--placeholder"
      measurementKey={`${label}:${count}`}
      streamAriaHidden
    >
      {Array.from({ length: count }, (_, index) => (
        <li className="token token--placeholder" key={index} />
      ))}
    </ProgressiveTokenOutput>
  );
}
