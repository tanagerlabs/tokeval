# Contributing to TokEval

TokEval is an early-stage research and engineering project. Read
[`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) before changing scope, terminology,
or methodology, and keep planned work distinct from completed or measured
results.

## Development principles

- Keep token count, model quality, latency, energy, and monetary cost as
  separate measurements.
- Preserve raw bytes and byte spans. A token can split a UTF-8 code point, so
  an individual token is not guaranteed to decode to valid text.
- Pin tokenizer artifacts and model revisions. A model name alone is not a
  reproducible tokenizer definition.
- Never invent token IDs or boundaries for a provider that exposes only a
  count. Label exact local results, exact provider results, and estimates
  accurately.
- Keep credentials, prompts, machine details, downloaded artifacts, and local
  Worker state out of Git.
- Make focused, typed changes and add tests for Unicode, normalization,
  unusual spacing, emoji, mixed scripts, and failure behavior where relevant.

## Dashboard setup

The Explorer lives in `dashboard/`. It is an Astro site with a React island
for the interactive comparison and an optional Cloudflare Worker for hosted
provider calls.

```bash
cd dashboard
npm install
npm --prefix server install
npm test
npm run build
npm run server:test
npm run server:build
```

Copy `dashboard/.env.example` and `dashboard/server/.dev.vars.example` only
when hosted-provider development is needed. Never commit the resulting secret
files.

## Model catalog overview

`dashboard/catalog/models.json` is the source of truth for the model picker.
Its version 2 schema separates three concepts:

- `providers`: display names and compact fallback marks.
- `tokenizers`: one integration per distinct local tokenizer implementation
  or artifact.
- `models`: user-facing model identities. A local model points to a
  `tokenizerId`; a hosted model declares its provider API contract.

This separation is intentional. Several model releases can share one verified
tokenizer without downloading or running that tokenizer more than once.

### Add a model that shares an existing local tokenizer

1. Verify from a primary source or the published model files that the model
   uses exactly the same tokenizer, including normalization, pre-tokenization,
   vocabulary, merges, special tokens, and relevant configuration. Similar
   vocabulary size or family branding is not enough.
2. Add a `kind: "local"` entry to `models` with a stable public `id`, an
   existing `provider`, a human-readable `name`, and the verified
   `tokenizerId`.
3. Add or update catalog tests if the entry introduces a new mapping case.
4. Run the dashboard checks listed below and manually compare representative
   ASCII, multilingual, emoji, whitespace, and normalization inputs.

Example:

```json
{
  "id": "example-model",
  "kind": "local",
  "provider": "example",
  "name": "Example Model",
  "tokenizerId": "example-tokenizer"
}
```

### Add a new local tokenizer integration

1. Add the provider to `providers` if it does not exist.
2. Add one entry to `tokenizers`. Use `kind: "open"` for a public pinned
   artifact, and record:
   - a stable tokenizer `id`, provider, display label, and encoding name;
   - the upstream repository and full 40-character commit revision;
   - a source URL that resolves to that revision;
   - the decoder type supported by `OpenModelDecoder`;
   - whether exact raw-input byte boundaries are available;
   - the artifact URL, byte size, and SHA-256 digest when a standalone artifact
     is downloaded directly;
   - a clear `boundaryLimitation` when normalization or another transform
     prevents exact raw-input spans.
3. Add the canonical model plus any verified aliases to `models`, all pointing
   to the tokenizer entry.
4. Extend the appropriate implementation under `dashboard/src/lib/`. Keep
   provider-specific loading behind the existing open-tokenizer client and
   Worker interfaces rather than branching in the comparison component.
5. Confirm the tokenizer license permits the intended download and use. Do not
   copy model weights or restricted artifacts into the repository.
6. Add focused unit tests and, when a network download is required, an opt-in
   integration test with pinned expected values.

The implementation must return lossless token bytes when it claims boundary
support. If the tokenizer normalizes input, report the exact count but do not
map normalized pieces onto fabricated raw-text spans.

### Add a hosted model to an existing provider adapter

Use a hosted entry only when TokEval must call a provider service to obtain the
count or breakdown.

1. Confirm the exact upstream model ID and token-count endpoint in the
   provider's current official documentation.
2. Add a `kind: "hosted"` model to `dashboard/catalog/models.json`. Set
   `capability`, `countSource`, and `supportsBoundaries` to what the endpoint
   actually returns.
3. Keep the public catalog ID independent of the upstream model ID. Use an
   `environmentOverride` only for one of the supported deployment aliases.
4. Verify that `dashboard/server/src/models.ts` derives the correct capability,
   cache policy, feature flag, and resolved upstream model.
5. Add provider contract fixtures and Worker tests for success, authentication
   failure, rate limiting, timeout, malformed responses, and partial-provider
   failure.
6. Update `.dev.vars.example`, Worker documentation, and deployment variables
   if a new non-secret setting is required. Secrets belong in Wrangler secret
   storage or the ignored local `.dev.vars` file.

Hosted count-only results must not imply that their structured request count
is raw-content tokenization. If an estimate is shown, document and test the
wrapper-differential method and continue to omit unavailable IDs and spans.

### Add a new hosted provider

A new provider requires more than a catalog row:

1. Add the provider identity to the catalog and the Worker `ProviderName`
   union.
2. Implement a small adapter in `dashboard/server/src/providers/` and route it
   through `providers/index.ts`.
3. Normalize the response into `ProviderSuccess` / `ProviderFailure`. Do not
   leak provider response shapes into the browser.
4. Add typed environment bindings, credential validation, bounded timeouts,
   safe error mapping, rate limits, and an explicit cache policy. Cache keys
   must not expose input text.
5. Keep request logs metadata-only: provider, model, status, byte length,
   latency, cache state, and safe request IDs. Never log prompt text,
   credentials, token pieces, or raw provider bodies.
6. Add the browser profile mapping and provider logo/fallback mark. Logos must
   have a clear license and attribution trail; see
   `dashboard/public/logos/README.md`.
7. Test the adapter, Worker endpoint, model registry, browser normalization,
   independent provider caching, and graceful failure when credentials or the
   service are unavailable.
8. Document official API references and any billing implications.

## Required verification

From `dashboard/`, run:

```bash
npm test
npm run build
npm run server:test
npm run server:build
```

Network-backed tokenizer tests remain opt-in so normal test runs are
reproducible and do not unexpectedly download artifacts. When changing a
downloaded tokenizer, run the relevant integration test explicitly and record
the pinned revision and digest in the pull request.

For a catalog or tokenizer change, also verify:

- empty input and repeated identical input;
- English, Korean, and at least one mixed-script example;
- combining characters or normalization-sensitive text;
- emoji and unusual whitespace;
- exact byte round trips wherever boundaries are supported;
- adding, removing, collapsing, and reordering visible dashboard entries;
- that only visible entries recalculate after the text changes;
- that a failing hosted provider does not prevent other results from loading.

## Pull request notes

Explain the user-visible behavior, source and revision used, whether the result
is local, hosted count-only, estimated, or real hosted tokenization, and how it
was tested. Link primary upstream documentation. Do not report efficiency or
cost improvements unless the repository contains reproducible measurements
that support the claim.
