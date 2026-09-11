export interface LLMResult<T> {
  data: T;
  meta: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    estimatedCost: number;
    attempts: number;
    /** Provider that was tried first and rate limited, when a fallback served the request. */
    fallbackFrom?: string;
    /** True when the result came from the local response cache, not a live call. */
    cacheHit?: boolean;
  };
}

export type LLMMeta = LLMResult<unknown>["meta"];

export interface CompleteOptions {
  system: string;
  user: string;
  schema: object;
  maxTokens?: number;
}

export interface StreamOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

/**
 * A started stream. Errors that happen before the first token (auth, 429, 5xx) reject the
 * promise returned by `stream()`, so retry and fallback can still act on them.
 */
export interface LLMStream {
  textStream: AsyncIterable<string>;
  /** Resolves once the stream has been fully consumed. */
  meta: Promise<LLMMeta>;
}

export interface LLMProvider {
  name: string;
  complete<T>(opts: CompleteOptions): Promise<LLMResult<T>>;
  stream(opts: StreamOptions): Promise<LLMStream>;
}

/** Wraps an async iterable so `meta` resolves when it has been drained. */
export function streamWithMeta(
  source: AsyncIterable<string>,
  finish: () => LLMMeta,
): LLMStream {
  let resolve!: (m: LLMMeta) => void;
  let reject!: (e: unknown) => void;
  const meta = new Promise<LLMMeta>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Callers that never await meta (for example after an error) should not see an unhandled rejection.
  meta.catch(() => {});
  async function* run() {
    try {
      for await (const text of source) yield text;
      resolve(finish());
    } catch (err) {
      reject(err);
      throw err;
    }
  }
  return { textStream: run(), meta };
}
