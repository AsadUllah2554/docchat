import cors from "cors";
import { sql } from "drizzle-orm";
import express, { type ErrorRequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { LLMProvider } from "./llm/index.js";
import { openapi } from "./openapi.js";
import type { Embedder } from "./rag/embed.js";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./rag/embedding-model.js";
import { authRoutes } from "./routes/auth.js";
import { documentRoutes } from "./routes/documents.js";
import { queryRoutes } from "./routes/query.js";

export interface AppDeps {
  db: Db;
  config: Config;
  getEmbedder: () => Promise<Embedder>;
  /** Resolved per request, so a missing API key fails one query, not the whole server. */
  getLLM: () => LLMProvider;
}

export function createApp(deps: AppDeps) {
  const { db, config } = deps;
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.WEB_ORIGIN.split(",").map((o) => o.trim()),
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", async (_req, res) => {
    try {
      const [row] = await db.execute<{ documents: number; chunks: number }>(
        sql`select (select count(*)::int from documents) as documents, (select count(*)::int from chunks) as chunks`,
      ).then((r) => r.rows);
      res.json({ status: "ok", ...row, embeddingModel: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, similarityThreshold: config.SIMILARITY_THRESHOLD });
    } catch {
      res.status(503).json({ status: "error", error: "Database unreachable" });
    }
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(openapi);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "DocChat API", swaggerOptions: { persistAuthorization: true } }));
  app.get("/", (_req, res) => res.redirect("/docs"));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Wait 15 minutes and try again." },
  });
  app.use("/auth", authLimiter, authRoutes(deps));

  const authed = requireAuth(config.JWT_SECRET);
  app.use("/documents", authed, documentRoutes(deps));
  app.use(authed, queryRoutes(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found. See /docs for the available endpoints." });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: z.prettifyError(err), issues: err.issues });
      return;
    }
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something failed on the server. Try again; if it keeps happening, check the API logs." });
  };
  app.use(onError);

  return app;
}
