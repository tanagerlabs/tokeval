# Hosted Tokenization Server Architecture

> Status: proposed architecture, not implemented.
>
> Last reviewed: 2026-10-18
>
> This document describes the server-side request architecture proposed for
> Anthropic, Gemini, and recent Grok tokenization data. Provider APIs, model
> identifiers, rate limits, privacy terms, and prices can change. Revalidate
> them against the linked official documentation before implementation and at
> every production release.

## 1. Executive recommendation

Keep the existing Astro site statically rendered and keep every publicly
available tokenizer in the browser. Add a small, separately deployed
Cloudflare Worker only for provider operations that require secret API keys:

- Anthropic message-input token counts.
- Gemini input token counts.
- xAI/Grok token IDs, token strings, and exact token bytes.

The browser should make one request after the user explicitly enables hosted
results and input has settled. The Worker validates the request, checks limits,
then calls only the requested providers in parallel. It returns each provider's
result independently so a slow or unavailable provider does not block the
others or any local tokenizer.

Use Cloudflare Workers Paid as the initial production platform, D1 only for
accounts, entitlements, aggregate usage, and non-sensitive benchmark metadata,
and Stripe only when premium Grok access is launched. Do not persist arbitrary
user text or token breakdowns on the server. Cache private results in the
browser; reserve shared edge caching for public examples and published
benchmark inputs.

This preserves the current site's speed and SEO, keeps the security boundary
small, avoids exposing provider keys, and has a predictable platform floor of
about $5 per month under the pricing reviewed for this plan. Provider charges,
authentication, payment processing, and domain expenses are separate.

## 2. Goals and non-goals

### Goals

1. Add exact, provider-reported counts for Anthropic and Gemini.
2. Add exact recent Grok token breakdowns when the xAI API supports the chosen
   model.
3. Keep local results instant and independent from network latency.
4. Never expose provider credentials to the browser.
5. Make data provenance visible in the response and interface.
6. Scale across many visitors without maintaining an always-on application
   server.
7. Bound provider cost, infrastructure cost, abuse, and accidental retries.
8. Avoid retaining private prompts by default.
9. Keep the provider adapters replaceable and testable.
10. Preserve exact token bytes whenever a provider returns them.

### Non-goals for the first release

- Proxying chat completion or inference requests.
- Building a full model router or OpenAI-compatible gateway.
- Reconstructing token pieces for count-only providers.
- Sending local-tokenizer text to the server.
- Persisting arbitrary prompts for cross-user caching.
- Supporting images, PDFs, tools, or full message histories in the public
  dashboard request.
- Claiming that a raw-text count is equivalent to a full production message
  count with system prompts, tools, media, or provider framing.
- Treating token count as a model-quality measurement.

## 3. Provider capability matrix

The UI and API must preserve these distinctions instead of forcing every
provider into an invented common breakdown.

| Provider | Server operation | Result available | Breakdown | Initial access |
| --- | --- | --- | --- | --- |
| Anthropic | Messages token counting | Structured-message input total | Unavailable | Free, rate-limited |
| Gemini | `models.countTokens` | Input total | Unavailable | Free, rate-limited |
| xAI/Grok | `POST /v1/tokenize-text` | Count plus token IDs, strings, and bytes | Available | Feature-flagged, then premium |

### 3.1 Anthropic

Anthropic's token-counting endpoint accepts message-like structured input and
returns `input_tokens`. It does not expose the underlying token IDs or token
boundaries. Anthropic currently documents counting as free and lists a
starting-tier limit of 5,000 requests per minute.

The dashboard should therefore show:

- A provider-reported total.
- The exact Claude model identifier used.
- `hosted_message_count` as the source type.
- An explicit "Token breakdown unavailable from provider" state.

For the dashboard's plain-text field, the adapter wraps the text in one user
message. The result includes provider message framing and must not be labeled as
raw-text tokenization.

### 3.2 Gemini

Gemini exposes `models.countTokens` and returns `totalTokens`. The public API
does not return token IDs or boundaries. Quotas vary by project, account tier,
model, and API surface, so the service must read actual limits from the
configured Google project rather than rely on an old hard-coded number.

The dashboard should show:

- A provider-reported input total.
- The exact Gemini model identifier used.
- `hosted_input_count` as the source type.
- An explicit "Token breakdown unavailable from provider" state.

The initial adapter should support text only. Multimodal counting can be added
later through a distinct endpoint and privacy review.

### 3.3 xAI/Grok

xAI exposes `POST /v1/tokenize-text`. Its documented response contains a list
of token objects with `token_id`, `string_token`, and `token_bytes`. This is a
real provider breakdown and should not be confused with inference usage.

The dashboard can show:

- A count derived from the returned token array.
- Token IDs.
- Provider token strings.
- Exact byte arrays, including byte fragments that do not independently decode
  as valid UTF-8.
- `hosted_token_breakdown` as the source type.
- The exact Grok model identifier requested and resolved, when available.

