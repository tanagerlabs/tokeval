# Dashboard Plan

> Living plan for the TokEval Explorer dashboard (`dashboard/`). Maintained by the planning agent; implemented by the coding agent; verified by the testing agent. Statuses follow AGENTS.md: planned / attempted / completed / measured.

## Current state (completed)

Astro + React app in `dashboard/` with side-by-side tokenizer comparison:

- `src/components/TokenComparer.tsx` — top-level comparison UI with reorderable, add/remove model cards.
- `src/components/TokenCard.tsx` — colored token breakdown: an `ol.token-stream` of token chips (text or byte-fragment hex) with IDs, byte spans in tooltips, `tabIndex=0` per token.
- `src/lib/tokenizer.ts`, `token-bytes.ts` — tokenization result model with raw bytes/byte spans (byte fragments render as `‹hex›`, never fabricated text).
- `src/lib/open-model-*.ts`, `open-tokenizer-client.ts`, and the family-specific `open-tokenizer-*.worker.ts` entries — open-weight tokenizers in on-demand web workers.
- Styling in `src/styles/global.css` (`.token-output` → `.token-stream` wrapped flex list, currently unbounded height); tests in `dashboard/tests/`.

## Performance and request-cost roadmap

Status as of 2026-10-19. The dashboard selection is the source of truth for
work: only model/provider rows currently visible in the comparison may be
tokenized locally or included in a hosted request when input changes. Collapsed
rows remain visible and active; removed rows do not perform work.

1. **Completed — reduce hosted estimator fan-out and persist baselines.**
   Anthropic and Google now use one differential wrapper on the normal path,
   persist empty-wrapper baselines in the Worker Cache API, and use the two
   additional contexts only if the primary differential is invalid. Normal
   cold-isolate provider fan-out is seven external calls across Anthropic,
   Google, and xAI instead of fifteen; with warm baselines it is five. The
   Worker subrequest ceiling retains headroom for the uncommon fallback path.
2. **Completed — cache repeated hosted comparisons in the browser and debounce
   xAI more conservatively.** A bounded 50-entry/20,000-token session-memory LRU
   is keyed by exact input plus the visible hosted model IDs. Successful results
   are reused; failures are not cached. Updates containing a visible xAI row use a 1.3
   second trailing debounce; other hosted-only selections retain 650 ms.
3. **Completed — make core tokenizer work selection-aware.** `tokenizeAll`
   accepts visible core model IDs, so an unselected OpenAI vocabulary is neither
   downloaded nor evaluated. The UI skips both core and open-model imports when
   no visible row needs that tokenizer family.
4. **Completed — split open-model workers and slim SentencePiece.** Separate
   Llama/tiktoken, Hugging Face, and native SentencePiece workers load only for
   visible rows in their family. The build strips three unused tokenizer models
   embedded by the pinned SentencePiece dependency, and the byte-oriented model
   loader avoids base64 expansion. The production SentencePiece worker measured
   about 268 KiB gzip after this change; the default Llama worker measured about
   3.6 KiB gzip.
5. **Planned — cap or virtualize token-box rendering.** Preserve exact counts
   and byte data while progressively rendering or windowing long breakdowns.
   Count-only placeholder visuals should not create one DOM node per token.
6. **Planned — persist pinned tokenizer artifacts and limit download
   concurrency.** Cache licensed artifacts by revision/SHA in browser storage or
   an immutable project-controlled CDN, disclose download sizes, and limit
   simultaneous large artifact fetches.
7. **Planned — consolidate install/build overhead and production telemetry.**
   Evaluate npm workspaces for dependency hoisting, remove extraneous packages,
   sample routine success logs while retaining errors and aggregate metrics, and
   enforce per-chunk bundle budgets in CI.

## Next steps (planned)

### 1. Bound the token breakdown height for large inputs, with scrolling

Large inputs currently grow each `.token-stream` without limit, pushing the second card and page controls off-screen.

