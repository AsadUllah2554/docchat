import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { streamWithMeta, type CompleteOptions, type LLMMeta, type LLMProvider, type LLMResult, type StreamOptions } from "./types.js";

function cacheDir() {
  return (
    process.env.LLM_CACHE_DIR ??
    (process.env.NODE_ENV === "production" ? path.join(tmpdir(), "llm-cache") : path.join(process.cwd(), ".llm-cache"))
  );
}

export function cacheKey(kind: string, opts: CompleteOptions | StreamOptions): string {
  return createHash("sha256")
    .update(JSON.stringify([kind, opts.system, opts.user, "schema" in opts ? opts.schema : null, opts.maxTokens ?? null]))
    .digest("hex");
}

async function read<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(cacheDir(), `${key}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown) {
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(path.join(cacheDir(), `${key}.json`), JSON.stringify(value));
  } catch (err) {
    console.warn("[llm-cache] write failed:", (err as Error).message);
  }
}

/**
 * Caches successful responses on disk, keyed on a hash of the full prompt, so asking the
 * same question while building the UI does not spend the free-tier daily quota. Cached
 * streams are replayed in small pieces so the UI still streams. LLM_CACHE=off bypasses it.
 */
export function withCache(provider: LLMProvider): LLMProvider {
  if (process.env.LLM_CACHE === "off") return provider;

  return {
    name: provider.name,

    async complete<T>(opts: CompleteOptions): Promise<LLMResult<T>> {
      const key = cacheKey("complete", opts);
      const hit = await read<LLMResult<T>>(key);
      if (hit) return { data: hit.data, meta: { ...hit.meta, latencyMs: 0, cacheHit: true } };
      const result = await provider.complete<T>(opts);
      await write(key, result);
      return result;
    },

    async stream(opts: StreamOptions) {
      const key = cacheKey("stream", opts);
      const hit = await read<{ text: string; meta: LLMMeta }>(key);
      if (hit) {
        const started = Date.now();
        async function* replay() {
          for (const piece of hit!.text.match(/\S+\s*/g) ?? []) yield piece;
        }
        return streamWithMeta(replay(), () => ({ ...hit.meta, latencyMs: Date.now() - started, cacheHit: true }));
      }

      const live = await provider.stream(opts);
      let text = "";
      async function* record() {
        for await (const piece of live.textStream) {
          text += piece;
          yield piece;
        }
      }
      const recorded = streamWithMeta(record(), () => ({}) as LLMMeta);
      const meta = recorded.meta.then(async () => {
        const m = await live.meta;
        await write(key, { text, meta: m });
        return m;
      });
      meta.catch(() => {});
      return { textStream: recorded.textStream, meta };
    },
  };
}
