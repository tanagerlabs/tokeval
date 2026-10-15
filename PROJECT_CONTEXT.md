# TokenLab — Project Context

> **Purpose:** A living reference for contributors, coding agents, and future conversations. This document captures project goals and decisions discussed so far, and distinguishes plans from verified results.

**Project name:** TokenLab (`tokenlab`)

**Working tagline:** *Investigating the hidden cost of language in AI.*

**Status:** Planning / initial workstation setup. No tokenizer improvement, model adaptation, or serving-cost reduction has yet been demonstrated.

## 1. Mission and motivation

TokenLab is an open-source research and engineering project for **measuring, explaining, visualizing, and reducing multilingual LLM tokenization inefficiency**.

LLMs consume token sequences, and many APIs bill by token. Tokenizer vocabularies and merge rules reflect their training corpora, often giving well-represented languages (notably English) more efficient representations than less-represented languages. The resulting *tokenization tax* can mean more tokens to express comparable content, increasing API costs, effective context-window usage, prefill work, KV-cache requirements, and/or autoregressive decoding steps. Actual inference impact depends on the model, engine, and workload.

Token-count inequality is **not inherently caused by non-Latin scripts**. Corpus mix, vocabulary allocation, byte-level fragmentation, orthography, morphology, and domain all matter. Tokenizer efficiency and model quality are distinct: a smaller token count alone does not prove better language understanding or cheaper end-to-end serving.

**Core question:** Can language-aware tokenization and model adaptation lower **cost per successfully completed task** while preserving quality and capabilities across languages?

### Initial research scope

- **Korean (`ko`) is the first optimization case study.** Hangul, agglutinative morphology, grammatical particles/endings, spacing variations, code-switching, and text-domain differences make it compelling.
- **Turkish (`tr`) is an early comparison language.** Its productive agglutinative morphology provides a useful contrast because it primarily uses a Latin-based alphabet. Do not assume Turkish shares Korean's exact tokenization failure modes.
- **English (`en`) is an initial reference baseline**, not a universally fair or semantically equivalent unit of measurement.
- Design the framework to support additional languages through configuration and plugins, rather than hardcoding Korean-specific assumptions into the core.

## 2. Intended deliverables

### A. TokenLab Explorer — interactive dashboard

Build an approachable, public-facing, **side-by-side tokenizer visualization**:

- Enter a phrase (initially Korean; later any supported language).
- Compare tokenization from a mainstream LLM tokenizer against an experimental TokenLab tokenizer.
- Show actual token count, token IDs when available, segmentation, exact bytes/boundaries, and visually highlighted fragments.
- Allow model/tokenizer selection, display relative token counts, and later support batch comparisons and estimated pricing.
- Label comparisons precisely: **tokenizer-level simulation** versus **hosted API count** versus **real model inference**.
- Do not present invented segmentation as a real tokenizer result.

**Commercial API constraints:** OpenAI's open-source `tiktoken` can locally expose token IDs and byte sequences for supported public encodings such as `cl100k_base` and `o200k_base`. This is preferable to issuing paid inference calls for tokenizer visualization; verify the encoding/model mapping and version. Anthropic's public token-counting API supports counting structured messages, but does not generally expose individual underlying token IDs/boundaries; show Anthropic as **count-only**, explicitly distinguishing message-level counts from raw-text tokenization. Revalidate provider behavior against current docs before implementing integrations.

**Critical Unicode rule:** Byte-level tokens may split UTF-8 code points. Retain byte spans and raw bytes. Do **not** assume each token decodes independently to a valid Unicode string or that each token boundary corresponds to a displayable Hangul syllable.

### B. TokenLab Bench — reproducible multilingual evaluation

Benchmark tokenization and runtime behavior using corpora across genres (conversational, formal, technical, news, informal/social, and mixed-script text) and a human-reviewed or otherwise quality-controlled parallel-text subset.

Measure:

- Tokens per passage, characters/bytes per token, length distributions, p50/p95 and difficult edge cases.
- Tokens per aligned translated passage; report ratios and uncertainty, not a universal language-wide multiplier.
- Unicode correctness, lossless round-trip behavior, unusual spacing, normalization, emoji and mixed-script robustness.
- Tokenizer CPU encoding throughput and latency.
- **For adapted models:** benchmark quality, output length, prefill/decode latency, requests/sec at fixed service objectives, VRAM/KV-cache footprint, power/energy, and end-to-end estimated cost.
- Keep explicit records of dataset provenance, licensing, hardware, software versions, model revisions, random seeds, and experiment configuration.

