import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireRole } from "../auth.js";
import type { AppDeps } from "../app.js";
import { chunks, documents } from "../db/schema.js";
import { citationLabel } from "../rag/chunk.js";
import { EMBEDDING_MAX_TOKENS } from "../rag/embedding-model.js";
import { fileToText, IngestError, ingestDocument } from "../rag/ingest.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
const idParam = z.object({ id: z.uuid("Document id must be a UUID") });

export function documentRoutes(deps: AppDeps) {
  const { db, config } = deps;
  const router = Router();

  router.get("/", async (_req, res) => {
    const docs = await db.select().from(documents).orderBy(asc(documents.title));
    const sizes = await db
      .select({ documentId: chunks.documentId, tokenCount: chunks.tokenCount })
      .from(chunks)
      .orderBy(asc(chunks.documentId), asc(chunks.chunkIndex));
    const byDoc = new Map<string, number[]>();
    for (const s of sizes) byDoc.set(s.documentId, [...(byDoc.get(s.documentId) ?? []), s.tokenCount]);

    res.json({
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        source: d.source,
        uploadedAt: d.uploadedAt,
        chunkCount: d.chunkCount,
        chunkTokenCounts: byDoc.get(d.id) ?? [],
      })),
      embeddingMaxTokens: EMBEDDING_MAX_TOKENS,
    });
  });

  router.post("/", (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File is over 5 MB. Upload a smaller file." });
        return;
      }
      if (err) return next(err);
      next();
    });
  }, async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Send the file as a multipart field named "file".' });
      return;
    }
    try {
      const text = await fileToText(req.file.originalname, new Uint8Array(req.file.buffer));
      const embedder = await deps.getEmbedder();
      const doc = await ingestDocument(
        db,
        embedder,
        { filename: req.file.originalname, text, title: typeof req.body?.title === "string" ? req.body.title : undefined, userId: req.user!.id },
        { maxTokens: config.CHUNK_TOKENS, overlapTokens: config.CHUNK_OVERLAP_TOKENS },
      );
      res.status(201).json(doc);
    } catch (err) {
      if (err instanceof IngestError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/:id/chunks", async (req, res) => {
    const { id } = idParam.parse(req.params);
    const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
    if (!doc) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const rows = await db
      .select({
        id: chunks.id,
        chunkIndex: chunks.chunkIndex,
        sectionHeading: chunks.sectionHeading,
        tokenCount: chunks.tokenCount,
        content: chunks.content,
      })
      .from(chunks)
      .where(eq(chunks.documentId, id))
      .orderBy(asc(chunks.chunkIndex));
    res.json({
      document: doc,
      settings: { chunkTokens: config.CHUNK_TOKENS, overlapTokens: config.CHUNK_OVERLAP_TOKENS, embeddingMaxTokens: EMBEDDING_MAX_TOKENS },
      chunks: rows.map((c) => ({ ...c, label: citationLabel(c.content, c.sectionHeading, c.chunkIndex) })),
    });
  });

  router.delete("/:id", requireRole("admin"), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [deleted] = await db.delete(documents).where(eq(documents.id, id)).returning({ id: documents.id });
    if (!deleted) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.status(204).end();
  });

  return router;
}
