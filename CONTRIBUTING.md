# Contributing to TokEval

This repository is reserved for the reusable Python evaluation library, which
is currently in its initial setup phase. Read `PROJECT_CONTEXT.md` and
`AGENTS.md` before making architectural or methodological changes.

Dashboard model/provider contributions belong in
[`tanagerlabs/tokeval-dashboard`](https://github.com/tanagerlabs/tokeval-dashboard/blob/main/CONTRIBUTING.md).
Experiment configs, results, and writeups belong in
[`tanagerlabs/tokeval-research`](https://github.com/tanagerlabs/tokeval-research).

## Library layout

- `src/tokeval/` — reusable, typed package code.
- `tests/` — focused tests mirroring package behavior.
- `configs/languages/` — versioned language definitions, avoiding
  language-specific branches in shared code.
- `pyproject.toml` — build metadata and test/lint/type-check configuration.

Do not recreate the old root-level `tokenizers/`, `benchmarks/`,
`experiments/`, `models/`, or `data/` placeholders.

## Tokenizer adapters

Keep all tokenizer integrations behind a shared interface that records:

- stable tokenizer and model identity;
- exact upstream revision or artifact digest;
- token count and count source;
- optional token IDs and raw token bytes;
- optional raw-input byte spans;
- whether exact boundaries are supported and why they may be unavailable.

Never invent token IDs or spans for a count-only API. A tokenizer that
normalizes input may expose an exact count without being able to map tokens
losslessly to original input bytes.

## Tests and reproducibility

New behavior needs focused tests for ordinary input and relevant edge cases.
Tokenizer adapters should cover:

- empty input and unusual whitespace;
- English, Korean, Turkish, and mixed scripts as appropriate;
- composed and decomposed Unicode;
- emoji;
- tokens that split UTF-8 code points;
- exact byte round trips whenever boundary support is claimed;
- deterministic revision reporting and graceful dependency failures.

Experiments must pin the released package version or Git revision in the
research repository. Keep token counts, quality, latency, memory, energy, and
monetary cost as separate measurements, and do not claim improvements without
reproducible evidence.

## Repository hygiene

Do not commit credentials, personal paths, account or host identifiers, raw
machine diagnostics, datasets, model weights, checkpoints, or generated
experiment outputs. Record only licensed, intentional package artifacts and
their provenance.

Pull requests should explain the adapter or metric contract, upstream
revisions, behavior and limitations, tests run, and any compatibility impact.
