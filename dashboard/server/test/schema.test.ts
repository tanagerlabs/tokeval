import { describe, expect, test } from "vitest";
import {
  MAX_INPUT_BYTES,
  parseCompareRequest,
  readJsonBody,
  RequestValidationError,
} from "../src/schema";

describe("parseCompareRequest", () => {
  test("accepts a valid multi-provider request", () => {
    const parsed = parseCompareRequest({
      text: "안녕하세요",
      providers: [
        { provider: "anthropic", model: "anthropic-default" },
        { provider: "google", model: "gemini-default" },
      ],
      request_id: "test-request",
    });

    expect(parsed.request_id).toBe("test-request");
    expect(parsed.providers).toHaveLength(2);
  });

  test("generates a request ID when omitted", () => {
    const parsed = parseCompareRequest({
      text: "hello",
      providers: [{ provider: "xai", model: "grok-default" }],
    });

    expect(parsed.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("restricts client request IDs to log-safe characters", () => {
    expect(() =>
      parseCompareRequest({
        text: "hello",
        providers: [{ provider: "xai", model: "grok-default" }],
        request_id: "private value with spaces",
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST_ID" }));
  });

  test("rejects duplicate providers", () => {
    expect(() =>
      parseCompareRequest({
        text: "hello",
        providers: [
          { provider: "google", model: "gemini-default" },
          { provider: "google", model: "gemini-other" },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_PROVIDER" }));
  });

  test("enforces the limit on UTF-8 bytes rather than code points", () => {
    const koreanSyllable = "한";
    const oversized = koreanSyllable.repeat(Math.floor(MAX_INPUT_BYTES / 3) + 1);

    expect(() =>
      parseCompareRequest({
        text: oversized,
        providers: [{ provider: "anthropic", model: "anthropic-default" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "TEXT_TOO_LARGE", status: 413 }));
  });
});

describe("readJsonBody", () => {
  test("requires application/json", async () => {
    const request = new Request("https://api.example.test", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "text/plain" },
    });

    await expect(readJsonBody(request)).rejects.toMatchObject<Partial<RequestValidationError>>({
      code: "CONTENT_TYPE_MUST_BE_JSON",
    });
  });

  test("reports malformed JSON without reflecting the body", async () => {
    const request = new Request("https://api.example.test", {
      method: "POST",
      body: "{private text",
      headers: { "content-type": "application/json" },
    });

    await expect(readJsonBody(request)).rejects.toMatchObject<Partial<RequestValidationError>>({
      code: "INVALID_JSON",
      message: "INVALID_JSON",
    });
  });
});
