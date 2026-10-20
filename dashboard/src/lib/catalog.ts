import catalogJson from "../../catalog/models.json";

export type TokenizerKind = "core" | "open";
export type ModelKind = TokenizerKind | "hosted";
export type ModelAccent = "coral" | "blue";
export type OpenModelDecoder =
  | "byte_level"
  | "sentencepiece"
  | "native_sentencepiece"
  | "tiktoken";
export type HostedCountSource =
  | "hosted_message_count"
  | "hosted_input_count"
  | "hosted_token_breakdown";

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  mark: string;
}

interface TokenizerCatalogBase {
  id: string;
  kind: TokenizerKind;
  provider: string;
  encoding: string;
  label: string;
  accent: ModelAccent;
  sourceUrl?: string;
}

export interface CoreTokenizerCatalogEntry extends TokenizerCatalogBase {
  kind: "core";
}

export interface OpenTokenizerCatalogEntry extends TokenizerCatalogBase {
  kind: "open";
  repository: string;
  revision: string;
  artifactUrl?: string;
  artifactSha256?: string;
  artifactSizeBytes?: number;
  decoder: OpenModelDecoder;
  pattern?: string;
  supportsBoundaries: boolean;
  boundaryLimitation?: string;
}

export type TokenizerCatalogEntry =
  | CoreTokenizerCatalogEntry
  | OpenTokenizerCatalogEntry;

export interface LocalCatalogModel {
  id: string;
  kind: "local";
  provider: string;
  name: string;
  tokenizerId: string;
}

export interface HostedCatalogModel {
  id: string;
  kind: "hosted";
  provider: string;
  encoding: string;
  label: string;
  modelExamples: string;
  accent: ModelAccent;
  sourceUrl?: string;
  upstreamModel: string;
  capability: "count_only" | "token_breakdown";
  countSource: HostedCountSource;
  supportsBoundaries: boolean;
  environmentOverride?: "ANTHROPIC_MODEL" | "GEMINI_MODEL" | "XAI_MODEL";
}

export type CatalogModel = LocalCatalogModel | HostedCatalogModel;

export type CoreCatalogModel = CoreTokenizerCatalogEntry & {
  id: string;
  tokenizerId: string;
  modelExamples: string;
};

export type OpenCatalogModel = OpenTokenizerCatalogEntry & {
  id: string;
  tokenizerId: string;
  modelExamples: string;
};

interface CatalogDocument {
  schemaVersion: number;
  providers: ProviderCatalogEntry[];
  tokenizers: TokenizerCatalogEntry[];
  models: CatalogModel[];
}

