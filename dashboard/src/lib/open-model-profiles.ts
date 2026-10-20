import { OPEN_CATALOG_MODELS } from "./catalog";
import type { OpenModelDecoder } from "./catalog";
import type { TokenizerProfile } from "./tokenizer";

export type OpenModelTokenizerId = string;

export interface OpenModelTokenizerProfile
  extends Omit<TokenizerProfile, "encoding" | "accent"> {
  id: OpenModelTokenizerId;
  tokenizerId: string;
  encoding: string;
  accent: "coral" | "blue";
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

export const OPEN_MODEL_PROFILES: OpenModelTokenizerProfile[] =
  OPEN_CATALOG_MODELS.map((model) => ({ ...model }));