Do not use `latest` in reproducible benchmark releases. Product aliases are
acceptable for an interactive convenience row only if the response makes that
fact visible. Published results should use a stable, explicit model identifier
and record the request date.

xAI's public pricing page reviewed for this plan did not state a separate price
for `/v1/tokenize-text`. Treat its cost as unknown until a controlled billing
test or written provider confirmation establishes the behavior.

## 4. System boundary

```text
                       LOCAL PATH

User input
    |
    +--> React TokenComparer
            |
            +--> Web Worker tokenizer adapters
            |       |- OpenAI public encodings
            |       |- Meta/open tokenizers
            |       |- DeepSeek/open tokenizers
            |       `- Cohere/open tokenizers
            |
            `--> immediate local rows; text never leaves browser


                       HOSTED PATH

User explicitly enables hosted rows
    |
    +--> debounce + AbortController + browser cache
            |
            `--> POST /api/v1/tokenize/compare
                     |
                     v
              Cloudflare Worker
                |- origin/body/model validation
                |- authentication/entitlement lookup
                |- per-IP and per-account limits
                |- request budget and in-flight deduplication
                |
                +--> Anthropic count adapter ----> total only
                +--> Gemini count adapter -------> total only
                `--> xAI tokenizer adapter ------> IDs/strings/bytes
                     |
                     v
              normalized partial response
```

The Worker is a secret-bearing adapter and policy boundary, not a general
application backend. The Astro pages, metadata, explanatory copy, public
benchmarks, and local tokenizer bundles remain static.

## 5. Recommended repository boundary

When implementation begins, keep hosted logic separate from the dashboard's
local tokenizer code:

```text
tokeval/
├── dashboard/                         # Existing Astro + React site
│   └── src/
│       ├── components/
│       └── lib/
│           ├── hosted-client.ts       # Browser API client only
│           └── hosted-result-cache.ts # Memory/IndexedDB cache
├── server/
│   ├── src/
│   │   ├── index.ts                   # Worker fetch handler/router
│   │   ├── auth.ts
│   │   ├── limits.ts
│   │   ├── schema.ts
│   │   ├── normalize.ts
│   │   ├── providers/
│   │   │   ├── anthropic.ts
│   │   │   ├── gemini.ts
│   │   │   └── xai.ts
│   │   └── observability.ts
│   ├── test/
│   ├── migrations/
│   ├── package.json
│   ├── tsconfig.json
│   └── wrangler.toml
└── SERVER_ARCHITECTURE.md
```

This is a proposed layout, not an assertion that these files exist today.

## 6. Public API contract

### 6.1 Endpoint

```http
POST /api/v1/tokenize/compare
Content-Type: application/json
```

One endpoint is preferable to three browser-to-server calls because it gives
the Worker one place to enforce limits, creates one browser cancellation
boundary, and lets provider requests run concurrently.

### 6.2 Request

```json
{
  "text": "안녕하세요, 세계!",
  "providers": [
    { "provider": "anthropic", "model": "claude-stable-alias" },
    { "provider": "google", "model": "gemini-stable-alias" },
    { "provider": "xai", "model": "grok-stable-alias" }
  ],
  "request_id": "client-generated-uuid"
}
```

Rules:

- `text` is required, valid Unicode, and between 1 byte and the configured
  maximum; start with 16 KiB.
- `providers` contains one to three unique entries.
- `provider` is an allowlisted enum, never an arbitrary upstream URL.
- `model` must match a server-controlled alias or allowlist.
- `request_id` is for stale-result suppression and tracing, not idempotent
  long-term storage.
- Ignore or reject unknown fields to keep the contract narrow.

Do not accept provider API keys from the public dashboard in v1. A later
bring-your-own-key design requires a separate threat and privacy review and
should never log supplied credentials.

### 6.3 Successful response

```json
{
  "request_id": "client-generated-uuid",
  "results": [
    {
      "provider": "anthropic",
      "requested_model": "claude-stable-alias",
      "resolved_model": "provider-model-id",
      "status": "ok",
      "count_source": "hosted_message_count",
      "token_count": 12,
      "supports_boundaries": false,
      "token_ids": null,
      "tokens": null,
      "provider_request_id": null
    },
    {
      "provider": "google",
      "requested_model": "gemini-stable-alias",
      "resolved_model": "provider-model-id",
      "status": "ok",
      "count_source": "hosted_input_count",
      "token_count": 10,
      "supports_boundaries": false,
      "token_ids": null,
      "tokens": null,
      "provider_request_id": null
    },
    {
      "provider": "xai",
      "requested_model": "grok-stable-alias",
      "resolved_model": "provider-model-id",
      "status": "ok",
      "count_source": "hosted_token_breakdown",
      "token_count": 9,
      "supports_boundaries": true,
      "token_ids": [101, 202],
      "tokens": [
        { "id": 101, "bytes": [236, 149, 136], "text": null },
        { "id": 202, "bytes": [235, 133, 149], "text": null }
      ],
      "provider_request_id": null
    }
  ],
  "meta": {
    "schema_version": "1",
    "generated_at": "2026-10-18T00:00:00Z",
    "retained_input": false
  }
}
```

