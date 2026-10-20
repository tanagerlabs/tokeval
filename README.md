# TokEval

*Investigating the hidden cost of language in AI.*

TokEval is an open-source research and engineering project for measuring, explaining, visualizing, and reducing multilingual LLM tokenization inefficiency. Korean is the first optimization case study, with English as an initial baseline and support for more languages designed to remain extensible.

## What we're building

- **Explorer:** byte-safe, side-by-side visualization of real tokenizer output.
- **Bench:** reproducible multilingual tokenization and runtime evaluation.
- **Train:** controlled tokenizer and model-adaptation experiments.
- **Serve:** GPU benchmarks connecting tokenization to latency, memory, energy, quality, and cost.

## Research principles

- Measure cost per successful task—not token count alone.
- Keep token efficiency, model quality, serving performance, and price distinct.
- Preserve raw bytes because token boundaries may split UTF-8 code points.
- Publish controlled comparisons with versioned data, models, software, hardware, and seeds.
- Treat every claimed improvement as a result to demonstrate, not an assumption.


For more info, see [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md). Changes are
welcome; [CONTRIBUTING.md](CONTRIBUTING.md) explains the model catalog,
tokenizer integrations, hosted providers, and required verification.

## Dashboard development

The Explorer MVP lives in `dashboard/` and uses Astro with a focused React
island for interactive tokenization. The default comparison is statically
rendered; encoding data is loaded locally in the browser only when the input
changes. The add-model menu includes Google's experimental local tokenizer
mapping for Gemini 3 Pro Preview. Gemini 4 Argon remains a separately labeled
hosted estimate because Google's current local package does not map that model.
Anthropic and unsupported hosted Google models show approximate raw-content
counts alongside their authoritative structured-input counts; neither claims
unavailable token boundaries.

```bash
cd dashboard
npm install
npm run dev
```

Run `npm test` for byte-safety checks and `npm run build` for the complete
type-check and production build.
