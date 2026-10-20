export const SITE_NAME = "TokEval";
export const SITE_URL = new URL("https://tokeval.dev/");
export const SOURCE_URL = "https://github.com/wadeptr/tokeval";

export const HOME_TITLE = "AI Tokenizer Comparison & Efficiency Explorer";
export const HOME_DESCRIPTION =
  "Compare AI token counts and tokenization efficiency across OpenAI, Anthropic, Google Gemini, Meta Llama, xAI Grok, and other leading models.";

export interface FaqItem {
  question: string;
  answer: string;
}

export const TOKENIZER_FAQS: readonly FaqItem[] = [
  {
    question: "What is tokenization efficiency?",
    answer:
      "Tokenization efficiency describes how compactly a tokenizer represents the same text. For an identical input, fewer tokens use less of a model's context window and may reduce token-based input charges, but they do not by themselves prove better model quality or lower end-to-end cost.",
  },
  {
    question: "Why does the same text produce different token counts?",
    answer:
      "Each model family can use a different vocabulary, normalization process, pre-tokenizer, and merge strategy. Training-corpus coverage, writing system, spacing, morphology, emoji, and mixed scripts can therefore change how text is divided.",
  },
  {
    question: "Are all counts and token breakdowns exact?",
    answer:
      "No. TokEval labels exact local tokenizer output and exact provider results separately from estimates. Some provider APIs expose only a structured-message count, so TokEval can estimate the raw content count but cannot truthfully show unavailable token IDs or boundaries.",
  },
  {
    question: "Does the text leave my browser?",
    answer:
      "Local tokenizer rows run in the browser from pinned public artifacts. Rows labeled Provider API send the entered text through the TokEval server to that provider so the provider can count or tokenize it.",
  },
  {
    question: "Does the lowest token count identify the best model?",
    answer:
      "No. The ranking compares token count for the current text only. Model quality, output length, latency, pricing, caching, energy use, and task success are separate measurements that should be evaluated independently.",
  },
];
