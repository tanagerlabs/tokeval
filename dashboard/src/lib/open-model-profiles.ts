import type { TokenizerProfile } from "./tokenizer";

export type OpenModelTokenizerId =
  | "deepseek-v3.2"
  | "google-gemini-3-pro-preview"
  | "meta-llama-4"
  | "mistral-7b-v0.3"
  | "cohere-command-a-plus"
  | "xai-grok-1";

export interface OpenModelTokenizerProfile
  extends Omit<TokenizerProfile, "encoding" | "accent"> {
  id: OpenModelTokenizerId;
  encoding: string;
  accent: "coral" | "blue";
  repository: string;
  revision: string;
  artifactUrl?: string;
  artifactSha256?: string;
  decoder:
    | "byte_level"
    | "sentencepiece"
    | "native_sentencepiece"
    | "tiktoken";
}

export const OPEN_MODEL_PROFILES: OpenModelTokenizerProfile[] = [
  {
    id: "deepseek-v3.2",
    provider: "deepseek",
    encoding: "deepseek-ai/DeepSeek-V3.2",
    label: "DeepSeek V3.2",
    modelExamples: "DeepSeek V3.2",
    accent: "coral",
    repository: "deepseek-ai/DeepSeek-V3.2",
    revision: "a7e62ac04ecb2c0a54d736dc46601c5606cf10a6",
    sourceUrl:
      "https://huggingface.co/deepseek-ai/DeepSeek-V3.2/tree/a7e62ac04ecb2c0a54d736dc46601c5606cf10a6",
    decoder: "byte_level",
  },
  {
    id: "google-gemini-3-pro-preview",
    provider: "google",
    encoding: "Google LocalTokenizer · gemma3",
    label: "Google Gemini local",
    modelExamples: "Gemini 3 Pro Preview (local)",
    accent: "blue",
    repository: "google/gemma_pytorch",
    revision: "014acb7ac4563a5f77c76d7ff98f31b568c16508",
    artifactUrl:
      "https://raw.githubusercontent.com/google/gemma_pytorch/014acb7ac4563a5f77c76d7ff98f31b568c16508/tokenizer/gemma3_cleaned_262144_v2.spiece.model",
    artifactSha256:
      "1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c",
    sourceUrl:
      "https://github.com/googleapis/js-genai/blob/v2.30.0/src/cross/tokenizer/_loader.ts",
    decoder: "native_sentencepiece",
  },
  {
    id: "meta-llama-4",
    provider: "meta",
    encoding: "llama4/tokenizer.model",
    label: "Meta Llama 4",
    modelExamples: "Meta Llama 4",
    accent: "blue",
    repository: "meta-llama/llama-models",
    revision: "0e0b8c519242d5833d8c11bffc1232b77ad7f301",
    artifactUrl:
      "https://raw.githubusercontent.com/meta-llama/llama-models/0e0b8c519242d5833d8c11bffc1232b77ad7f301/models/llama4/tokenizer.model",
    sourceUrl:
      "https://github.com/meta-llama/llama-models/blob/0e0b8c519242d5833d8c11bffc1232b77ad7f301/models/llama4/tokenizer.model",
    decoder: "tiktoken",
  },
  {
    id: "mistral-7b-v0.3",
    provider: "mistral",
    encoding: "mistralai/Mistral-7B-Instruct-v0.3",
    label: "Mistral 7B v0.3",
    modelExamples: "Mistral 7B Instruct v0.3",
    accent: "coral",
    repository: "mistralai/Mistral-7B-Instruct-v0.3",
    revision: "c170c708c41dac9275d15a8fff4eca08d52bab71",
    sourceUrl:
      "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3/tree/c170c708c41dac9275d15a8fff4eca08d52bab71",
    decoder: "sentencepiece",
  },
  {
    id: "cohere-command-a-plus",
    provider: "cohere",
    encoding: "CohereLabs/command-a-plus-05-2026-w4a4",
    label: "Cohere Command A+",
    modelExamples: "Command A+",
    accent: "blue",
    repository: "CohereLabs/command-a-plus-05-2026-w4a4",
    revision: "ebd2d72c0f9a84389c6b057136d38c435aea2700",
    sourceUrl:
      "https://huggingface.co/CohereLabs/command-a-plus-05-2026-w4a4/tree/ebd2d72c0f9a84389c6b057136d38c435aea2700",
    decoder: "byte_level",
  },
  {
    id: "xai-grok-1",
    provider: "xai",
    encoding: "xai-org/grok-1/tokenizer.model",
    label: "xAI Grok-1",
    modelExamples: "Grok-1",
    accent: "coral",
    repository: "xai-org/grok-1",
    revision: "7050ed204b8206bb8645c7b7bbef7252f79561b0",
    artifactUrl:
      "https://raw.githubusercontent.com/xai-org/grok-1/7050ed204b8206bb8645c7b7bbef7252f79561b0/tokenizer.model",
    sourceUrl:
      "https://github.com/xai-org/grok-1/blob/7050ed204b8206bb8645c7b7bbef7252f79561b0/tokenizer.model",
    decoder: "native_sentencepiece",
  },
];