- Enforce a vertical limit on the colored token breakdown area (`.token-output` / `.token-stream` in `src/styles/global.css:420-434`, rendered by `TokenCard.tsx`): add a `max-height` (suggest a rem value approximating 8–12 chip rows; pick to fit both cards plus controls in a typical viewport) and `overflow-y: auto` on the scroll container so all tokens remain reachable.
- Scope: the limit applies per card; each card scrolls independently. Token chips keep wrapping horizontally (`flex-wrap: wrap`) — vertical scrolling only, no horizontal overflow.
- Keep keyboard access working: token chips are `tabIndex=0`; tabbing to an off-screen chip must scroll it into view (native behavior — just don't break it with `overflow: hidden` on an inner wrapper). Give the scroll container `tabindex="0"` or rely on chip focus so keyboard-only users can scroll; retain the existing `aria-label`s.
- Make the cut-off discoverable: visible scrollbar (don't suppress it) and/or a subtle bottom fade when content overflows.
- Theme: scrollbar/fade must look correct in both light and dark (`ThemeToggle.astro` themes).

Acceptance criteria:

1. Pasting a very large input (e.g. several thousand characters of mixed Korean/English/emoji) keeps both cards and the input visible in one viewport; the breakdown area never exceeds its max height.
2. Every token remains reachable by scrolling and by Tab-focus (focused chip scrolls into view).
3. Small inputs render exactly as today — no reserved empty space, no scrollbar.
4. No horizontal scrollbar at any input size; byte-fragment chips still render.

Testing notes: component test with a token count large enough to overflow (assert container `overflow-y` and that all `li` are rendered, not virtualized/truncated); visual check at both themes; keyboard-focus scroll behavior.

### 2. Hosted provider rows (Anthropic, Gemini, xAI) via a server-side adapter endpoint

The dashboard stays fast and mostly static, but live Anthropic, Gemini, and current Grok results require an authenticated server-side adapter. Provider capabilities (verified against docs as of 2026-10-18 — revalidate before implementing):

| Provider/model | Available result | Important limitation |
|---|---|---|
| Claude Opus 5.5 | Total input tokens | Anthropic returns only `input_tokens`, no IDs or boundaries. Token counting is free but authenticated and rate-limited (starting tier: 5,000 req/min). [Docs](https://platform.claude.com/docs/en/build-with-claude/token-counting) |
| Gemini 4 Argon | Total tokens and modality totals | `countTokens` returns `totalTokens`, no IDs or boundaries. Requires API key; subject to project RPM/TPM/RPD quotas. [countTokens](https://ai.google.dev/api/tokens), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) |
| Grok 4.7 | Full IDs, strings, and exact bytes | xAI `/v1/tokenize-text` provides everything the existing colored visualization needs, but requires an authenticated call. [Endpoint](https://docs.x.ai/developers/rest-api-reference/inference/other), [Grok 4.7](https://docs.x.ai/developers/models/grok-4.7) |

Architecture:

1. Keep the existing Astro page and local worker unchanged; keep Grok-1 as the reproducible, entirely local comparison.
2. Add one small edge/serverless endpoint holding the three provider keys (keys exclusively in server-side secrets; the xAI key scoped to only the tokenizer endpoint/model).
3. Browser sends one request; the endpoint calls providers concurrently with short timeouts and independent per-provider failure states.
4. Return a unified result with explicit source types — `local_tokenizer`, `hosted_count`, `hosted_tokenizer` — matching the adapter-interface invariant (CLAUDE.md): count-only backends report absence, never fabricated boundaries.
5. Claude and Gemini render as totals with "Token breakdown unavailable"; Grok 4.7 renders the complete colored breakdown.
6. Pin model IDs (e.g. `grok-4.7`), never mutable `latest` aliases; revalidate available models in scheduled CI, not per visitor request.

Performance and scale:

- Keep pre-rendering the default Korean results.
- Hosted results are a single "Fetch hosted results" opt-in — never transmitted per keystroke.
- Cache by an HMAC of (exact UTF-8 input, provider, pinned model ID); never store raw text. Long cache lifetimes for pinned models; coalesce identical concurrent requests.
- Rate-limit by IP/session; cap input length.

Privacy disclosure (required): once hosted rows exist, the page can no longer universally claim input never leaves the browser. Hosted results are opt-in, and the UI must state exactly which providers receive the text.

**Decision — server code is public, in this repo (decided 2026-10-18).** No private sibling repo. The server side (endpoint, provider adapters, caching, rate limiting) is on-topic tokenization-lab substance, and public code makes the privacy claims above auditable rather than asserted. Only three things are private, and none live in git: provider API keys and the cache HMAC key (CircleCI contexts / cloud secret manager), and account-specific wiring (account IDs, zone IDs, ARNs, domains — supplied by CI as CFN parameters). Sensitive *thresholds* (rate limits, WAF rules) may be CI-supplied config: public code, private numbers.

Repo layout:

```
tokeval/
├── dashboard/          # unchanged
├── dashboard/server/   # edge endpoint, provider adapters, caching, rate limiting
│   ├── .env.example    # names of required secrets, no values
│   └── fixtures/       # recorded provider responses
└── infra/              # parameterized CFN; zero account specifics
```

Contributor and CI requirements (acceptance criteria for this step):

1. **Mock-first dev:** recorded provider-response fixtures let a contributor with no API keys run and test the full server path; the standard test suite uses only fixtures.
2. **Fixture revalidation:** a maintainer-only scheduled CI job re-checks fixtures and pinned model IDs against live APIs (same job as the model revalidation above).
3. **Fork-PR safety:** CircleCI contexts restricted to the org; secrets never passed to forked-PR builds (keep that setting off). Fork PRs run the mock suite only; deploy jobs run only from `main` under the maintainer context.
4. **No secrets in git:** `.env.example` documents required variable names; CFN templates contain no account identifiers; a secret-scan check runs in CI.

Sequencing and estimate: ~2–4 days covering provider adapters, edge endpoint, caching, rate limiting, privacy messaging, tests, and failure handling. Grok 4.7 first (full visualization); Claude and Gemini then reuse the same infrastructure as count-only rows.

### 3. Model catalog expansion (partially completed)

Goal: adding a model or provider to the comparison list should be a config change with provenance, not a code change, except where a genuinely new integration is required. Status as of 2026-10-19: Class B, catalog consolidation, and the first Class A expansion batch are **completed**; Class C and artifact persistence/revalidation remain **planned**.

Implementation update (completed 2026-10-19):

- `dashboard/catalog/models.json` is now the single catalog for provider identity,
  local tokenizer provenance, pinned revisions, artifact hashes/sizes, hosted
  upstream ids, capability, and count source. The browser catalog, picker, local
  worker profiles, and hosted Worker defaults derive from it; runtime validation
  rejects duplicate models and orphaned providers.
- Catalog schema v2 separates model identities from tokenizer integrations.
  Local model rows reference a reusable `tokenizerId`; OpenAI GPT variants,
  Llama 4 Scout/Maverick, the Qwen3 size family, Phi-4 reasoning variants,
  Kimi K2 variants, and Granite 3.3 variants can therefore appear separately
  in the picker while sharing one artifact download and one encode operation
  per input. Hosted models remain model-specific because provider request
  framing and counts can differ by model.
- The Astro build reads the configured Worker's `GET /api/v1/models` endpoint
  and embeds a validated snapshot. It falls back to the checked-in hosted
  catalog if the Worker is unavailable. Unknown hosted providers are rejected;
  configured disabled models remain visible and return `FEATURE_DISABLED`.
- Built-in hosted choices now include Claude Opus 5.5, Sonnet 5.5, Haiku 5.5,
  and Fable 5.1; Gemini 4 Argon, 3.8 Flash, 3.1 Pro Preview, 3.5 Flash-Lite,
  and 2.5 Pro; and Grok 4.7. The existing environment overrides still apply to
  the three default public ids.
- Pinned local profiles were added for Alibaba Qwen3 8B, Microsoft Phi-4,
  Moonshot Kimi K2 Instruct, Z.ai GLM-4.5, IBM Granite 3.3 8B Instruct, and
  NVIDIA OpenCodeReasoning Nemotron 7B. The existing OpenAI, DeepSeek, Google,
  Meta, Mistral, Cohere, and xAI entries remain available.
- Qwen3 and the Qwen-derived Nemotron tokenizer normalize their input. They are
  therefore exposed as exact local **count-only** profiles: TokEval displays the
  exact number of empty token boxes and explicitly withholds boundaries rather
  than fabricating a mapping to the original bytes. Other new profiles passed
  the shared multilingual/emoji/decomposed-Unicode byte round-trip corpus.
- Kimi's pinned tiktoken merge table carries a SHA-256 check. Its official
  Python regex was translated to an equivalent ECMAScript expression; token IDs
  were checked against the official Python `tiktoken` implementation on Korean,
  Han, mixed-script, decomposed-Unicode, contraction, and numeric fixtures.
- Large artifacts are fetched only when their row is added. The picker discloses
  raw download sizes for artifacts over 2 MB. Inclusion of Qwen (11.4 MB), GLM
  (20.0 MB), and Nemotron (11.4 MB) is an explicit product decision for catalog
  coverage; none is part of the initial five-row dashboard.

Still planned: persistent project-controlled artifact caching/CDN, scheduled
revision/model-id revalidation, bundle budgets, and any Class C provider adapter.

**Completed — efficiency ordering.** After each settled text evaluation, visible
cards are ranked by the count actually displayed in the UI, ascending. Exact
and explicitly estimated content counts participate; loading, failed, and
unavailable rows remain after counted rows. Ties are stable, preserving manual
drag order. Ranking runs only after the relevant local/hosted work settles, and
the existing card-position animation handles movement without repeated sorting
during partial async updates.

Before this implementation, the catalog lived in the following duplicated
locations. This table is retained as historical rationale; these consumers now
derive their identity data from `dashboard/catalog/models.json`.

| Location | Owns | Format |
|---|---|---|
| `dashboard/src/lib/tokenizer.ts` (`TOKENIZER_PROFILES`) | OpenAI tiktoken encodings run locally | hardcoded record |
| `dashboard/src/lib/open-model-profiles.ts` (`OPEN_MODEL_PROFILES`) | open-weight tokenizers run in browser workers; pinned repo revision, optional artifact URL + sha256, decoder family | hardcoded array |
| `dashboard/src/lib/hosted-tokenizer.ts` (`HOSTED_MODEL_PROFILES`) | hosted rows shown in the UI | hardcoded to exactly three ids: `anthropic-default`, `gemini-default`, `grok-default` |
| `dashboard/server/src/models.ts` (`buildModelRegistry`) | hosted models the Worker will serve: three defaults from env vars plus `ADDITIONAL_MODELS_JSON`; exposed at `GET /api/v1/models` | env/JSON at deploy time |

The vendor list in `src/components/ModelPicker.tsx` and the `TokenizerProvider` union in `tokenizer.ts` are a fifth and sixth copy of the vendor set.

Candidate models fall into four classes with very different cost. Plan work per class, not per model.

**Class A — open-weight model with a public tokenizer (completed for the first expansion batch).** Qwen, Phi, Kimi, GLM, Granite, and Nemotron were added using the existing Hugging Face or generic tiktoken worker families. Further models remain config-driven additions with the same provenance and verification requirements.

Acceptance criteria per model:

1. Profile entry with `repository`, a full commit `revision`, and `sourceUrl` pointing at that revision. Raw artifacts (anything fetched outside the HF tokenizer loader) must carry `artifactSha256`.
2. Entry in `tests/open-models.integration.test.ts` asserting the pinned revision tokenizes the shared fixture corpus to the expected count and round-trips bytes (the byte-safety corpus: emoji, mixed scripts, odd spacing, code-point splits).
3. Gated or license-restricted repos are not fetched from Hugging Face at page load; they use a project-controlled mirrored artifact with sha256 (ties to roadmap item 6, artifact persistence).
4. Disclose artifact download size in the picker when it exceeds 2 MiB gzip; vocabularies above roughly 10 MiB need an explicit decision before inclusion.
5. If a profile's `tokenizer.json` uses a pre-tokenizer the pinned `@huggingface/tokenizers` build does not implement, the model is rejected rather than approximated. A supported normalizer may be exposed as exact count-only when normalization prevents lossless raw-input spans; this limitation must be recorded in the catalog and shown in the UI. Qwen3 and Nemotron use this mode.

**Class B — additional models from an existing hosted provider (completed).** The Worker serves checked-in models plus `ADDITIONAL_MODELS_JSON` and lists them at `/api/v1/models`; the Astro build now consumes that registry and embeds it into the picker.

Target: `src/lib/hosted-tokenizer.ts`, `src/lib/model-catalog.ts`, `src/components/ModelPicker.tsx`, `src/lib/initial-hosted-results.ts`.

1. Widen `HostedModelProfile.id` from the three-literal union to `string`; derive `countSource`, `supportsBoundaries`, label, and vendor from the Worker's model list rather than from constants.
2. Add a loader that reads `GET /api/v1/models` from the configured `PUBLIC_HOSTED_TOKENIZER_API_URL`. Preferred: fetch at Astro build time and embed as a static snapshot so the static page keeps rendering with no runtime dependency; fall back to the three built-in defaults when the endpoint is unreachable at build. Runtime refresh of the list is optional and must be opt-in like hosted results themselves.
3. `DEFAULT_MODEL_IDS` and `defaultModelOrder` continue to work when the catalog grows; a model present in the snapshot but disabled on the Worker renders as unavailable with the Worker's error code, never silently dropped.
4. Public ids remain stable and pinned (e.g. `anthropic-claude-opus-5-5`), never `latest` aliases, per step 2.
5. Tests: `model-catalog.test.ts` builds a catalog from a fixture `/api/v1/models` payload with five hosted models across three providers; `hosted-tokenizer.test.ts` covers an unknown provider string in the payload (must be rejected, not rendered). Fixture-only, no live calls.

Estimate: about one day. After this lands, adding a Class B model is a `wrangler` variable change and a redeploy.

**Class C — a new hosted provider.** About one day each. Required pieces: a new adapter in `dashboard/server/src/providers/`, dispatch in `providers/index.ts`, `ProviderName` and `CountSource` widened in both `server/src/types.ts` and `src/lib/hosted-tokenizer.ts`, a new secret documented in `.dev.vars.example`, error-code mapping, cache keying, a recorded fixture, and the ALLOWED/ENABLE flag pattern used for xAI. Before any of this, confirm the provider is actually needed:

| Provider | Verdict | Reason |
|---|---|---|
| OpenAI | No adapter | tiktoken is exact locally; already Class A. |
| Mistral | No adapter | Tokenizers are public (Class A), including the tiktoken-style `tekken` format. |
| Cohere | Candidate | Has a hosted tokenize endpoint returning ids and strings; could render a full breakdown like xAI. Verify current endpoint and auth before planning. |
| AWS Bedrock | Candidate | `CountTokens` API for Bedrock-hosted models; SigV4 auth is a different credential pattern from the API-key providers and needs its own secret handling. |

Treat these verdicts as of 2026-10-19 and revalidate against docs before implementing.

**Class D — no public tokenizer and no count endpoint.** Cannot be supported as an exact row. The result types already allow `content_count_kind: "estimated"`; showing such a model is a product decision to be recorded here before implementation, and the UI must label the row as an estimate per the adapter invariant. Default: do not list.

**Consolidation (completed):** model identity, vendor, tokenizer source, revision, artifact hash/size, decoder family, and count source now live in `dashboard/catalog/models.json`. `tokenizer.ts`, `open-model-profiles.ts`, the hosted snapshot loader, `ModelPicker.tsx`, and the Worker registry derive from it. Runtime/tests validate the schema today; scheduled revalidation remains planned.

Sequencing: B (unlock Worker-configured hosted models) → consolidation → A additions in batches, each batch adding its revalidation entries → C only when a specific provider is justified.

## Later (unordered backlog)

- Batch comparison and estimated-pricing views (PROJECT_CONTEXT.md §2A).
- Embeddable `TokenComparer` distribution for blog posts (AGENTS.md architecture note).
