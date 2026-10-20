# TokEvals

*Investigating the hidden cost of language in AI.*

TokEvals is an open-source Python library, currently in its initial setup phase,
for reproducibly measuring multilingual LLM tokenization efficiency and
connecting it—without conflating it—to model quality, serving behavior,
energy, and monetary cost. Korean is the first optimization case, English is
the initial baseline, and additional languages are designed to be
configuration-driven.

## Intended library layout

The `tokevals` Python package has not yet been implemented. New work should
use:

```text
src/tokevals/       reusable library code and tokenizer adapters
tests/             focused unit and integration tests
configs/languages/ versioned language settings
pyproject.toml     package metadata and Python tooling
```

The distribution and import name will both be `tokevals`.

Tokenizer integrations will share one adapter contract, retain raw bytes and
byte spans, pin model/tokenizer revisions, and distinguish local tokenization,
hosted count-only APIs, estimates, and real inference. Tokens may split UTF-8
code points, so independent token decoding must never be assumed.

## Research principles

- Measure cost per successful task—not token count alone.
- Keep token efficiency, model quality, serving performance, energy, and price
  distinct.
- Preserve raw bytes because token boundaries may split UTF-8 code points.
- Publish controlled comparisons with versioned data, models, software,
  hardware, configs, and seeds.
- Treat every claimed improvement as a result to demonstrate, not an
  assumption.

## Repository family

- [`tokevals/tokevals`](https://github.com/tokevals/tokevals) — this
  reusable Python evaluation library.
- [`tokevals/tokevals-explorer`](https://github.com/tokevals/tokevals-explorer)
  — the [tokeval.dev](https://tokeval.dev) Explorer and hosted-count Worker.
- [`tokevals/tokevals-research`](https://github.com/tokevals/tokevals-research)
  — research scope, experiment configs, results, and writeups. Its
  [`PROJECT_CONTEXT.md`](https://github.com/tokevals/tokevals-research/blob/main/PROJECT_CONTEXT.md)
  is the program source of truth.

See [CONTRIBUTING.md](CONTRIBUTING.md) before starting library work.