The overarching metric is **cost per successful task**, not merely tokens per text. Token efficiency, model accuracy, serving speed, and energy must be evaluated separately before making causal claims.

### C. TokenLab Train — tokenizer research and model adaptation

Explore and evaluate rather than assume benefits from:

- Baseline BPE, Unigram/SentencePiece, and language-aware pre-tokenization.
- Korean morphological boundaries versus statistical merges; vocabulary size/training-corpus allocation tradeoffs.
- **Append-only vocabulary expansion** of an open-weight model, retaining existing token IDs and special tokens.
- Initialization of newly added token embeddings using their decomposition under the original tokenizer, followed by targeted training.
- Carefully scoped continual pretraining or parameter-efficient adaptation, with Korean quality and English capability regression checks.

Suggested initial controlled study:

1. Original model + original tokenizer (untouched baseline).
2. Original tokenizer + additional Korean training (data/compute control).
3. Same base model + expanded Korean vocabulary (e.g., +2K and +8K tokens) + controlled additional training.

Match training data and comparable compute budgets, and report both source-text-matched and token-budget-matched comparisons where possible. **A tokenizer cannot simply be swapped into a pretrained model without appropriately adapting its embeddings/model.**

### D. TokenLab Serve — GPU systems economics

Deploy baseline and suitably adapted models on an inference engine such as vLLM (subject to model/tokenizer support). Compare **equivalent user tasks**, not only equal raw token counts. Control for caching, prompts, hardware, quantization, batching, concurrency, output length, and generation settings.

Measure time-to-first-token, end-to-end latency, goodput, throughput, VRAM/KV-cache requirements, energy per successful request and, where assumptions are explicit, dollar cost. Shorter sequences need not yield proportional cost gains; vocabulary size and output projection costs can offset benefits.

## 3. Hardware and development environment

### Primary Linux workstation

| Component | Configuration | Role |
| --- | --- | --- |
| GPU | NVIDIA GeForce RTX 5090, **32 GB VRAM** | Model adaptation, evaluation, CUDA inference and profiling |
| CPU | AMD Ryzen Threadripper **7960X** (24C/48T) | Text processing, tokenizer training, dataset workflows |
| System memory | **128 GB RAM** | Corpus and batch processing |
| Storage | **6 TB** | Datasets, results and checkpoints |

### Secondary machine

- **Apple M4 Pro Mac Mini** for development, SSH/orchestration, independent tokenizer checks, and optional MLX/Apple Silicon inference comparisons.
- Its unified memory capacity has not been specified.
- Do not attempt multi-device NVIDIA/Apple distributed training at the outset; treat the systems as separate roles.

### Environment setup status and practical notes

- Linux Python **3.12** was encountered during environment creation; actual OS/distribution and installed Python/PyTorch versions should be verified rather than assumed.
- Planned virtual environment: `~/venvs/kotokenlab` (path retains earlier project name; it can be renamed when convenient).
- An initial `python3 -m venv` attempt yielded an incomplete `bin/` directory containing only `python3.12`; verify the Python `venv`/`ensurepip` installation (Ubuntu/Debian often need `python3.12-venv`), then recreate the environment. **Successful repair was not confirmed in the discussion.**
- RTX 5090 has NVIDIA Blackwell compute capability **12.0 (`sm_120`)**. Use compatible NVIDIA drivers and a recent PyTorch CUDA build (CUDA **12.8+** is a useful baseline), then run an actual CUDA matrix multiplication rather than relying only on `torch.cuda.is_available()`.
- `nvidia-smi` reported approximately **1,678 MiB used by Xorg** at one point. This is reasonable desktop overhead (~5% of 32 GB). Leave desktop running for early work; headless operation can be revisited for memory-intensive workloads.
- Initial tokenizer training and the dashboard are primarily CPU tasks; GPU use becomes central in model adaptation and real inference benchmarking.

### Initial workstation verification commands

```bash
nvidia-smi
nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,memory.free --format=csv
nvcc --version        # Optional: toolkit compiler; not required by a prebuilt PyTorch wheel
python3 --version
```

If on Ubuntu/Debian with Python 3.12:

```bash
sudo apt update
sudo apt install -y python3.12-venv python3-pip git build-essential cmake pkg-config
# Only remove the old directory if there is nothing important to preserve:
rm -rf ~/venvs/kotokenlab
python3.12 -m venv ~/venvs/kotokenlab
source ~/venvs/kotokenlab/bin/activate
python -m pip install --upgrade pip setuptools wheel
```

