# Dashboard Plan

> Living plan for the TokEval Explorer dashboard (`dashboard/`). Maintained by the planning agent; implemented by the coding agent; verified by the testing agent. Statuses follow AGENTS.md: planned / attempted / completed / measured.

## Current state (completed)

Astro + React app in `dashboard/` with side-by-side tokenizer comparison:

- `src/components/TokenComparer.tsx` — top-level comparison UI (input + two result cards).
- `src/components/TokenCard.tsx` — colored token breakdown: an `ol.token-stream` of token chips (text or byte-fragment hex) with IDs, byte spans in tooltips, `tabIndex=0` per token.
- `src/lib/tokenizer.ts`, `token-bytes.ts` — tokenization result model with raw bytes/byte spans (byte fragments render as `‹hex›`, never fabricated text).
- `src/lib/open-model-*.ts`, `open-tokenizer-client.ts`, `open-tokenizer.worker.ts` — open-weight tokenizers in a web worker.
- Styling in `src/styles/global.css` (`.token-output` → `.token-stream` wrapped flex list, currently unbounded height); tests in `dashboard/tests/`.

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
