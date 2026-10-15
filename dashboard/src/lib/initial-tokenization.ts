import type { TokenizationResult } from "./tokenizer";

export const INITIAL_TEXT = "오늘도 좋은 하루 보내세요!";

// Checked against the pinned encodings in tests. Keeping this small result in
// the page lets Astro render useful HTML without shipping the vocabulary data.
export const INITIAL_RESULTS: TokenizationResult[] = [
  {
    profile: {
      encoding: "o200k_base",
      label: "OpenAI o200k",
      modelExamples: "GPT-4o · GPT-4.1 · GPT-5",
      accent: "coral",
    },
    tokenizerRevision: "js-tiktoken@1.0.21",
    countSource: "local_tokenizer",
    inputBytes: 37,
    tokens: [
      { index: 0, id: 149830, bytes: [236, 152, 164, 235, 138, 152], byteStart: 0, byteEnd: 6, text: "오늘" },
      { index: 1, id: 5827, bytes: [235, 143, 132], byteStart: 6, byteEnd: 9, text: "도" },
      { index: 2, id: 70135, bytes: [32, 236, 162, 139, 236, 157, 128], byteStart: 9, byteEnd: 16, text: " 좋은" },
      { index: 3, id: 141945, bytes: [32, 237, 149, 152, 235, 163, 168], byteStart: 16, byteEnd: 23, text: " 하루" },
      { index: 4, id: 129466, bytes: [32, 235, 179, 180, 235, 130, 180], byteStart: 23, byteEnd: 30, text: " 보내" },
      { index: 5, id: 37436, bytes: [236, 132, 184, 236, 154, 148], byteStart: 30, byteEnd: 36, text: "세요" },
      { index: 6, id: 0, bytes: [33], byteStart: 36, byteEnd: 37, text: "!" },
    ],
  },
  {
    profile: {
      encoding: "cl100k_base",
      label: "OpenAI cl100k",
      modelExamples: "GPT-4 · GPT-4 Turbo",
      accent: "blue",
    },
    tokenizerRevision: "js-tiktoken@1.0.21",
    countSource: "local_tokenizer",
    inputBytes: 37,
    tokens: [
      { index: 0, id: 58368, bytes: [236, 152, 164], byteStart: 0, byteEnd: 3, text: "오" },
      { index: 1, id: 15478, bytes: [235, 138], byteStart: 3, byteEnd: 5, text: null },
      { index: 2, id: 246, bytes: [152], byteStart: 5, byteEnd: 6, text: null },
      { index: 3, id: 49085, bytes: [235, 143, 132], byteStart: 6, byteEnd: 9, text: "도" },
      { index: 4, id: 66799, bytes: [32, 236, 162], byteStart: 9, byteEnd: 12, text: null },
      { index: 5, id: 233, bytes: [139], byteStart: 12, byteEnd: 13, text: null },
      { index: 6, id: 34804, bytes: [236, 157, 128], byteStart: 13, byteEnd: 16, text: "은" },
      { index: 7, id: 55000, bytes: [32, 237, 149, 152], byteStart: 16, byteEnd: 20, text: " 하" },
      { index: 8, id: 53987, bytes: [235, 163], byteStart: 20, byteEnd: 22, text: null },
      { index: 9, id: 101, bytes: [168], byteStart: 22, byteEnd: 23, text: null },
      { index: 10, id: 64432, bytes: [32, 235, 179, 180], byteStart: 23, byteEnd: 27, text: " 보" },
      { index: 11, id: 96318, bytes: [235, 130, 180], byteStart: 27, byteEnd: 30, text: "내" },
      { index: 12, id: 51402, bytes: [236, 132, 184, 236, 154, 148], byteStart: 30, byteEnd: 36, text: "세요" },
      { index: 13, id: 0, bytes: [33], byteStart: 36, byteEnd: 37, text: "!" },
    ],
  },
];