The example counts and IDs above are illustrative, not measured values.

### 6.4 Token representation

The canonical token value is its byte array, not its independently decoded
string. A token can contain only part of a multi-byte UTF-8 code point.

```ts
type HostedToken = {
  id: number;
  bytes: number[];
  text: string | null;
};
```

Set `text` only when the provider returned a string that is consistent with the
bytes or when those bytes independently decode without replacement. Never
invent replacement text. The renderer should concatenate bytes across tokens
when it needs to reconstruct the original input.

For every xAI success, validate before responding:

1. Every byte is an integer from 0 through 255.
2. Concatenated token bytes equal the UTF-8 bytes of the input.
3. `token_count` equals the token array length.
4. Token IDs are safe integers.

If validation fails, return a provider error rather than showing a misleading
breakdown.

### 6.5 Partial failure response

The overall HTTP request can be `200` when at least one requested provider
succeeded. Each result carries its own status:

```json
{
  "provider": "xai",
  "requested_model": "grok-stable-alias",
  "resolved_model": null,
  "status": "unavailable",
  "count_source": "hosted_token_breakdown",
  "token_count": null,
  "supports_boundaries": true,
  "token_ids": null,
  "tokens": null,
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "retryable": true
  }
}
```

Never send raw upstream response bodies, stack traces, provider credentials, or
internal billing details to the client.

### 6.6 HTTP status policy

| Status | Meaning |
| --- | --- |
| `200` | Valid request; one or more per-provider results returned |
| `400` | Malformed JSON, invalid text, duplicate provider, or bad schema |
| `401` | Authentication required for the requested feature |
| `403` | Account lacks the required entitlement |
| `413` | Input exceeds the byte limit |
| `429` | Site-level rate or monthly usage limit exceeded |
| `503` | No requested provider could be attempted because service is disabled |

Upstream `429`, `500`, and timeouts should normally become per-provider errors
inside a `200` response, allowing other providers to render.

## 7. End-to-end request lifecycle

### 7.1 Browser

1. Render local tokenizer results immediately.
2. Keep hosted rows disabled until the user acknowledges that text will be sent
   to named providers.
3. On text or hosted-model change, cancel the previous hosted request.
4. Wait approximately 500-700 ms after input settles.
5. Check an in-memory cache, then IndexedDB.
6. Send one request containing only enabled hosted providers.
7. Associate it with an `AbortController` and client request ID.
8. Discard a response if a newer input revision is active.
9. Cache successful private results locally under model revision plus exact
   input bytes.
10. Render each provider independently.

### 7.2 Edge API

1. Require HTTPS and allow only the production site origins.
2. Parse the body with a strict maximum before full allocation where possible.
3. Validate schema, Unicode, provider names, model aliases, and text length.
4. Resolve an optional authenticated account and its entitlements.
5. Apply IP, account, provider, and monthly limits.
6. Reject xAI unless the feature flag and entitlement permit it.
7. Deduplicate matching requests that are already in flight at the same edge
   location when practical.
8. Create provider-specific abort signals with short deadlines.
9. Run provider adapters concurrently with `Promise.allSettled` semantics.
10. Normalize and validate successful results.
11. Return partial results immediately after the bounded deadline.
12. Record sanitized operational metrics without text, token bytes, or IDs.

### 7.3 Provider time budgets

Start conservatively:

- 2.5-second deadline per provider.
- 3-second total Worker request budget.
- No automatic retry for interactive requests unless the failure happened
  before an upstream request could plausibly be processed.
- At most one jittered retry for explicitly safe network failures in later
  revisions.

Retries increase latency, quota use, and unknown xAI cost. It is preferable to
show one row as temporarily unavailable while the other results remain useful.

## 8. Provider adapter interface

Each integration should implement one internal contract:

```ts
type ProviderName = "anthropic" | "google" | "xai";

type ProviderRequest = {
  text: string;
  model: string;
  signal: AbortSignal;
};

type ProviderResult = {
  provider: ProviderName;
  requestedModel: string;
  resolvedModel: string | null;
  countSource:
    | "hosted_message_count"
    | "hosted_input_count"
    | "hosted_token_breakdown";
  tokenCount: number;
  supportsBoundaries: boolean;
  tokens: HostedToken[] | null;
};

interface HostedTokenizerAdapter {
  readonly provider: ProviderName;
  countOrTokenize(request: ProviderRequest): Promise<ProviderResult>;
}
```

Adapters own upstream authentication, payload translation, error
classification, and response validation. They do not own user authentication,
site quotas, caching, or UI labels.

### 8.1 Anthropic adapter

Conceptual upstream request:

