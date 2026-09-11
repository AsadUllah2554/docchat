/** An HTTP-level failure from a provider. `status` drives retry and fallback decisions. */
export class ProviderError extends Error {
  /** Total provider calls made before giving up, set by the fallback layer. */
  attempts = 1;

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
