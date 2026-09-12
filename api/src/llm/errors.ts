/** An HTTP-level failure from a provider. `status` drives retry and fallback decisions. */
export class ProviderError extends Error {
  /** Total provider calls made before giving up, set by the fallback layer. */
  attempts = 1;

  /** Wait hinted by the provider (429 retry-after), in milliseconds. */
  retryAfterMs?: number;

  constructor(
    public provider: string,
    public status: number | undefined,
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }

  get isRateLimit() {
    return this.status === 429;
  }

  get isRetryable() {
    return this.status === 429 || (this.status !== undefined && this.status >= 500);
  }
}

/** The provider answered, but not with parseable JSON. `raw` is kept for debugging. */
export class OutputParseError extends Error {
  attempts = 1;

  constructor(
    public provider: string,
    public raw: string,
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = "OutputParseError";
  }
}

/**
 * How long the provider asked us to wait, in milliseconds, or undefined if it did not say.
 * Groq sends a `retry-after` header and spells it out in the message ("try again in 18.0075s");
 * Gemini puts a RetryInfo `retryDelay` in the error body. Honouring it turns a wasted retry
 * into a successful one on free tiers, where the limit is tokens per minute.
 */
export function parseRetryAfter(message: string, headers?: Headers | null): number | undefined {
  const header = headers?.get?.("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const match =
    message.match(/try again in ([\d.]+)\s*s/i) ??
    message.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i) ??
    message.match(/retry after ([\d.]+)\s*s/i);
  return match ? Math.round(Number(match[1]) * 1000) : undefined;
}