```http
POST https://api.anthropic.com/v1/messages/count_tokens
x-api-key: [server secret]
anthropic-version: [pinned supported version]
Content-Type: application/json

{
  "model": "[resolved allowlisted model]",
  "messages": [
    { "role": "user", "content": "[text]" }
  ]
}
```

Normalize only the returned integer `input_tokens`. Pin the Anthropic API
version in configuration. If full message counting is added later, use a
separate request schema so users understand that system prompts and tools are
also transmitted.

### 8.2 Gemini adapter

Conceptual upstream request:

```http
POST https://generativelanguage.googleapis.com/v1beta/models/[model]:countTokens
x-goog-api-key: [server secret]
Content-Type: application/json

{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "[text]" }]
    }
  ]
}
```

Normalize only the returned integer `totalTokens`. Keep the API version and
payload behind the adapter because Google's API versions and SDK conventions
can evolve. Do not place API keys in query strings because URLs are more likely
to appear in logs.

### 8.3 xAI adapter

Conceptual upstream request:

```http
POST https://api.x.ai/v1/tokenize-text
Authorization: Bearer [server secret]
Content-Type: application/json

{
  "text": "[text]",
  "model": "[resolved allowlisted model]"
}
```

Normalize each returned item from:

```json
{
  "token_id": 13902,
  "string_token": "Hello",
  "token_bytes": [72, 101, 108, 108, 111]
}
```

Keep `token_bytes` as the source of truth and perform the round-trip validation
described earlier. The adapter must not silently fall back to the old local
Grok-1 tokenizer when a current hosted Grok request fails; those are different
measurements and must remain separate rows.

## 9. Model registry and provenance

Do not let the browser submit arbitrary model identifiers directly upstream.
Maintain a small server-side registry:

```ts
type HostedModelDefinition = {
  publicId: string;
  provider: ProviderName;
  upstreamModel: string;
  capability: "count_only" | "token_breakdown";
  enabled: boolean;
  access: "free" | "premium";
  reviewedAt: string;
};
```

Benefits:

- Prevents use of expensive or unsupported endpoints.
- Lets public aliases stay stable when providers rename models.
- Makes premium entitlements enforceable on the server.
- Provides one auditable place to record model changes.
- Prevents request smuggling through model strings or URLs.

For reproducible scorecards, publish the upstream model ID, measurement time,
API surface, input representation, and response schema version. If an alias
changes its tokenizer, start a new benchmark series rather than overwriting old
results.

## 10. Privacy model

### 10.1 Required interface disclosure

The current dashboard states that input text is not sent to a model API. That
statement remains true only for local rows. Before the first hosted request,
show concise disclosure such as:

> Hosted counts send this text to the selected provider through TokEval.
> Local tokenizer rows remain in your browser. Do not submit secrets or
> sensitive personal information.

Rows should be visibly classified:

- **Local:** runs in the browser; text is not transmitted by TokEval.
- **Hosted count:** text is sent to the named provider; total only.
- **Hosted breakdown:** text is sent to the named provider; token pieces are
  returned.

Consent should be remembered locally, but hosted calls should still be
visually identifiable.

### 10.2 Data minimization

The Worker must not log or store:

- Input text.
- Full request bodies.
- Token strings.
- Token IDs or byte arrays.
- Provider authorization headers.
- Browser authorization tokens.
- Raw upstream error responses.

Store only operational metadata such as:

- Timestamp bucket.
- Provider and model registry ID.
- Success/error class.
- Latency.
- Input byte-length bucket, not text.
- Token-count bucket if analytically necessary.
- Anonymous rate-limit subject hash.
- Account ID for billed usage when authenticated.

Document the providers as subprocessors before offering the service to teams.
Review their data-use and retention terms rather than assuming a count utility
has the same policy as an inference endpoint.

### 10.3 Why not globally cache arbitrary prompts

Global caching sounds attractive but is a poor default here:

- Arbitrary phrases have low cross-user reuse.
- A plain hash of short text can be reversed with dictionary guessing.
- xAI breakdowns contain bytes that reconstruct the input.
- Persistent prompt storage creates privacy, deletion, breach, and policy
  obligations.

Use client-side caching for private interactive text. Use shared caching only
for public examples, public benchmark corpora, or opt-in saved analyses with a
defined retention policy.

If a short-lived server count cache becomes necessary, use an HMAC of provider,
model revision, and exact input bytes with a rotating server secret; store only
count-only results; apply a brief TTL; and never use it for token breakdowns.
This reduces casual disclosure but does not eliminate the policy implications
of caching user-derived data.

## 11. Browser caching

Use two levels:

1. An in-memory least-recently-used cache for the current session.
2. IndexedDB for successful user-device results.

Cache key components:

```text
schema version
+ provider
+ exact upstream model/revision
+ operation kind
+ exact UTF-8 input bytes
```

