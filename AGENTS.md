# Agent Guide

## Start here

- Read `PROJECT_CONTEXT.md` before making architectural or research decisions. It is the source of truth for scope, terminology, phases, and known-versus-planned work.
- LLMTokenLab measures multilingual tokenization efficiency and its effect on model quality and serving cost. Korean is the first optimization case; English is the baseline comparison language.
- The repository is in its initial setup phase. Do not describe planned work as implemented or experimental targets as measured results.

## Standard patterns

- Keep reusable Python code under `src/llmtokenlab/`, tests under `tests/`, language settings under `configs/languages/`, and reproducible outputs under `results/`.
- Keep tokenizer integrations behind a shared adapter interface. Report the tokenizer/model revision and distinguish local tokenization, hosted count-only APIs, and real inference.
- Preserve raw bytes and byte spans. A token may split a UTF-8 code point, so never assume that every token decodes independently to valid text.
- Prefer configuration-driven language support over Korean-specific branches in shared code. Additional language support will be added in the future.
- Make small, typed, documented changes and add focused tests for behavior and edge cases.

### Architecture

- For the dashboard, use Astro framework with React, intended for good SEO static web pages.
- Prefer modular components for web components such as "TokenComparer" that may be embedded elsewhere - in blog posts or other pages.

## Research and reproducibility

- Keep token count, model quality, latency, energy, and monetary cost as separate measurements.
- Use controlled comparisons, explicit metric definitions, fixed seeds, and versioned configs. Record dataset/model revisions or hashes and relevant hardware/software versions.
- Label statements as planned, attempted, completed, or measured. Do not claim an improvement without supporting results.
- Test Unicode round trips, normalization, unusual spacing, emoji, mixed scripts, and byte-boundary splits.

## Repository hygiene

- Do not commit credentials, personal paths, host/device identifiers, raw machine diagnostics, datasets, model weights, or checkpoints.
- Commit only licensed, intentional research artifacts. Prefer compact sanitized environment summaries over command dumps or transient telemetry.
- Preserve unrelated user changes and avoid destructive Git operations.
