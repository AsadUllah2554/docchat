import { describe, expect, it } from "vitest";
import { ProviderError, streamWithMeta, withFallback, type LLMProvider } from "../src/llm/index.js";
import { parseRetryAfter } from "../src/llm/errors.js";

function provider(name: string, script: (Error | string)[]) {
  let calls = 0;
  const p: LLMProvider = {
    name,
    complete: async () => {
      throw new Error("unused");
    },
    stream: async () => {
      const step = script[Math.min(calls++, script.length - 1)];
      if (step instanceof Error) throw step;
      async function* one() {
        yield step as string;
      }
      return streamWithMeta(one(), () => ({ provider: name, model: name, inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCost: 0, attempts: 1 }));
    },
  };
  return { p, calls: () => calls };
}

const drain = async (it: AsyncIterable<string>) => {
  let s = "";
  for await (const x of it) s += x;
  return s;
};

describe("streaming fallback", () => {
  it("falls through to the secondary after two consecutive 429s and records it (failure case 4)", async () => {
    const gemini = provider("gemini", [new ProviderError("gemini", 429, "quota"), new ProviderError("gemini", 429, "quota")]);
    const groq = provider("groq", ["hello"]);
    const stream = await withFallback([gemini.p, groq.p]).stream({ system: "", user: "" });

    expect(await drain(stream.textStream)).toBe("hello");
    const meta = await stream.meta;
    expect(meta).toMatchObject({ provider: "groq", fallbackFrom: "gemini", attempts: 3 });
    expect(gemini.calls()).toBe(2);
  });

  it("stays on the primary after one 429", async () => {
    const gemini = provider("gemini", [new ProviderError("gemini", 429, "quota"), "ok"]);
    const groq = provider("groq", ["unused"]);
    const stream = await withFallback([gemini.p, groq.p]).stream({ system: "", user: "" });
    await drain(stream.textStream);
    expect((await stream.meta).fallbackFrom).toBeUndefined();
    expect(groq.calls()).toBe(0);
  });
});

describe("parseRetryAfter", () => {
  it("reads the retry-after header in seconds", () => {
    expect(parseRetryAfter("", new Headers({ "retry-after": "18" }))).toBe(18_000);
  });

  it("reads the wait out of a Groq rate-limit message", () => {
    const message =
      'Rate limit reached for model `openai/gpt-oss-20b` on tokens per minute (TPM): Limit 8000, Used 6476, Requested 3925. Please try again in 18.0075s.';
    expect(parseRetryAfter(message)).toBe(18_008);
  });

  it("reads Gemini's retryDelay", () => {
    expect(parseRetryAfter('{"error":{"details":[{"retryDelay":"27s"}]}}')).toBe(27_000);
  });

  it("returns undefined when the provider gave no hint", () => {
    expect(parseRetryAfter("Internal error")).toBeUndefined();
  });
});
