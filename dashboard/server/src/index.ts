import { cachedCountOnlyRequest, coalesceUncachedRequest } from "./cache";
import { ProviderError, normalizeProviderError } from "./errors";
import { buildModelRegistry } from "./models";
import { callProvider } from "./providers";
import {
  readJsonBody,
  parseCompareRequest,
  RequestValidationError,
} from "./schema";
import type {
  CompareRequest,
  Env,
  ModelDefinition,
  ProviderFailure,
  ProviderResult,
  ProviderSelection,
  RequestContext,
} from "./types";

const API_PATH = "/api/v1/tokenize/compare";
const MODELS_PATH = "/api/v1/models";

function configuredOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const configured = configuredOrigins(env);
  return configured.has("*") || configured.has(origin) ? origin : null;
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(corsHeaders(origin));
  headers.set("Cache-Control", "no-store");
  for (const [name, value] of new Headers(extraHeaders)) headers.set(name, value);
  return Response.json(body, { status, headers });
}

function failureFor(model: ModelDefinition, error: ProviderError): ProviderFailure {
  return {
    provider: model.provider,
    requested_model: model.publicId,
    resolved_model: model.upstreamModel,
    status: "unavailable",
    count_source: model.countSource,
    token_count: null,
    supports_boundaries: model.capability === "token_breakdown",
    token_ids: null,
    tokens: null,
    cache: "disabled",
    provider_request_id: null,
    error: {
      code: error.code,
      retryable: error.retryable,
    },
  };
}

function rateLimitKey(request: Request, scope: string): string {
  const actor = request.headers.get("cf-connecting-ip") ?? "unknown";
  return `${scope}:${actor}`;
}

async function invokeProvider(
  request: Request,
  env: Env,
  context: RequestContext,
  model: ModelDefinition,
  text: string,
): Promise<ProviderResult> {
  if (!model.enabled) {
    return failureFor(model, new ProviderError("FEATURE_DISABLED", false));
  }

  if (model.provider === "xai" && env.XAI_RATE_LIMITER) {
    const rate = await env.XAI_RATE_LIMITER.limit({
      key: rateLimitKey(request, "xai"),
    });
    if (!rate.success) {
      return failureFor(model, new ProviderError("QUOTA_EXCEEDED", true));
    }
  }

  try {
    const load = () => callProvider(env, model, text);
    if (model.cacheable) {
      return await cachedCountOnlyRequest(
        env,
        context,
        model.provider,
        model.upstreamModel,
        text,
        load,
      );
    }
    return await coalesceUncachedRequest(
      model.provider,
      model.upstreamModel,
      text,
      load,
    );
  } catch (error) {
    return failureFor(model, normalizeProviderError(error));
  }
}

function resolveModels(
  request: CompareRequest,
  env: Env,
): Array<[ProviderSelection, ModelDefinition]> {
  const registry = buildModelRegistry(env);
  return request.providers.map((selection) => {
    const model = registry.get(selection.model);
    if (!model || model.provider !== selection.provider) {
      throw new RequestValidationError(400, "UNSUPPORTED_MODEL");
    }
    return [selection, model];
  });
}

async function handleCompare(
  request: Request,
  env: Env,
  context: RequestContext,
  origin: string | null,
): Promise<Response> {
  if (env.REQUEST_RATE_LIMITER) {
    const rate = await env.REQUEST_RATE_LIMITER.limit({
      key: rateLimitKey(request, "compare"),
    });
    if (!rate.success) {
      return json(
        { error: { code: "RATE_LIMITED", retryable: true } },
        429,
        origin,
        { "Retry-After": "60" },
      );
    }
  }

  const parsed = parseCompareRequest(await readJsonBody(request));
  const models = resolveModels(parsed, env);
  const startedAt = Date.now();
  const inputBytes = new TextEncoder().encode(parsed.text).byteLength;
  const traceId = crypto.randomUUID();
  const logProviderIo = env.LOG_PROVIDER_IO?.trim().toLowerCase() === "true";

  if (logProviderIo) {
    console.info(
      JSON.stringify({
        event: "hosted_tokenize_request",
        request_id: parsed.request_id,
        trace_id: traceId,
        providers: models.map(([, model]) => ({
          provider: model.provider,
          requested_model: model.publicId,
          resolved_model: model.upstreamModel,
          enabled: model.enabled,
        })),
        input_bytes: inputBytes,
      }),
    );
  }

  const results = await Promise.all(
    models.map(([, model]) => invokeProvider(request, env, context, model, parsed.text)),
  );

  console.info(
    JSON.stringify({
      event: "hosted_tokenize_response",
      request_id: parsed.request_id,
      trace_id: traceId,
      results: results.map((result) => ({
        provider: result.provider,
        requested_model: result.requested_model,
        resolved_model: result.resolved_model,
        status: result.status,
        token_count: result.token_count,
        supports_boundaries: result.supports_boundaries,
        error: result.status === "unavailable" ? result.error.code : null,
        cache: result.cache,
        provider_request_id: result.provider_request_id,
      })),
      input_bytes: inputBytes,
      duration_ms: Date.now() - startedAt,
    }),
  );

  return json(
    {
      request_id: parsed.request_id,
      results,
      meta: {
        schema_version: "1",
        generated_at: new Date().toISOString(),
        retained_input: false,
        trace_id: traceId,
      },
    },
    200,
    origin,
  );
}

function handleModels(env: Env, origin: string | null): Response {
  const models = Array.from(buildModelRegistry(env).values()).map((model) => ({
    id: model.publicId,
    provider: model.provider,
    upstream_model: model.upstreamModel,
    capability: model.capability,
    count_source: model.countSource,
    enabled: model.enabled,
  }));
  return json({ schema_version: "1", models }, 200, origin);
}

async function handleRequest(
  request: Request,
  env: Env,
  context: RequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  const requestOrigin = request.headers.get("origin");
  const origin = allowedOrigin(request, env);

  if (requestOrigin && !origin) {
    console.warn(
      JSON.stringify({
        event: "worker_request_rejected",
        reason: "ORIGIN_NOT_ALLOWED",
        origin: requestOrigin,
        method: request.method,
        path: url.pathname,
      }),
    );
    return json({ error: { code: "ORIGIN_NOT_ALLOWED" } }, 403, null);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ status: "ok" }, 200, origin);
  }
  if (request.method === "GET" && url.pathname === MODELS_PATH) {
    return handleModels(env, origin);
  }
  if (request.method === "POST" && url.pathname === API_PATH) {
    return handleCompare(request, env, context, origin);
  }
  return json({ error: { code: "NOT_FOUND" } }, 404, origin);
}

export default {
  async fetch(request, env, context): Promise<Response> {
    try {
      return await handleRequest(request, env, context);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return json({ error: { code: error.code } }, error.status, allowedOrigin(request, env));
      }
      console.error(
        JSON.stringify({
          event: "worker_request_failed",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return json(
        { error: { code: "INTERNAL_ERROR" } },
        500,
        allowedOrigin(request, env),
      );
    }
  },
} satisfies ExportedHandler<Env>;

export const workerInternals = {
  allowedOrigin,
  handleRequest,
  resolveModels,
};