Store a creation time and provider review version. Invalidate entries when the
model mapping or normalization schema changes. Provide a "Clear local data"
control once persistent caching ships.

Do not use a service-worker cache or CDN cache for private POST bodies.

## 12. Authentication and entitlements

### 12.1 Launch without accounts

Anthropic and Gemini can initially be anonymous but tightly rate-limited:

- Origin-validated requests only.
- Small per-IP burst bucket.
- Conservative daily allowance.
- Input-size limit.
- Automated behavior challenge only when risk signals justify it.

xAI stays disabled behind a server feature flag during billing verification.

### 12.2 Premium phase

When Grok access launches:

- Require an authenticated account for xAI.
- Store user ID, subscription state, entitlement version, and aggregate usage
  counters in D1.
- Use Stripe Checkout, subscriptions, Customer Portal, and signed webhooks.
- Verify webhook signatures before changing entitlements.
- Make subscription writes idempotent by Stripe event ID.
- Do not trust client-provided plan or quota values.

An initial premium allowance of roughly 1,000-2,000 settled xAI comparisons per
member per month is reasonable only as a controlled starting hypothesis. Adjust
it after measured provider billing and real request sizes.

### 12.3 Suggested D1 tables

```text
users
  id, auth_subject, created_at, status

subscriptions
  user_id, provider_customer_id, provider_subscription_id,
  plan_id, status, period_end, updated_at

monthly_usage
  user_id, period, provider, settled_requests, input_bytes,
  updated_at

processed_webhooks
  event_id, processed_at

model_registry
  public_id, provider, upstream_model, capability, access,
  enabled, reviewed_at
```

No table contains prompt text or token pieces.

## 13. Rate limiting and abuse prevention

Apply several independent limits because one limit cannot address every abuse
case:

1. **Request body limit:** 16 KiB initial maximum.
2. **Provider count:** at most three provider operations per request.
3. **IP burst limit:** protects anonymous access and Worker load.
4. **IP sustained limit:** slows distributed scripted use from one network.
5. **Account limit:** enforces premium fairness.
6. **Provider concurrency limit:** protects upstream quotas.
7. **Monthly xAI allowance:** bounds unknown provider cost.
8. **Global circuit breaker:** immediately disables a provider.
9. **Hard spending alert/ceiling:** provider-account safety net where supported.

Fail closed for premium entitlements and provider cost controls. Fail open for
non-sensitive analytics so a telemetry outage does not break the dashboard.

Use Turnstile or an equivalent challenge only after automated behavior is
detected. Requiring a challenge for every keystroke-driven comparison would
damage the product experience.

## 14. Reliability and failure isolation

### 14.1 Per-provider isolation

Every provider has its own:

- Timeout.
- Circuit-breaker state.
- Concurrency budget.
- Error-rate metric.
- Model allowlist.
- Feature flag.

One provider's outage must not suppress the others.

### 14.2 Error classification

Normalize upstream failures into a small stable set:

```text
UPSTREAM_TIMEOUT
UPSTREAM_RATE_LIMITED
UPSTREAM_AUTH_FAILED
UPSTREAM_MODEL_UNAVAILABLE
UPSTREAM_INVALID_RESPONSE
FEATURE_DISABLED
QUOTA_EXCEEDED
UNKNOWN_UPSTREAM_ERROR
```

Only `UPSTREAM_TIMEOUT`, `UPSTREAM_RATE_LIMITED`, and selected transient
upstream errors should be marked retryable. The browser should not retry in a
tight loop.

### 14.3 Circuit breaker

Open a provider circuit when either:

- Authentication or account state fails.
- A rolling error-rate threshold is crossed.
- xAI spend or usage reaches the configured ceiling.
- An operator disables the integration.

Return a stable unavailable result while open. Test a small number of probe
requests before closing automatically, or require an operator for billing and
authentication failures.

## 15. Security controls

- Store provider keys as Worker secrets, never source variables or public Astro
  environment values.
- Give each provider key the minimum available permissions.
- Use separate development and production credentials.
- Rotate credentials and document the response process.
- Enforce an exact production-origin allowlist, while recognizing that CORS is
  not authentication.
- Set a strict JSON content type and reject compressed-body bombs or oversized
  decoded payloads.
- Use constant server-owned upstream origins and paths.
- Escape all provider-returned strings in the UI.
- Never render upstream HTML.
- Redact headers and bodies in exceptions.
- Disable default request-body collection in monitoring products.
- Pin dependencies and run automated vulnerability checks.
- Protect administrative flags behind separate authenticated tooling.
- Verify Stripe webhook signatures on the raw request body.
- Avoid exposing exact remaining global provider capacity to anonymous users.

Cloudflare secrets should be provisioned with Wrangler or the platform secret
store, not committed to `.env` or configuration files.

## 16. Observability without prompt collection

Record metrics, not content:

