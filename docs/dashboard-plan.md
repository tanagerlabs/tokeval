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

## Later (unordered backlog)

- Batch comparison and estimated-pricing views (PROJECT_CONTEXT.md §2A).
- Embeddable `TokenComparer` distribution for blog posts (AGENTS.md architecture note).
