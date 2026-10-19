# TokEval hosted tokenizer Worker

This package is the optional server boundary for token data that cannot be
generated from public local tokenizer artifacts.

Implemented provider operations:

- Anthropic structured-message input count (`count_tokens`), count only.
- Gemini input count (`countTokens`), count only.
- xAI/Grok hosted tokenization (`tokenize-text`), including IDs and exact bytes.

The Worker does not proxy inference, store prompt text, or implement users,
subscriptions, or premium entitlements. xAI is enabled in the current
configuration; keep its stricter rate limit in place and review provider
billing before using it beyond controlled tests.

## Request API

```http
POST /api/v1/tokenize/compare
Content-Type: application/json

{
  "text": "안녕하세요",
  "providers": [
    { "provider": "anthropic", "model": "anthropic-default" },
    { "provider": "google", "model": "gemini-default" },
    { "provider": "xai", "model": "grok-default" }
  ],
  "request_id": "optional-client-request-id"
}
```

`GET /api/v1/models` exposes the configured public model registry. `GET
/health` is a shallow process health check.

Provider failures are returned independently inside a successful comparison
response. No provider fabricates token IDs or boundaries when the upstream API
only returns a count.

## Cost and privacy controls

- Input is limited to 16 KiB of UTF-8.
- One request can select each of the three providers at most once.
- Provider calls run concurrently with a bounded timeout.
- Cloudflare's rate-limit binding caps anonymous comparison traffic.
- A stricter independent rate bucket protects xAI.
- Concurrent identical calls are coalesced within an isolate.
- Anthropic and Gemini count-only successes can use a short-lived Cache API
  entry keyed by an HMAC. The cache key never contains raw text.
- xAI token breakdowns are not persistently shared-cached because their bytes
  reconstruct the input.
- Logs include provider/status, byte-length, latency, and cache status, but not
  input text, token values, credentials, or upstream response bodies.

The count cache is enabled only when `CACHE_HMAC_SECRET` exists and
`COUNT_CACHE_TTL_SECONDS` is greater than zero. It is a cost/latency control,
not a durable database. Cache API entries are location-dependent.

The anonymous rate key uses the connecting IP because this iteration has no
user identity. It is intentionally coarse and local to a Cloudflare location;
later authenticated tiers should use stable account IDs for their primary
quota while retaining separate abuse controls.

## Local setup

Use Node.js 22 or newer.

From `dashboard/`, prepare both environment files once:

```bash
npm install
npm --prefix server install
cp server/.dev.vars.example server/.dev.vars
cp .env.example .env
```

Add development-only `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `XAI_API_KEY`
values to `server/.dev.vars`. If an Anthropic key can access more than one
workspace, also set `ANTHROPIC_WORKSPACE_ID` to the `wrkspc_` value selected in
the Claude Console. `ENABLE_XAI=true` enables the hosted tokenizer endpoint;
verify its billing behavior for the account before using non-test traffic.
Provider secrets are read only by the local Worker. In development, the
browser calls Astro's same-origin `/api` path and Astro proxies it to Wrangler.
`PUBLIC_HOSTED_TOKENIZER_API_URL` is only needed when a production build should
call a separately hosted Worker.

`LOG_PROVIDER_IO=true` prints structured request, upstream HTTP response, and
normalized response events in the `server:dev` terminal. Logs include model
IDs, HTTP status, latency, input byte length, token count, and error codes. They
never include provider credentials, input text, token IDs, token strings, or
token bytes.

Then run the Worker and dashboard in separate terminals:

```bash
# Terminal 1, from dashboard/
npm run server:dev
```

```bash
# Terminal 2, from dashboard/
npm run dev
```

Wrangler listens on `http://localhost:8787`. Astro listens on
`http://localhost:4321` and proxies `/api` requests to Wrangler. This also
means remote development needs to forward only Astro's port 4321; the browser
must not try to reach port 8787 on the client machine.
Enable **Hosted counts** in the dashboard before text is sent to Anthropic or
Gemini. The Worker can also be checked independently from `dashboard/`:

```bash
npm run server:check
npm run server:test
```

Do not commit `.dev.vars`. Local development should use isolated provider keys
and non-sensitive test text.

## Production secrets

Set secrets with Wrangler; never put them in `wrangler.jsonc` or Terraform
variables:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ANTHROPIC_WORKSPACE_ID
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put XAI_API_KEY
npx wrangler secret put CACHE_HMAC_SECRET
```

Generate the cache secret from at least 32 random bytes. Configure the real
dashboard origin, validate each model ID before deployment, and set
`ENABLE_XAI` according to the deployment's billing policy:

```json
{
  "vars": {
    "ALLOWED_ORIGINS": "https://example.com",
    "ENABLE_XAI": "true"
  }
}
```

## Deploy

Wrangler is the source of truth for code, runtime variables, limits, bindings,
and versions:

```bash
npm run build
npm run deploy
```

The dry-run build is safe and creates `dist/`; deployment requires an
authenticated Cloudflare account and intentionally is not run by tests.

The Terraform module under `infra/terraform/` provisions the logical Worker
container, subdomain policy, tags, and observability settings. This follows
Cloudflare's recommended hybrid pattern: Terraform owns stable infrastructure,
while Wrangler bundles and deploys immutable code versions and manages secrets.
See its README for ordering.

## Adding models over time

Public IDs deliberately differ from upstream model IDs. Updating
`ANTHROPIC_MODEL`, `GEMINI_MODEL`, or `XAI_MODEL` can move a convenience row to
a newly validated upstream model without changing request code. For multiple
models per provider, set `ADDITIONAL_MODELS_JSON`; provider adapters do not
need changes while their upstream contract remains stable:

```json
[
  {
    "id": "anthropic-next",
    "provider": "anthropic",
    "upstream_model": "provider-model-id",
    "enabled": true
  }
]
```

Capabilities and cache policy are derived from the provider adapter rather than
trusted from configuration. The global xAI feature flag still overrides every
configured xAI entry.

A future scheduled catalog job can poll:

- Anthropic `GET /v1/models`.
- Gemini `GET /v1beta/models`.
- xAI `GET /v1/models` or `/v1/language-models`.

Discovered entries should enter a candidate state, run contract probes, and
require approval before publication. Discovery is not proof that a model uses
the same tokenizer endpoint, has safe pricing, or has a redistributable local
artifact.

## Official API references

- <https://platform.claude.com/docs/en/build-with-claude/token-counting>
- <https://platform.claude.com/docs/en/api/models/list>
- <https://ai.google.dev/api/tokens>
- <https://ai.google.dev/api/models>
- <https://docs.x.ai/developers/rest-api-reference/inference/other>
- <https://docs.x.ai/developers/rest-api-reference/inference/models>
- <https://developers.cloudflare.com/workers/wrangler/configuration/>
- <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
- <https://developers.cloudflare.com/workers/platform/infrastructure-as-code/>