- Requests and provider operations by status.
- p50, p95, and p99 end-to-end and provider latency.
- Upstream timeout and `429` rates.
- Input byte-size histogram.
- Token-count histogram where necessary.
- Cache hits measured in the browser through aggregate events.
- Rate-limit rejections.
- Authenticated xAI usage by account and billing period.
- Estimated and reconciled provider cost.
- Circuit-breaker state changes.

Use a trace ID generated by the Worker and return it to the browser for support.
Do not reuse input hashes as trace IDs. Sample successful traces, retain errors
briefly, and keep logs free of request bodies.

Alerts should cover:

- Provider authentication failures.
- A sustained upstream failure-rate spike.
- Unexpected xAI request or spend growth.
- D1 or Worker errors.
- Quota utilization thresholds.
- Stripe webhook failures.

## 17. Cost model

### 17.1 Workload assumptions from the earlier estimate

The directional hosting comparison assumed:

- One backend invocation per settled comparison.
- Provider requests execute in parallel.
- Approximately 500 ms of elapsed provider wait.
- Approximately 3 ms of active CPU.
- Approximately 5 KiB returned.
- Static Astro traffic and provider charges excluded.

### 17.2 Platform comparison

These values are planning estimates from the earlier review, not quotes or
guarantees:

| Architecture | Approx. 1M comparisons/month | Approx. 10M comparisons/month | Main tradeoff |
| --- | ---: | ---: | --- |
| Cloudflare Workers + D1 | ~$5 | ~$5 | Lowest predictable floor; CPU-time billing suits outbound waits |
| AWS Lambda Function URL | ~$0 | ~$6 | Very cheap at low volume; more app-level controls required |
| AWS Lambda + API Gateway HTTP API | ~$1 | ~$16 | Mature API controls with added request cost |
| Google Cloud Run | ~$0 | ~$10-$14 | Container flexibility and concurrency |
| Vercel Pro Functions | $20 | ~$20 | Smooth deployment with a higher platform floor |
| Netlify Functions | ~$9 | ~$30-$40 | Simple, but less favorable for this request profile |

Cloudflare Workers Paid currently lists a $5 monthly minimum, 10 million
included requests, and CPU-time billing that does not charge for time waiting
on network I/O. That matches a lightweight proxy whose dominant latency is
waiting for provider APIs.

At much larger scale, the earlier model estimated about $37 per month for 100
million Worker requests at roughly 3 ms CPU each, before provider fees. Actual
CPU, analytics, rate-limiter, authentication, and database behavior must be
load-tested.

### 17.3 Provider cost

- Anthropic documents token counting as free, subject to rate limits.
- Gemini exposes count operations, but current billing and applicable quota
  should be verified for the exact API surface and project before launch.
- xAI tokenizer-endpoint pricing remains the key uncertainty.

The earlier conservative xAI sensitivity model assumed, without asserting,
that tokenizer calls might be billed at a $2-per-million-input-token inference
rate and that a settled comparison averages 50 input tokens:

| Settled xAI comparisons/month | Hypothetical provider cost |
| ---: | ---: |
| 100,000 | $10 |
| 1 million | $100 |
| 10 million | $1,000 |

At 2,000 comparisons per member under those assumptions, the hypothetical xAI
cost is about $0.20 per member. This is only a sensitivity calculation. Do not
use it as a public price claim or offer uncapped access until billing is
measured.

## 18. Why Cloudflare Workers is the recommended starting point

1. The dashboard remains a fast static Astro deployment.
2. Provider secrets stay at the edge rather than in browser bundles.
3. Outbound wait time is a good fit for CPU-time-based billing.
4. The $5 paid floor is predictable and includes substantial request capacity.
5. D1 is sufficient for early memberships, entitlements, and usage counters.
6. The Worker can return geographically close responses without operating
   regional application servers.
7. Provider adapters are simple `fetch` requests and do not require a heavy
   Node or Python runtime.
8. A narrow Worker can later coexist with a separate batch benchmark service.

Do not move the whole site to server-side rendering. That would expand the
dynamic failure surface and weaken a key performance and SEO advantage without
helping hosted token counts.

## 19. When another platform is preferable

### AWS Lambda

Choose Lambda if the project already standardizes on AWS, needs native AWS IAM
or private networking, or expects to use API Gateway/WAF/Cognito extensively.
Remember that Lambda bills elapsed invocation duration while awaiting provider
responses. Function URLs reduce cost but shift authentication and abuse
controls into the application.

### Google Cloud Run

Choose Cloud Run if hosted counting becomes part of a containerized Python
service, requires libraries unavailable in an edge runtime, or benefits from
high per-instance request concurrency. It is also natural if the rest of the
product and authentication are already on Google Cloud.

### Vercel

Choose Vercel when deployment convenience and integrated frontend workflow are
more valuable than the higher minimum spend. It remains technically suitable,
but the static Astro site does not require its dynamic platform.

### Dedicated service

