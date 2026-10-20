# Agent Guide

## Start here

- Read `PROJECT_CONTEXT.md`, which points to the research repository's source
  of truth for scope, terminology, phases, and known-versus-planned work.
- This repository contains only the reusable Python evaluation library. The
  Explorer and research artifacts live in the sibling repositories linked
  from the README.
- TokEvals is in its initial library setup phase. Do not describe planned work
  as implemented or experimental targets as measured results.

## Standard patterns

- Keep reusable code under `src/tokevals/`, tests under `tests/`, language
  settings under `configs/languages/`, and package/tool configuration in
  `pyproject.toml`.
- Keep tokenizer integrations behind a shared adapter interface. Report the
  tokenizer/model revision and distinguish local tokenization, hosted
  count-only APIs, estimates, and real inference.
- Preserve raw bytes and byte spans. A token may split a UTF-8 code point, so
  never assume every token independently decodes to valid text.
- Prefer configuration-driven language support over Korean-specific branches
  in shared code.
- Make small, typed, documented changes and add focused tests for behavior and
  edge cases.

## Research and reproducibility

- Keep token count, model quality, latency, memory, energy, and monetary cost
  as separate measurements.
- Use controlled comparisons, explicit metric definitions, fixed seeds, and
  versioned configs. Record dataset/model revisions or hashes and relevant
  hardware/software versions in `tokevals-research`, not this package.
- Test Unicode round trips, normalization, unusual spacing, emoji, mixed
  scripts, and byte-boundary splits.
- Vocabulary work is append-only expansion: preserve existing IDs and special
  tokens, initialize new embeddings deliberately, and compare against an
  untouched baseline and a matched data/compute control.

## Repository hygiene

- Do not commit credentials, personal paths, host/device or account
  identifiers, raw machine diagnostics, datasets, model weights, or
  checkpoints.
- Keep experiments, results, and writeups in
  `tokevals/tokevals-research`; keep Explorer code in
  `tokevals/tokevals-explorer`.
- Preserve unrelated user changes and avoid destructive Git operations.
