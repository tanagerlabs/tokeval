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
    <section
      className="token-output token-output--placeholder"
      aria-label={`${label}: ${approximate ? "approximately " : ""}${count} content tokens; individual tokens unavailable`}
    >
      <ol className="token-stream" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <li className="token token--placeholder" key={index} />
        ))}
      </ol>
    </section>
  );
}
