import { ApiError, GoogleGenAI } from "@google/genai";
import { OutputParseError, ProviderError } from "./errors.js";
import { estimateCost } from "./pricing.js";
import { streamWithMeta, type CompleteOptions, type LLMProvider, type LLMResult, type StreamOptions } from "./types.js";

export function createGeminiProvider(
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
): LLMProvider {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  // Answers are grounded in retrieved text; thinking on 2.5 Flash only adds latency and cost.
  const thinking = model.includes("2.5-flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {};

  const wrap = (err: unknown) =>
    err instanceof ApiError
      ? new ProviderError("gemini", err.status, err.message)
      : new ProviderError("gemini", undefined, (err as Error).message);

  return {
    name: "gemini",

    async complete<T>(opts: CompleteOptions): Promise<LLMResult<T>> {
      const started = Date.now();
      let response;
      try {
        response = await ai.models.generateContent({
          model,
          contents: opts.user,
          config: {
            systemInstruction: opts.system,
            responseMimeType: "application/json",
            responseJsonSchema: opts.schema,
            maxOutputTokens: opts.maxTokens ?? 4096,
            temperature: 0,
            ...thinking,
          },
        });
      } catch (err) {
        throw wrap(err);
      }
      const raw = response.text ?? "";
      let data: T;
      try {
        data = JSON.parse(raw) as T;
      } catch {
        throw new OutputParseError("gemini", raw, "response was not valid JSON");
      }
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0);
      return {
        data,
        meta: {
          provider: "gemini",
          model,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - started,
          estimatedCost: estimateCost(model, inputTokens, outputTokens),
          attempts: 1,
        },
      };
    },

    async stream(opts: StreamOptions) {
      const started = Date.now();
      const source = await ai.models.generateContentStream({
        model,
        contents: opts.user,
        config: { systemInstruction: opts.system, maxOutputTokens: opts.maxTokens ?? 1024, temperature: 0.2, ...thinking },
      }).catch((err: unknown) => {
        throw wrap(err);
      });

      let inputTokens = 0;
      let outputTokens = 0;
      async function* text() {
        try {
          for await (const chunk of source) {
            if (chunk.usageMetadata) {
              inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
              outputTokens = (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0);
            }
            if (chunk.text) yield chunk.text;
          }
        } catch (err) {
          throw wrap(err);
        }
      }
      return streamWithMeta(text(), () => ({
        provider: "gemini",
        model,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        estimatedCost: estimateCost(model, inputTokens, outputTokens),
        attempts: 1,
      }));
    },
  };
}