Choose a current Blackwell-compatible PyTorch wheel from the **official PyTorch installation selector**; validate actual installed versions. Then:

```bash
python - <<'PY'
import torch
print('torch:', torch.__version__, 'CUDA build:', torch.version.cuda)
print('CUDA available:', torch.cuda.is_available())
assert torch.cuda.is_available()
print('GPU:', torch.cuda.get_device_name(0))
print('compute capability:', torch.cuda.get_device_capability(0))
a = torch.randn(2048, 2048, device='cuda')
b = torch.randn(2048, 2048, device='cuda')
_ = a @ b
torch.cuda.synchronize()
print('GPU execution: SUCCESS')
free, total = torch.cuda.mem_get_info()
print(f'VRAM free: {free/2**30:.2f} GiB / total: {total/2**30:.2f} GiB')
PY
```

Initial Python libraries: `tiktoken`, `tokenizers`, `sentencepiece`, `transformers`, `datasets`, `huggingface_hub`, `pandas`, `pyarrow`, `numpy`, `pytest`, `fastapi`, and `uvicorn`. Add model training/serving dependencies such as PEFT, Accelerate, and vLLM in a later, controlled environment once compatibility is established.

## 4. Proposed architecture

```text
tokenlab/
├── README.md
├── PROJECT_CONTEXT.md          # This document
├── AGENTS.md                   # Concise guidance for coding agents
├── pyproject.toml
├── src/tokenlab/
│   ├── tokenizers/            # Adapters: tiktoken, HF, custom
│   ├── benchmarks/            # Metric definitions and runners
│   ├── datasets/              # Corpus loaders + aligned text
│   ├── experiments/           # Tokenizer training/model adaptation
│   └── serving/               # Inference load and cost studies
├── dashboard/                 # React/Next.js or equivalent UI
├── configs/languages/
│   ├── en.yaml
│   ├── ko.yaml
│   └── tr.yaml
├── tests/
├── results/                   # Reproducible outputs, manifests
└── docs/                      # Research notes and blog drafts
```

**Dashboard candidate stack:** React/Next.js frontend + Python/FastAPI backend. Keep tokenizer adapters behind a shared interface. Define response fields such as `tokenizer_id`, `input_text`, `token_count`, `token_ids` (optional), `byte_spans` (optional), `count_source`, `supports_boundaries`, and tokenizer/model revision. Do not force commercial count-only endpoints to fabricate token IDs or spans.

Ensure datasets and model checkpoints are ignored by Git unless intentionally published and licensed; check the availability of the `TokenLab` repo/package name before public branding.

## 5. Research methodology and guardrails

1. **Do not conflate token count, model quality, and actual dollar cost.** Report each distinctly.
2. **Never claim an efficiency improvement without measurements.** Percentage targets (e.g., 20–40%) are research ambitions, not established results.
3. **Control the comparison.** Use matched corpora, model settings, compute budgets and evaluation quality; isolate gains from more training data versus gains from tokenization.
4. **Make byte-level outputs reversible and correct.** Inspect UTF-8 boundary splits and normalization behavior.
5. **Avoid language-essentialist claims.** Turkish can be inefficient despite a Latin alphabet; Korean's Hangul and morphology matter, but corpus composition and vocabulary design are crucial.
6. **Be careful with cross-language claims.** Translations differ in style and information density. Pair passages, inspect domain effects, and publish metric definitions.
7. **Respect corpus, model, and tokenizer licenses**; do not redistribute restricted datasets.
8. **Make results reproducible.** Capture hardware, GPU driver, CUDA/PyTorch, package lock, dataset/model hashes, benchmark scripts, seeds, and relevant profiling traces.
9. **Design for meaningful open-source PRs:** small tested improvements to existing projects are valuable even if the larger research hypothesis fails.

## 6. Relevant upstream ecosystems and background work

Candidate tools/projects to assess or contribute to (not a claim that an issue is currently open):