function validateCatalog(value: unknown): CatalogDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Model catalog must be an object.");
  }
  const document = value as CatalogDocument;
  if (
    document.schemaVersion !== 2 ||
    !Array.isArray(document.providers) ||
    !Array.isArray(document.tokenizers) ||
    !Array.isArray(document.models)
  ) {
    throw new Error("Unsupported model catalog schema.");
  }

  const providerIds = new Set<string>();
  for (const provider of document.providers) {
    if (
      typeof provider.id !== "string" ||
      typeof provider.name !== "string" ||
      typeof provider.mark !== "string" ||
      providerIds.has(provider.id)
    ) {
      throw new Error("Invalid or duplicate provider in model catalog.");
    }
    providerIds.add(provider.id);
  }

  const tokenizerIds = new Set<string>();
  for (const tokenizer of document.tokenizers) {
    if (
      typeof tokenizer.id !== "string" ||
      tokenizerIds.has(tokenizer.id) ||
      !providerIds.has(tokenizer.provider) ||
      (tokenizer.kind !== "core" && tokenizer.kind !== "open") ||
      typeof tokenizer.encoding !== "string" ||
      typeof tokenizer.label !== "string" ||
      (tokenizer.accent !== "coral" && tokenizer.accent !== "blue") ||
      (tokenizer.sourceUrl !== undefined && typeof tokenizer.sourceUrl !== "string")
    ) {
      throw new Error("Invalid or duplicate tokenizer integration in model catalog.");
    }
    if (
      tokenizer.kind === "open" &&
      (typeof tokenizer.repository !== "string" ||
        !/^[0-9a-f]{40}$/.test(tokenizer.revision) ||
        !["byte_level", "sentencepiece", "native_sentencepiece", "tiktoken"]
          .includes(tokenizer.decoder) ||
        typeof tokenizer.supportsBoundaries !== "boolean" ||
        (tokenizer.artifactSha256 !== undefined &&
          !/^[0-9a-f]{64}$/.test(tokenizer.artifactSha256)) ||
        (tokenizer.artifactSizeBytes !== undefined &&
          (!Number.isSafeInteger(tokenizer.artifactSizeBytes) ||
            tokenizer.artifactSizeBytes < 1)) ||
        (tokenizer.decoder === "tiktoken" &&
          (typeof tokenizer.artifactUrl !== "string" ||
            typeof tokenizer.pattern !== "string")))
    ) {
      throw new Error(`Invalid open tokenizer integration: ${tokenizer.id}`);
    }
    tokenizerIds.add(tokenizer.id);
  }

  const modelIds = new Set<string>();
  for (const model of document.models) {
    if (
      typeof model.id !== "string" ||
      modelIds.has(model.id) ||
      !providerIds.has(model.provider) ||
      (model.kind !== "local" && model.kind !== "hosted")
    ) {
      throw new Error("Invalid, duplicate, or orphaned model in model catalog.");
    }
    if (model.kind === "local") {
      const tokenizer = document.tokenizers.find(
        (candidate) => candidate.id === model.tokenizerId,
      );
      if (
        typeof model.name !== "string" ||
        !tokenizer ||
        tokenizer.provider !== model.provider
      ) {
        throw new Error(`Invalid tokenizer mapping for model: ${model.id}`);
      }
    } else if (
      typeof model.upstreamModel !== "string" ||
      typeof model.encoding !== "string" ||
      typeof model.label !== "string" ||
      typeof model.modelExamples !== "string" ||
      (model.accent !== "coral" && model.accent !== "blue") ||
      (model.capability !== "count_only" && model.capability !== "token_breakdown") ||
      !["hosted_message_count", "hosted_input_count", "hosted_token_breakdown"]
        .includes(model.countSource) ||
      typeof model.supportsBoundaries !== "boolean"
    ) {
      throw new Error(`Invalid hosted-model profile: ${model.id}`);
    }
    modelIds.add(model.id);
  }
  return document;
}

export const MODEL_CATALOG = validateCatalog(catalogJson);
export const PROVIDER_CATALOG = MODEL_CATALOG.providers;
export const TOKENIZER_CATALOG = MODEL_CATALOG.tokenizers;
export const LOCAL_CATALOG_MODELS = MODEL_CATALOG.models.filter(
  (model): model is LocalCatalogModel => model.kind === "local",
);
export const HOSTED_CATALOG_MODELS = MODEL_CATALOG.models.filter(
  (model): model is HostedCatalogModel => model.kind === "hosted",
);

function resolveLocalModel(
  model: LocalCatalogModel,
): CoreCatalogModel | OpenCatalogModel {
  const tokenizer = TOKENIZER_CATALOG.find(
    (candidate) => candidate.id === model.tokenizerId,
  );
  if (!tokenizer) throw new Error(`Missing tokenizer integration: ${model.tokenizerId}`);
  return {
    ...tokenizer,
    id: model.id,
    tokenizerId: tokenizer.id,
    modelExamples: model.name,
  };
}

const resolvedLocalModels = LOCAL_CATALOG_MODELS.map(resolveLocalModel);
export const CORE_CATALOG_MODELS = resolvedLocalModels.filter(
  (model): model is CoreCatalogModel => model.kind === "core",
);
export const OPEN_CATALOG_MODELS = resolvedLocalModels.filter(
  (model): model is OpenCatalogModel => model.kind === "open",
);

export function providerCatalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId);
}
