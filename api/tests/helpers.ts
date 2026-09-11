import "dotenv/config";
import { sql } from "drizzle-orm";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { streamWithMeta, type LLMProvider, type StreamOptions } from "../src/llm/index.js";
import { getEmbedder } from "../src/rag/embed.js";

export const testConfig: Config = {
  NODE_ENV: "test",
  PORT: 0,
  DATABASE_URL: process.env.DATABASE_URL_TEST!,
  JWT_SECRET: "test-secret-that-is-long-enough-123",
  JWT_EXPIRES_IN: "1h",
  WEB_ORIGIN: "http://localhost:3200",
  SIMILARITY_THRESHOLD: 0.6,
  TOP_K: 5,
  CHUNK_TOKENS: 500,
  CHUNK_OVERLAP_TOKENS: 50,
  ADMIN_EMAIL: "admin@test.local",
  ADMIN_PASSWORD: "admin-password",
  DEMO_EMAIL: "demo@test.local",
  DEMO_PASSWORD: "demo-password",
  SEED_ON_BOOT: false,
  RATE_LIMIT_QUERIES_PER_10_MIN: 1000,
};

/** A fake LLM that streams a scripted reply and records every prompt it was given. */
export function scriptedLLM(reply: string | ((opts: StreamOptions) => string)) {
  const calls: StreamOptions[] = [];
  const llm: LLMProvider = {
    name: "fake",
    complete: async () => {
      throw new Error("not used");
    },
    stream: async (opts) => {
      calls.push(opts);
      const text = typeof reply === "function" ? reply(opts) : reply;
      async function* pieces() {
        for (const piece of text.match(/.{1,6}/gs) ?? []) yield piece;
      }
      return streamWithMeta(pieces(), () => ({
        provider: "fake",
        model: "fake-1",
        inputTokens: 1000,
        outputTokens: 40,
        latencyMs: 10,
        estimatedCost: 0.0004,
        attempts: 1,
      }));
    },
  };
  return { llm, calls };
}

export function makeTestApp(llm: LLMProvider) {
  const { db, pool } = createDb(testConfig.DATABASE_URL);
  const app = createApp({ db, config: testConfig, getEmbedder, getLLM: () => llm });
  return { app, db, pool };
}

export async function resetDb(db: Db) {
  await db.execute(sql`truncate table queries, chunks, documents, users restart identity cascade`);
}

/** Parses a UI message stream (SSE) body into its JSON parts. */
export function parseSse(body: string): { type: string; [k: string]: unknown }[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
}
