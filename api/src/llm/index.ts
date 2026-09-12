import { withCache } from "./cache.js";
import { OutputParseError, ProviderError } from "./errors.js";
import { createGeminiProvider } from "./gemini.js";
import { createGroqProvider } from "./groq.js";
import type { CompleteOptions, LLMProvider, LLMResult, LLMStream, StreamOptions } from "./types.js";

export * from "./types.js";
export { OutputParseError, ProviderError } from "./errors.js";

const FACTORIES: Record<string, () => LLMProvider> = {
  gemini: () => createGeminiProvider(),
  groq: () => createGroqProvider(),
};

const MAX_CONSECUTIVE_429 = 2;
/** Cap on a provider's own retry-after hint, so one request cannot stall a page load. */
const MAX_RETRY_AFTER_MS = Number(process.env.LLM_MAX_RETRY_AFTER_MS ?? 20_000);
const MAX_SERVER_ERRORS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The provider's own hint when it gave one (free tiers are limited per minute), else backoff. */
function waitFor(err: ProviderError, failures: number): number {
  if (err.retryAfterMs !== undefined) return Math.min(err.retryAfterMs + 250, MAX_RETRY_AFTER_MS);
  return backoff(failures);
}

function backoff(failures: number): number {
  const base = Number(process.env.LLM_BACKOFF_MS ?? 1000);
  return base * 2 ** (failures - 1) + Math.random() * (base / 4);
}

/**
 * Runs `call` against each provider in order. Within a provider: exponential backoff on 429
 * and 5xx. After two consecutive 429s (or three 5xx, or any other HTTP error) it moves to
 * the next provider. For streams this covers everything up to the first token.
 */
async function tryChain<R>(
  chain: LLMProvider[],
  call: (p: LLMProvider) => Promise<R>,
): Promise<{ result: R; attempts: number; index: number }> {
  let attempts = 0;
  let lastError: ProviderError | undefined;

  for (const [index, provider] of chain.entries()) {
    let consecutive429 = 0;
    let serverErrors = 0;
    while (true) {
      attempts++;
      try {
        return { result: await call(provider), attempts, index };
      } catch (err) {
        if (err instanceof OutputParseError) {
          err.attempts = attempts;
          throw err;
        }
        if (!(err instanceof ProviderError)) throw err;
        lastError = err;
        if (err.isRateLimit) {
          consecutive429++;
          if (consecutive429 >= MAX_CONSECUTIVE_429) break;
          await sleep(waitFor(err, consecutive429));
        } else if (err.isRetryable) {
          consecutive429 = 0;
          serverErrors++;
          if (serverErrors >= MAX_SERVER_ERRORS) break;
          await sleep(backoff(serverErrors));
        } else {
          break;
        }
      }
    }
  }
  lastError!.attempts = attempts;
  throw lastError;
}

export function withFallback(chain: LLMProvider[]): LLMProvider {
  if (chain.length === 0) throw new Error("No LLM providers configured");
  const fallbackInfo = (index: number) => (index > 0 ? { fallbackFrom: chain[0].name } : {});

  return {
    name: chain.map((p) => p.name).join("+"),

    async complete<T>(opts: CompleteOptions): Promise<LLMResult<T>> {
      const { result, attempts, index } = await tryChain(chain, (p) => p.complete<T>(opts));
      return { data: result.data, meta: { ...result.meta, attempts, ...fallbackInfo(index) } };
    },

    async stream(opts: StreamOptions): Promise<LLMStream> {
      const { result, attempts, index } = await tryChain(chain, (p) => p.stream(opts));
      const meta = result.meta.then((m) => ({ ...m, attempts, ...fallbackInfo(index) }));
      meta.catch(() => {});
      return { textStream: result.textStream, meta };
    },
  };
}

let cached: LLMProvider | undefined;

/**
 * The provider named by LLM_PROVIDER (default gemini), with the other one as fallback
 * when its API key is set, wrapped in retry/fallback and the response cache.
 */
export function getProvider(): LLMProvider {
  if (cached) return cached;
  const primary = process.env.LLM_PROVIDER ?? "gemini";
  if (!FACTORIES[primary]) throw new Error(`Unknown LLM_PROVIDER "${primary}"`);
  const keys: Record<string, string | undefined> = {
    gemini: process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
  };
  const names = [primary, ...Object.keys(FACTORIES).filter((n) => n !== primary && keys[n])];
  cached = withCache(withFallback(names.map((n) => FACTORIES[n]())));
  return cached;
}