- [Hugging Face Tokenizers](https://github.com/huggingface/tokenizers) — Rust-backed tokenizer implementations.
- [SentencePiece](https://github.com/google/sentencepiece) — BPE/Unigram baselines.
- [OpenAI tiktoken](https://github.com/openai/tiktoken) — locally inspectable public OpenAI encodings.
- [Kiwi](https://github.com/bab2min/kiwi) — Korean morphological analysis.
- [Hugging Face Transformers](https://github.com/huggingface/transformers), [PEFT](https://github.com/huggingface/peft), [Accelerate](https://github.com/huggingface/accelerate) — model loading and adaptation.
- [vLLM](https://github.com/vllm-project/vllm) — serving performance experiments.
- [MLX LM](https://github.com/ml-explore/mlx-lm) — possible independent Apple Silicon comparisons.

Prior research topics raised in discussion include Korean-specific tokenization and vocabulary expansion (e.g., Thunder-Tok, EEVE-Korean, RedWhale) and morphology-aware Turkish tokenization. Verify papers, reported results, code, and licenses before citing in a published writeup.

## 7. Phased implementation sequence

### Phase 0 — Workstation readiness

- Verify NVIDIA GPU detection, driver, VRAM, CUDA capability and a real PyTorch GPU operation.
- Repair/create the virtual environment; record dependency versions and hardware details.
- Initialize repository, tests, lint/CI, data manifests and reproducible benchmark conventions.

**Exit criterion:** Successful CUDA matrix multiplication and working Python/tokenization environment.

### Phase 1 — TokenLab Explorer MVP

- Integrate OpenAI `cl100k_base` and `o200k_base` locally via `tiktoken`.
- Add at least one Hugging Face open-weight tokenizer adapter.
- Implement Korean input, side-by-side actual token boundaries and IDs, byte-safe inspection, and count metrics.
- Add Turkish/English examples and a clearly labeled count-only API adapter only if needed.

**Exit criterion:** A user can enter Korean text and see reproducible, real tokenization comparisons for two selectable tokenizers.

### Phase 2 — TokenLab Bench

- Assemble legally usable Korean, Turkish, and English datasets across genres plus an aligned multilingual subset.
- Publish baseline tokenization efficiency and CPU throughput measurements, including distribution and failure-case analysis.
- Document methodology and limitations.

**Exit criterion:** Others can run benchmark commands and reproduce tabular/chart results.

### Phase 3 — Korean-aware tokenizer experiments

- Train BPE, Unigram, and morphology-aware variants using controlled corpora/vocabulary sizes.
- Evaluate compression, correctness and throughput; choose promising candidates for model adaptation.

**Exit criterion:** A defensible evaluation of which proposed strategies merit downstream modeling.

### Phase 4 — Model vocabulary expansion and adaptation

- Start from a suitable, licensed 1B–3B open-weight model compatible with local compute.
- Compare baseline, original-tokenizer data control, and vocabulary-expanded versions.
- Measure Korean quality, English regressions and training costs.

**Exit criterion:** An adapted model and controlled evidence of its effects (positive or negative).

### Phase 5 — Inference economics and publication

- Benchmark serving on the RTX 5090 across workloads and concurrency levels; optionally separately compare the M4 Pro.
- Evaluate real throughput, latency, KV-cache, memory, energy and quality-adjusted cost.
- Publish dashboard, benchmark suite, experiment artifacts, blog posts and candidate upstream PRs.

**Exit criterion:** Reproducible end-to-end findings that link tokenization changes to actual inference performance and task quality.

## 8. Planned blog series

1. **Does Korean Cost More to Run on LLMs?** Tokenization disparities across models and genres; Threadripper corpus benchmarks.
2. **Teaching a Small LLM New Korean Tokens on an RTX 5090.** Vocabulary extension and controlled adaptation.
3. **Fewer Tokens, Faster Inference?** Measure real GPU memory, latency, throughput, quality and energy.
4. **CUDA vs. Apple Silicon for Multilingual LLM Inference.** Optional hardware comparison with careful methodology.

The dashboard should become a visual centerpiece for the blog series, showing *actual* mainstream-tokenizer and experimental-tokenizer segmentation alongside measured performance rather than purely illustrative improvements.

## 9. Working preferences and near-term next actions

- Prefer **concrete terminal commands**, precise assumptions, reproducible scripts and systems-level explanations.
- Build something useful and open source early; evolve research claims only as evidence accrues.
- Preserve a clear distinction between **planned / attempted / completed / measured** work in documentation.
- Keep language support extensible, but focus experimental effort on Korean first; use Turkish as a comparative benchmark rather than prematurely expanding model training.

**Immediate next actions:**

1. Confirm the Linux OS, driver, working Python virtual environment and PyTorch CUDA test.
2. Initialize the generalized `tokenlab` repository structure and developer tooling.
3. Implement two tokenizer adapters with real byte-safe token breakdowns.
4. Build the simplest side-by-side TokenLab Explorer and start a small Korean benchmark corpus.

---

*This document reflects the project discussion through October 2026. Update its status, decisions, measurements, and references as experiments progress.*
