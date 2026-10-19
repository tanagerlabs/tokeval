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
    expect(html).toContain("<strong>25</strong> tokens");
    expect(html).toContain("<strong>38</strong> tokens");
    expect(html).toContain("<strong>10</strong> tokens");
    expect(html).not.toContain("Enable hosted counts");
    expect(html).not.toContain("Disable hosted counts");
  });
});
