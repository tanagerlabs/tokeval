import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TokenComparer } from "../src/components/TokenComparer";
import { INITIAL_HOSTED_RESULTS } from "../src/lib/initial-hosted-results";
import { INITIAL_RESULTS, INITIAL_TEXT } from "../src/lib/initial-tokenization";

describe("TokenComparer first render", () => {
  test("shows the five-provider default with seed counts and add/remove controls", () => {
    const html = renderToStaticMarkup(
      <TokenComparer
        initialText={INITIAL_TEXT}
        initialResults={INITIAL_RESULTS}
        initialHostedResults={INITIAL_HOSTED_RESULTS}
      />,
    );

    for (const model of [
      "GPT-5",
      "Claude Opus 5.5",
      "Gemini 4 Argon",
      "Meta Llama 4",
      "Grok 4.7",
    ]) {
      expect(html).toContain(model);
      expect(html).toContain(`aria-label="Remove ${model}"`);
    }

    expect(html.match(/<article/g)).toHaveLength(5);
    expect(html).toContain("Add a model or tokenizer");
    expect(html).toContain("Gemini 3 Pro Preview (local)");
    expect(html).toContain("<strong>18</strong> tokens");
    expect(html).toContain("<strong>8</strong> tokens");
    expect(html).toContain("<strong>10</strong> tokens");
    expect(html.match(/token token--placeholder/g)).toHaveLength(26);
    expect(html.match(/class="estimate-badge"/g)).toHaveLength(2);
    expect(html.match(/class="exact-badge"/g)).toHaveLength(3);
    expect(html).not.toContain("≈");
    expect(html).toContain("subtracts an empty-wrapper count from the same wrapper");
    expect(html).toContain("Anthropic reports 25 tokens for the");
    expect(html).toContain("Google reports 38 tokens for the");
    expect(html).toContain(
      "an exact Gemini 3 Pro Preview local tokenizer is available",
    );
    expect(html.match(/>provider API<\/a>/g)).toHaveLength(3);
    expect(html).not.toContain("Estimated raw content");
    expect(html).not.toContain("hosted differential count");
    expect(html).not.toContain("Hosted breakdown");
    expect(html).toContain(
      'href="https://www.npmjs.com/package/js-tiktoken/v/1.0.21"',
    );
    expect(html).not.toContain("result-panel__drag-handle");
    expect(html).not.toContain("Enable hosted counts");
    expect(html).not.toContain("Disable hosted counts");

    const claudeRow = html.indexOf("Claude Opus 5.5");
    const claudeEstimate = html.indexOf("class=\"estimate-badge\"", claudeRow);
    const claudeCount = html.indexOf("<strong>18</strong>", claudeRow);
    const claudeChevron = html.indexOf("result-panel__toggle", claudeRow);
    const claudeRemove = html.indexOf("Remove Claude Opus 5.5", claudeRow);
    expect(claudeEstimate).toBeLessThan(claudeCount);
    expect(claudeChevron).toBeLessThan(claudeRemove);

    const gptRow = html.indexOf("GPT-5");
    const gptExact = html.indexOf("class=\"exact-badge\"", gptRow);
    const gptCount = html.indexOf("<strong>7</strong>", gptRow);
    expect(gptExact).toBeLessThan(gptCount);
  });

  test("shows one consistent zero-token empty state for every model", () => {
    const html = renderToStaticMarkup(
      <TokenComparer
        initialText=""
        initialResults={INITIAL_RESULTS}
        initialHostedResults={INITIAL_HOSTED_RESULTS}
      />,
    );

    expect(html.match(/<strong>0<\/strong> tokens/g)).toHaveLength(5);
    expect(html.match(/Enter some text above\./g)).toHaveLength(5);
    expect(html).toContain("5 models · 0–0 tokens · spread 0");
    expect(html).not.toContain("Waiting for text");
    expect(html).not.toContain("Enter text above to request a count.");
  });
});
