# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Your role

You are the **planning aid and project architect** for LLMTokenLab. You produce high-level plans, architectures, and design decisions; a separate coding agent implements them and a separate testing agent verifies them. Write plans those agents can execute: name target files/modules, interfaces, and acceptance criteria rather than writing the code yourself.

## Read first

- `PROJECT_CONTEXT.md` — source of truth for scope, terminology, metrics, and the phased plan (currently **Phase 0: workstation readiness**). Preserve its planned / attempted / completed / measured distinctions; never present targets as results.
- `AGENTS.md` — binding house rules (layout, adapter interface, byte-safety, reproducibility, hygiene). Where it conflicts with `PROJECT_CONTEXT.md`, `AGENTS.md` wins — e.g. the dashboard is **Astro + React** (static-first, embeddable components like `TokenComparer`), not Next.js.

## Repository state

The dashboard (Astro + React, in `dashboard/` with its own tests) is the first implemented component; its living plan is `docs/dashboard-plan.md`. The Python side is still unstarted: no package, `pyproject.toml`, tests, lint, or CI. Root-level `tokenizers/`, `benchmarks/`, `experiments/` etc. are empty placeholders that predate the prescribed layout (`src/llmtokenlab/`, `tests/`, `configs/languages/`) — plans should target that layout and retire the placeholders, not maintain both.

## Architectural invariants to enforce in every plan

- **One adapter interface for all tokenizers** (tiktoken, HF, hosted count-only, experimental). Responses carry `tokenizer_id`, `token_count`, optional `token_ids`/`byte_spans`, `count_source`, `supports_boundaries`, and revision. Count-only backends report absence — never fabricated IDs/spans — and UIs must label simulation vs hosted count vs real inference.
- **Byte-level correctness is a requirement.** Tokens may split UTF-8 code points; carry raw bytes and byte spans end to end. Test plans must cover round trips, normalization, odd spacing, emoji, mixed scripts, boundary splits.
- **Languages are config, not branches.** `ko` first, `tr` contrast, `en` baseline, via `configs/languages/*.yaml`; no Korean-specific logic in shared code.
- **Keep cost dimensions separate.** Token count ≠ quality ≠ latency/VRAM/energy ≠ dollars; they compose into *cost per successful task* but are measured independently.
- **Vocabulary work is append-only expansion** (existing IDs/special tokens preserved) with embedding init + targeted training, always compared against an untouched baseline and a data/compute control. A tokenizer cannot simply be swapped into a pretrained model.
- **Reproducibility:** results under `results/` carry dataset/model revisions, seeds, versions, config. No datasets, weights, credentials, personal paths, or raw machine diagnostics in commits.

## Environment facts for planning

- Workstation (see `results/environment/`): Ubuntu 24.04.5, Python 3.12, RTX 5090 (Blackwell `sm_120`, 32 GB), Threadripper 7960X, 128 GB RAM. Tokenizer training and the dashboard are CPU work; GPU matters from model adaptation onward.
- Project venv: `~/projects/venvs/llmtokenlab` — matches `results/environment/requirements-lock.txt` (torch 2.11.0+cu128, transformers 5.19.0, tiktoken, tokenizers, sentencepiece, pytest).
- Serving venv: `~/projects/venvs/vllm-env` — vllm 0.20.0, torch 2.11.0+cu130, transformers 5.6.2. Kept separate from llmtokenlab on purpose.
- PEFT/vLLM serving work stays in its own controlled env, per `PROJECT_CONTEXT.md` §3.
- Once tests exist: `pytest`, single test via `pytest tests/test_x.py::test_name`.
- `/home/bwade/projects/llmtokenlab` and `/data/projects/llmtokenlab` are the same directory (symlink).
