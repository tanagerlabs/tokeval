import type { Env, ModelDefinition, ProviderName } from "./types";
import modelCatalog from "../../catalog/models.json";

interface HostedCatalogEntry {
  id: string;
  kind: "hosted";
  provider: ProviderName;
  upstreamModel: string;
  environmentOverride?: "ANTHROPIC_MODEL" | "GEMINI_MODEL" | "XAI_MODEL";
}

function isProvider(value: unknown): value is ProviderName {
  return value === "anthropic" || value === "google" || value === "xai";
}

function hostedCatalogEntries(): HostedCatalogEntry[] {
  return modelCatalog.models.flatMap((candidate) => {
    if (candidate.kind !== "hosted") return [];
    if (
      !isProvider(candidate.provider) ||
      typeof candidate.upstreamModel !== "string"
    ) {
      throw new Error("Invalid hosted model in dashboard/catalog/models.json");
    }
    return [candidate as HostedCatalogEntry];
  });
}

function configuredUpstreamModel(entry: HostedCatalogEntry, env: Env): string {
  if (entry.environmentOverride === "ANTHROPIC_MODEL") {
    return env.ANTHROPIC_MODEL ?? entry.upstreamModel;
  }
  if (entry.environmentOverride === "GEMINI_MODEL") {
    return env.GEMINI_MODEL ?? entry.upstreamModel;
  }
  if (entry.environmentOverride === "XAI_MODEL") {
    return env.XAI_MODEL ?? entry.upstreamModel;
  }
  return entry.upstreamModel;
}

function enabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.trim().toLowerCase() === "true";
}

function definition(
  publicId: string,
  provider: ProviderName,
  upstreamModel: string,
  isEnabled: boolean,
): ModelDefinition {
  if (provider === "anthropic") {
    return {
      publicId,
      provider,
      upstreamModel,
      capability: "count_only",
      countSource: "hosted_message_count",
      enabled: isEnabled,
      cacheable: true,
    };
  }
  if (provider === "google") {
    return {
      publicId,
      provider,
      upstreamModel,
      capability: "count_only",
      countSource: "hosted_input_count",
      enabled: isEnabled,
      cacheable: true,
    };
  }
  return {
    publicId,
    provider,
    upstreamModel,
    capability: "token_breakdown",
    countSource: "hosted_token_breakdown",
    enabled: isEnabled,
    cacheable: false,
  };
}

function additionalDefinitions(env: Env): ModelDefinition[] {
  if (!env.ADDITIONAL_MODELS_JSON) return [];

  let value: unknown;
  try {
    value = JSON.parse(env.ADDITIONAL_MODELS_JSON) as unknown;
  } catch {
    throw new Error("ADDITIONAL_MODELS_JSON must be valid JSON");
  }
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("ADDITIONAL_MODELS_JSON must be an array of at most 100 models");
  }

  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error("Every additional model must be an object");
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(record.id) ||
      (record.provider !== "anthropic" &&
        record.provider !== "google" &&
        record.provider !== "xai") ||
      typeof record.upstream_model !== "string" ||
      record.upstream_model.length < 1 ||
      record.upstream_model.length > 160 ||
      (record.enabled !== undefined && typeof record.enabled !== "boolean")
    ) {
      throw new Error("Invalid additional model definition");
    }

    const provider = record.provider as ProviderName;
    const globallyEnabled = provider !== "xai" || enabled(env.ENABLE_XAI, false);
    return definition(
      record.id,
      provider,
      record.upstream_model,
      (record.enabled ?? true) && globallyEnabled,
    );
  });
}

export function buildModelRegistry(env: Env): Map<string, ModelDefinition> {
  const definitions: ModelDefinition[] = [
    ...hostedCatalogEntries().map((entry) => definition(
      entry.id,
      entry.provider,
      configuredUpstreamModel(entry, env),
      entry.provider !== "xai" || enabled(env.ENABLE_XAI, false),
    )),
    ...additionalDefinitions(env),
  ];

  return new Map(definitions.map((definition) => [definition.publicId, definition]));
}

export function providerDefaultModel(provider: ProviderName): string {
  if (provider === "anthropic") return "anthropic-default";
  if (provider === "google") return "gemini-default";
  return "grok-default";
}
