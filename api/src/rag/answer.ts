import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { queries } from "../db/schema.js";
import { ProviderError, type LLMMeta, type LLMProvider } from "../llm/index.js";
import type { Embedder } from "./embed.js";
import { ANSWER_SYSTEM_PROMPT, buildAnswerPrompt, citedChunkIds, NOT_IN_DOCUMENTS } from "./prompt.js";
import { searchChunks, type RetrievedChunk } from "./retrieve.js";

export interface SourcesEvent {
  chunks: RetrievedChunk[];
  threshold: number;
  topSimilarity: number | null;
  retrievalMs: number;
}

export interface RefusalEvent {
  reason: "below_threshold" | "model";
  topSimilarity: number | null;
  threshold: number;
  /** False when the refusal happened before any model call. */
  llmCalled: boolean;
}

export interface MetaEvent {
  queryId: string;
  latencyMs: number;
  retrievalMs: number;
  refused: boolean;
  citedChunkIds: number[];
  provider: string | null;
  model: string | null;
  fallbackFrom: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  cacheHit: boolean;
}

export type QueryEvent =
  | { type: "sources"; data: SourcesEvent }
  | { type: "refusal"; data: RefusalEvent }
  | { type: "text"; delta: string }
  | { type: "meta"; data: MetaEvent }
  | { type: "error"; message: string };

export interface QueryDeps {
  db: Db;
  embedder: Embedder;
  getLLM: () => LLMProvider;
  threshold: number;
  topK: number;
}

/**
 * The retrieval pipeline for one question:
 * embed → top-k cosine search → refuse below threshold (no LLM call) → prompt with tagged
 * chunks → stream the answer → log the Query row. Sources are emitted before any text.
 */
export async function runQuery(
  deps: QueryDeps,
  input: { question: string; userId: string | null },
  emit: (event: QueryEvent) => void,
): Promise<MetaEvent> {
  const started = Date.now();
  const queryId = randomUUID();

  // 1–2. Embed the question with the same model as the chunks, then search.
  const embedding = await deps.embedder.embedQuery(input.question);
  const retrieved = await searchChunks(deps.db, embedding, deps.topK);
  const retrievalMs = Date.now() - started;
  const topSimilarity = retrieved[0]?.similarity ?? null;
  emit({ type: "sources", data: { chunks: retrieved, threshold: deps.threshold, topSimilarity, retrievalMs } });

  const record = async (fields: {
    answer: string | null;
    refused: boolean;
    refusalReason?: RefusalEvent["reason"];
    meta?: LLMMeta;
    error?: string;
    cited?: number[];
  }): Promise<MetaEvent> => {
    const latencyMs = Date.now() - started;
    await deps.db.insert(queries).values({
      id: queryId,
      userId: input.userId,
      question: input.question,
      answer: fields.answer,
      retrievedChunkIds: retrieved.map((c) => c.id),
      provider: fields.meta?.provider || null,
      model: fields.meta?.model || null,
      latencyMs,
      inputTokens: fields.meta?.inputTokens ?? null,
      outputTokens: fields.meta?.outputTokens ?? null,
      estimatedCost: fields.meta?.estimatedCost ?? null,
      refused: fields.refused,
      refusalReason: fields.refusalReason ?? null,
      topSimilarity,
      fallbackFrom: fields.meta?.fallbackFrom ?? null,
      error: fields.error ?? null,
    });
    const meta: MetaEvent = {
      queryId,
      latencyMs,
      retrievalMs,
      refused: fields.refused,
      citedChunkIds: fields.cited ?? [],
      provider: fields.meta?.provider || null,
      model: fields.meta?.model || null,
      fallbackFrom: fields.meta?.fallbackFrom ?? null,
      inputTokens: fields.meta?.inputTokens ?? null,
      outputTokens: fields.meta?.outputTokens ?? null,
      estimatedCost: fields.meta?.estimatedCost ?? null,
      cacheHit: Boolean(fields.meta?.cacheHit),
    };
    emit({ type: "meta", data: meta });
    return meta;
  };

  // 3. Nothing close enough: refuse without spending a model call.
  if (topSimilarity === null || topSimilarity < deps.threshold) {
    emit({ type: "refusal", data: { reason: "below_threshold", topSimilarity, threshold: deps.threshold, llmCalled: false } });
    return record({ answer: null, refused: true, refusalReason: "below_threshold" });
  }

  // 4. Stream the grounded answer.
  let answer = "";
  try {
    const stream = await deps.getLLM().stream({
      system: ANSWER_SYSTEM_PROMPT,
      user: buildAnswerPrompt(input.question, retrieved),
      maxTokens: 800,
    });

    // Hold back the first few characters until we know they are not the refusal sentinel.
    let pending = "";
    let decided = false;
    let modelRefused = false;
    for await (const delta of stream.textStream) {
      answer += delta;
      if (decided) {
        if (!modelRefused) emit({ type: "text", delta });
        continue;
      }
      pending += delta;
      const head = pending.trimStart();
      if (head.startsWith(NOT_IN_DOCUMENTS)) {
        decided = modelRefused = true;
      } else if (!NOT_IN_DOCUMENTS.startsWith(head)) {
        decided = true;
        emit({ type: "text", delta: head });
      }
    }
    if (!decided && pending.trim() && !NOT_IN_DOCUMENTS.startsWith(pending.trim())) emit({ type: "text", delta: pending.trimStart() });
    if (!decided && pending.trim() === NOT_IN_DOCUMENTS) modelRefused = true;

    const meta = await stream.meta;
    if (modelRefused) {
      emit({ type: "refusal", data: { reason: "model", topSimilarity, threshold: deps.threshold, llmCalled: true } });
      return record({ answer: null, refused: true, refusalReason: "model", meta });
    }
    return record({ answer: answer.trim(), refused: false, meta, cited: citedChunkIds(answer) });
  } catch (err) {
    let message = "The answer could not be generated. Try again.";
    if (err instanceof ProviderError) {
      message = `The model provider is unavailable${err.isRateLimit ? " (rate limited)" : ""}. Try again in a minute.`;
    } else if (/API_KEY is not set/.test((err as Error).message)) {
      message = "No model provider is configured on the server, so answers cannot be generated. Retrieval and refusals still work.";
    }
    console.error("[query]", queryId, err);
    emit({ type: "error", message });
    return record({ answer: answer.trim() || null, refused: false, error: (err as Error).message });
  }
}
