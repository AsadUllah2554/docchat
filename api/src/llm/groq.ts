import Groq from "groq-sdk";
import { OutputParseError, ProviderError } from "./errors.js";
import { estimateCost } from "./pricing.js";
import { streamWithMeta, type CompleteOptions, type LLMProvider, type LLMResult, type StreamOptions } from "./types.js";

export function createGroqProvider(
  apiKey = process.env.GROQ_API_KEY,
  // Must support json_schema structured outputs for complete(); any chat model works for stream().
  model = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
): LLMProvider {
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  // Retries are handled one level up, where fallback decisions are made.
  const client = new Groq({ apiKey, maxRetries: 0 });

  const wrap = (err: unknown) =>
    err instanceof Groq.APIError
      ? new ProviderError("groq", err.status, err.message)
      : new ProviderError("groq", undefined, (err as Error).message);

  return {
    name: "groq",

    async complete<T>(opts: CompleteOptions): Promise<LLMResult<T>> {
      const started = Date.now();
      let completion;
      try {
        completion = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "response", schema: opts.schema as Record<string, unknown> },
          },
          max_completion_tokens: opts.maxTokens ?? 4096,
          temperature: 0,
        });
      } catch (err) {
        throw wrap(err);
      }
      const raw = completion.choices[0]?.message?.content ?? "";
      let data: T;
      try {
        data = JSON.parse(raw) as T;
      } catch {
        throw new OutputParseError("groq", raw, "response was not valid JSON");
      }
      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;
      return {
        data,
        meta: {
          provider: "groq",
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
      const source = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        max_completion_tokens: opts.maxTokens ?? 1024,
        temperature: 0.2,
        stream: true,
      }).catch((err: unknown) => {
        throw wrap(err);
      });

      let inputTokens = 0;
      let outputTokens = 0;
      async function* text() {
        try {
          for await (const chunk of source) {
            const usage = chunk.x_groq?.usage;
            if (usage) {
              inputTokens = usage.prompt_tokens ?? inputTokens;
              outputTokens = usage.completion_tokens ?? outputTokens;
            }
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) yield delta;
          }
        } catch (err) {
          throw wrap(err);
        }
      }
      return streamWithMeta(text(), () => ({
        provider: "groq",
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
