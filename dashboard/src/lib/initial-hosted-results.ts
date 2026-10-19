import {
  HOSTED_MODEL_PROFILES,
  type HostedResult,
} from "./hosted-tokenizer";

function profile(id: (typeof HOSTED_MODEL_PROFILES)[number]["id"]) {
  const match = HOSTED_MODEL_PROFILES.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`Missing hosted model profile: ${id}`);
  return match;
}

// Provider-verified values for INITIAL_TEXT. They make the server-rendered page
// useful immediately; edits are still recounted through the hosted APIs.
export const INITIAL_HOSTED_RESULTS: HostedResult[] = [
  {
    profile: profile("anthropic-default"),
    resolvedModel: "claude-opus-5-5",
    status: "ok",
    tokenCount: 25,
    tokens: null,
    cache: "disabled",
    error: null,
  },
  {
    profile: profile("gemini-default"),
    resolvedModel: "gemini-4-argon",
    status: "ok",
    tokenCount: 38,
    tokens: null,
    cache: "disabled",
    error: null,
  },
  {
    profile: profile("grok-default"),
    resolvedModel: "grok-4.7",
    status: "ok",
    tokenCount: 10,
    tokens: [
      { index: 0, id: 61081, bytes: [236, 152, 164, 235, 138, 152], byteStart: 0, byteEnd: 6, text: "오늘" },
      { index: 1, id: 2061, bytes: [235, 143, 132], byteStart: 6, byteEnd: 9, text: "도" },
      { index: 2, id: 884, bytes: [32], byteStart: 9, byteEnd: 10, text: " " },
      { index: 3, id: 66221, bytes: [236, 162, 139, 236, 157, 128], byteStart: 10, byteEnd: 16, text: "좋은" },
      { index: 4, id: 884, bytes: [32], byteStart: 16, byteEnd: 17, text: " " },
      { index: 5, id: 66473, bytes: [237, 149, 152, 235, 163, 168], byteStart: 17, byteEnd: 23, text: "하루" },
      { index: 6, id: 884, bytes: [32], byteStart: 23, byteEnd: 24, text: " " },
      { index: 7, id: 60967, bytes: [235, 179, 180, 235, 130, 180], byteStart: 24, byteEnd: 30, text: "보내" },
      { index: 8, id: 34787, bytes: [236, 132, 184, 236, 154, 148], byteStart: 30, byteEnd: 36, text: "세요" },
      { index: 9, id: 885, bytes: [33], byteStart: 36, byteEnd: 37, text: "!" },
    ],
    cache: "disabled",
    error: null,
  },
];