Introduce a conventional service only when the workload requires long-running
batch jobs, larger dependencies, private-corpus processing, durable queues, or
real model inference. Those jobs should remain separate from the latency-
sensitive interactive counting path.

## 20. Implementation phases

### Phase 0 — Verify assumptions

1. Create isolated Anthropic, Google, and xAI development projects.
2. Confirm endpoint payloads with small non-sensitive fixtures.
3. Record actual response headers, IDs, error shapes, and latency.
4. Verify current provider data-use and retention terms.
5. Run controlled xAI billing tests and reconcile against its console.
6. Record exact per-project quotas rather than assuming documentation defaults.
7. Select stable model IDs and define the initial registry.

Exit criterion: provider capability and cost notes are dated, reproducible, and
reviewed; xAI remains disabled if its billing is still ambiguous.

### Phase 1 — Server skeleton

1. Create the separate Worker package.
2. Define strict request/response schemas and normalized errors.
3. Configure secrets for non-production provider accounts.
4. Add origin, body-size, provider, and model validation.
5. Implement timeouts and partial-result orchestration.
6. Add sanitized metrics.

Exit criterion: fixture adapters can simulate success, timeout, rate limit,
invalid bytes, and partial failure.

### Phase 2 — Free count-only providers

1. Implement Anthropic and Gemini adapters.
2. Add the hosted-data disclosure and explicit enable action.
3. Add debounce, cancellation, stale-response protection, and browser caching.
4. Render totals with breakdown-unavailable states.
5. Add anonymous limits and provider circuit breakers.

Exit criterion: local results never wait on hosted calls, and both hosted rows
degrade independently under injected failures.

### Phase 3 — xAI private beta

1. Implement byte-safe xAI normalization and round-trip checks.
2. Keep the integration behind an environment feature flag.
3. Require authenticated allowlisted beta users.
4. Enforce small per-user and global caps.
5. Compare internal counters with xAI billing and usage dashboards.

Exit criterion: actual per-request economics and tokenizer behavior are known
well enough to define a sustainable allowance.

### Phase 4 — Premium Grok access

1. Add subscriptions and signed webhook processing.
2. Add D1 entitlements and monthly usage counters.
3. Launch a bounded allowance, not unlimited access.
4. Add customer-visible usage and clear over-limit behavior.
5. Keep a kill switch and provider spending ceiling.

Exit criterion: a compromised client or unexpected traffic spike cannot create
unbounded provider spend.

### Phase 5 — Public API, only after demand

1. Add scoped customer API keys.
2. Separate dashboard and API quotas.
3. Add versioned contracts and formal deprecation policy.
4. Price for provider cost, support, and abuse risk.
5. Publish service limits and status information.

This phase should follow demonstrated demand. The interactive dashboard does
not need to become a general proxy prematurely.

## 21. Testing plan

### Unit tests

- Strict request validation and byte limits.
- Model registry resolution and disabled models.
- Provider payload construction.
- Upstream error normalization.
- Count-only response validation.
- xAI token-byte range, concatenation, and UTF-8 round trips.
- Entitlement and quota decisions.
- No sensitive fields in structured logs.

### Contract tests

Run against recorded, sanitized response fixtures in normal CI. Periodically
run opt-in tests against real provider development accounts to detect API drift.
Do not commit credentials or private response content.

Test at least:

- Korean, English, and Turkish.
- Empty and maximum-size inputs.
- Unicode normalization variants.
- Emoji and variation selectors.
- Combining characters.
- Unusual spacing and newlines.
- Mixed scripts.
- Tokens that split a UTF-8 code point.
- Provider `400`, `401`, `403`, `404`, `429`, and `5xx` responses.
- Timeout and aborted client request.
- One success plus two failures.
- Reordered or malformed xAI token bytes.

### Load and abuse tests

- Settled-input traffic at expected p50 and p95 sizes.
- Bursts from one IP and many IPs.
- Slow upstream providers.
- Provider quota exhaustion.
- Circuit-breaker activation and recovery.
- D1 contention on monthly usage updates.
- Stripe webhook replay.
- Spend-cap enforcement.

## 22. Launch checklist

- [ ] Provider terms and data handling reviewed.
- [ ] Model IDs and capability labels verified.
- [ ] Anthropic message framing is disclosed.
- [ ] Gemini API surface and project quota verified.
- [ ] xAI billing tested or xAI remains disabled.
- [ ] Production secrets exist only in the platform secret store.
- [ ] Input and response sizes are bounded.
- [ ] Local rows function with the hosted API offline.
- [ ] Hosted requests require an explicit user action.
- [ ] No request bodies appear in logs or error reporting.
- [ ] Partial failures render correctly.
- [ ] Browser cancellation prevents stale results.
- [ ] Byte round-trip tests pass for xAI.
- [ ] Rate limits, circuit breakers, and feature flags are exercised.
- [ ] Infrastructure and provider spending alerts are active.
- [ ] Public privacy language reflects every provider actually enabled.
- [ ] Status and support paths are documented.

