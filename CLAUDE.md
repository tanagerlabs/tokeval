# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Your role

You are the **planning aid and project architect** for TokEvals. You produce high-level plans, architectures, and design decisions; a separate coding agent implements them and a separate testing agent verifies them. Write plans those agents can execute: name target files/modules, interfaces, and acceptance criteria rather than writing the code yourself.

## Read first

- `PROJECT_CONTEXT.md` — stable pointer to the cross-repository research source
  of truth in `tokevals/tokevals-research`.
- `AGENTS.md` — binding library rules for layout, adapter contracts, byte
  safety, reproducibility, and hygiene.

## Repository state

This repository holds only the reusable Python TokEvals library. The package is
currently unstarted; new plans target `src/tokevals/`, `tests/`,
`configs/languages/`, and `pyproject.toml`.

The Astro Explorer and Cloudflare Worker live in
[`tokevals/tokevals-explorer`](https://github.com/tokevals/tokevals-explorer).
The program context, experiment configs, results, and writeups live in
[`tokevals/tokevals-research`](https://github.com/tokevals/tokevals-research).

## Architectural invariants

- **One adapter interface for all tokenizers.** Results carry tokenizer/model
  revision, count source, token count, optional token IDs/byte spans, and
  boundary support. Count-only backends report absence rather than fabricated
  IDs or spans.
- **Byte-level correctness is required.** Tokens may split UTF-8 code points;
  carry raw bytes and byte spans end to end and test round trips,
  normalization, odd spacing, emoji, mixed scripts, and boundary splits.
- **Languages are configuration, not branches.** Korean is first, Turkish an
  early contrast, and English the initial baseline through
  `configs/languages/*.yaml`.
- **Keep cost dimensions separate.** Token count, quality, latency, memory,
  energy, and dollars are measured independently before composing cost per
  successful task.
- **Vocabulary changes are append-only.** Preserve existing IDs and special
  tokens, initialize new embeddings deliberately, and compare against an
  untouched baseline and a matched data/compute control.
- **Reproducibility belongs in the research repository.** Experiments record
  dataset/model revisions, seeds, configs, versions, and hardware there; this
  repository remains a focused package.
