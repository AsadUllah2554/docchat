import { createUIMessageStream, pipeUIMessageStreamToResponse } from "ai";
import { rateLimit } from "express-rate-limit";
import { desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { queries } from "../db/schema.js";
import { runQuery } from "../rag/answer.js";

const body = z.object({ question: z.string().trim().min(3, "Ask a longer question").max(1000) });

export function queryRoutes(deps: AppDeps) {
  const { db, config } = deps;
  const router = Router();

  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: config.RATE_LIMIT_QUERIES_PER_10_MIN,
    keyGenerator: (req) => req.user!.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many questions. Wait a few minutes and try again." },
  });

  /**
   * Streams the answer as a Vercel AI SDK UI message stream (SSE). Retrieved chunks arrive
   * first as a `data-sources` part, then the answer text, then a `data-meta` part. A refusal
   * arrives as `data-refusal` with no text.
   */
  router.post("/query", limiter, async (req, res) => {
    const { question } = body.parse(req.body);
    const embedder = await deps.getEmbedder();

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        const textId = "answer";
        let textStarted = false;
        await runQuery(
          { db, embedder, getLLM: deps.getLLM, threshold: config.SIMILARITY_THRESHOLD, topK: config.TOP_K },
          { question, userId: req.user!.id },
          (event) => {
            switch (event.type) {
              case "sources":
                writer.write({ type: "data-sources", data: event.data });
                break;
              case "refusal":
                writer.write({ type: "data-refusal", data: event.data });
                break;
              case "text":
                if (!textStarted) {
                  writer.write({ type: "text-start", id: textId });
                  textStarted = true;
                }
                writer.write({ type: "text-delta", id: textId, delta: event.delta });
                break;
              case "meta":
                if (textStarted) writer.write({ type: "text-end", id: textId });
                writer.write({ type: "data-meta", data: event.data });
                break;
              case "error":
                writer.write({ type: "error", errorText: event.message });
                break;
            }
          },
        );
        writer.write({ type: "finish" });
      },
      onError: () => "The answer could not be generated. Try again.",
    });
    pipeUIMessageStreamToResponse({ response: res, stream });
  });

  /** The caller's recent questions, with the numbers the demo reports. */
  router.get("/queries", async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
    const scope = req.user!.role === "admin" && req.query.all === "true" ? undefined : eq(queries.userId, req.user!.id);

    const [rows, [stats]] = await Promise.all([
      db
        .select({
          id: queries.id,
          question: queries.question,
          answer: queries.answer,
          refused: queries.refused,
          refusalReason: queries.refusalReason,
          topSimilarity: queries.topSimilarity,
          retrievedChunkIds: queries.retrievedChunkIds,
          provider: queries.provider,
          model: queries.model,
          fallbackFrom: queries.fallbackFrom,
          latencyMs: queries.latencyMs,
          estimatedCost: queries.estimatedCost,
          error: queries.error,
          createdAt: queries.createdAt,
        })
        .from(queries)
        .where(scope)
        .orderBy(desc(queries.createdAt))
        .limit(limit),
      db
        .select({
          total: sql<number>`count(*)::int`,
          refused: sql<number>`count(*) filter (where ${queries.refused})::int`,
          avgLatencyMs: sql<number | null>`round(avg(${queries.latencyMs}))::int`,
          avgCost: sql<number | null>`avg(${queries.estimatedCost}) filter (where ${queries.estimatedCost} is not null)`,
        })
        .from(queries)
        .where(scope),
    ]);
    res.json({ queries: rows, stats: { ...stats, avgCost: stats.avgCost === null ? null : Number(stats.avgCost) } });
  });

  return router;
}