## 23. Effort and initial operating estimate

The earlier estimate for a production-ready first pass was approximately 15-25
engineering hours, or 2-4 focused working days, covering:

- Worker and secret setup.
- Three provider adapters.
- UI consent, loading, partial-error, and unavailable states.
- Debouncing, cancellation, and browser caching.
- Input, rate, and usage limits.
- Privacy copy.
- Focused tests and deployment validation.

That estimate assumes an existing authentication choice is not required for the
first Anthropic/Gemini release and excludes the broader scorecard, eval library,
private-corpus product, and full routing layer. Premium accounts, Stripe,
customer usage views, and robust global counters add a separate implementation
phase.

An initial operating budget of roughly $5-$25 per month is a reasonable
planning range before xAI usage, payment processing, authentication service,
monitoring upgrades, and domain costs. It is not a guaranteed invoice.

## 24. Architectural decisions summarized

| Decision | Recommendation | Reason |
| --- | --- | --- |
| Site rendering | Keep Astro static | SEO, speed, reliability |
| Local tokenizers | Browser Web Worker | No secrets or server cost |
| Secret API calls | Separate Cloudflare Worker | Small secure edge boundary |
| Browser request shape | One fan-out endpoint | One debounce/cancel/limit boundary |
| Provider execution | Parallel, partial results | Low latency and failure isolation |
| Anthropic/Gemini display | Count only | Providers do not return breakdowns |
| Grok display | IDs, strings, exact bytes | xAI endpoint exposes a real breakdown |
| Arbitrary prompt storage | None by default | Privacy and low cache reuse |
| Private cache | Browser memory + IndexedDB | Fast repeat results without server retention |
| Shared cache | Public examples/benchmarks only | Safe, reusable, CDN-friendly data |
| Accounts | Defer for free count-only launch | Lower initial complexity |
| xAI access | Feature flag, then bounded premium | Unknown endpoint cost |
| Database | D1 for identity/entitlements/usage | Lightweight early product state |
| Billing | Stripe when premium launches | Mature subscription workflow |
| Full inference gateway | Defer | Larger liability and not needed for scorecard |

## 25. Final recommendation

Build the smallest possible server boundary and keep it optional:

1. Preserve all local tokenizer work in the browser.
2. Add Anthropic and Gemini as explicit hosted, count-only rows.
3. Add recent Grok only through xAI's real tokenizer endpoint, never an
   invented approximation presented as current.
4. Require clear consent before any text crosses the browser boundary.
5. Fan out from one Worker request and return partial results.
6. Store no arbitrary prompts or breakdowns server-side.
7. Use browser caching for private inputs and CDN caching for public benchmark
   fixtures.
8. Cap, instrument, and feature-flag xAI until billing is proven.
9. Monetize bounded Grok access, saved/private analyses, higher limits, and
   team workflows rather than charging merely to view a token count.
10. Keep the interactive count service separate from future batch evaluation,
    private-corpus processing, and model routing infrastructure.

This architecture can support high dashboard traffic at low infrastructure
cost because most work remains local and static. Its main financial risk is not
the edge function; it is an uncapped proprietary-provider integration. The
recommended design puts that risk behind server-owned policy, quotas, feature
flags, and observed billing before broad release.

## 26. Official references

Provider APIs:

- Anthropic token counting:
  <https://platform.claude.com/docs/en/build-with-claude/token-counting>
- Gemini token counting guide:
  <https://ai.google.dev/gemini-api/docs/tokens>
- Gemini REST token reference:
  <https://ai.google.dev/api/tokens>
- Gemini rate limits:
  <https://ai.google.dev/gemini-api/docs/rate-limits>
- Gemini billing:
  <https://ai.google.dev/gemini-api/docs/billing>
- xAI tokenize-text endpoint:
  <https://docs.x.ai/developers/rest-api-reference/inference/other>
- xAI pricing:
  <https://docs.x.ai/developers/pricing>

Cloudflare:

- Workers pricing:
  <https://developers.cloudflare.com/workers/platform/pricing/>
- D1 pricing:
  <https://developers.cloudflare.com/d1/platform/pricing/>
- Worker secrets:
  <https://developers.cloudflare.com/workers/configuration/secrets/>
- Turnstile plans:
  <https://developers.cloudflare.com/turnstile/plans/>

Alternatives and payments:

- AWS Lambda pricing: <https://aws.amazon.com/lambda/pricing/>
- Lambda Function URLs:
  <https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html>
- AWS API Gateway pricing: <https://aws.amazon.com/api-gateway/pricing/>
- Google Cloud Run pricing: <https://cloud.google.com/run/pricing>
- Firebase pricing: <https://firebase.google.com/pricing>
- Vercel function pricing:
  <https://vercel.com/docs/functions/usage-and-pricing>
- Netlify pricing: <https://www.netlify.com/pricing/>
- Stripe pricing: <https://stripe.com/pricing>
