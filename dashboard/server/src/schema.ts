import type { CompareRequest, ProviderName, ProviderSelection } from "./types";

export const MAX_INPUT_BYTES = 16 * 1024;
export const MAX_BODY_BYTES = 24 * 1024;
const PROVIDERS = new Set<ProviderName>(["anthropic", "google", "xai"]);
const encoder = new TextEncoder();

export class RequestValidationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "RequestValidationError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSelection(value: unknown): ProviderSelection {
  if (!isRecord(value)) {
    throw new RequestValidationError(400, "INVALID_PROVIDER_SELECTION");
  }
  if (typeof value.provider !== "string" || !PROVIDERS.has(value.provider as ProviderName)) {
    throw new RequestValidationError(400, "INVALID_PROVIDER");
  }
  if (
    typeof value.model !== "string" ||
    value.model.length < 1 ||
    value.model.length > 80 ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(value.model)
  ) {
    throw new RequestValidationError(400, "INVALID_MODEL");
  }
  return {
    provider: value.provider as ProviderName,
    model: value.model,
  };
}

export function parseCompareRequest(value: unknown): CompareRequest {
  if (!isRecord(value)) {
    throw new RequestValidationError(400, "INVALID_REQUEST");
  }
  if (typeof value.text !== "string") {
    throw new RequestValidationError(400, "INVALID_TEXT");
  }
  const inputBytes = encoder.encode(value.text).byteLength;
  if (inputBytes === 0) {
    throw new RequestValidationError(400, "EMPTY_TEXT");
  }
  if (inputBytes > MAX_INPUT_BYTES) {
    throw new RequestValidationError(413, "TEXT_TOO_LARGE");
  }
  if (!Array.isArray(value.providers) || value.providers.length < 1 || value.providers.length > 3) {
    throw new RequestValidationError(400, "INVALID_PROVIDERS");
  }

  const providers = value.providers.map(parseSelection);
  const providerNames = providers.map((selection) => selection.provider);
  if (new Set(providerNames).size !== providerNames.length) {
    throw new RequestValidationError(400, "DUPLICATE_PROVIDER");
  }

  const requestId = value.request_id;
  if (
    requestId !== undefined &&
    (typeof requestId !== "string" ||
      !/^[a-z0-9_-]{1,100}$/i.test(requestId))
  ) {
    throw new RequestValidationError(400, "INVALID_REQUEST_ID");
  }

  return {
    text: value.text,
    providers,
    request_id: typeof requestId === "string" ? requestId : crypto.randomUUID(),
  };
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new RequestValidationError(400, "CONTENT_TYPE_MUST_BE_JSON");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new RequestValidationError(413, "REQUEST_TOO_LARGE");
  }

  const body = await request.text();
  if (encoder.encode(body).byteLength > MAX_BODY_BYTES) {
    throw new RequestValidationError(413, "REQUEST_TOO_LARGE");
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestValidationError(400, "INVALID_JSON");
  }
}
