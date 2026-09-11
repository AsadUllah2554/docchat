import { cosineDistance, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { chunks, documents } from "../db/schema.js";
import { citationLabel } from "./chunk.js";

export interface RetrievedChunk {
  id: number;
  documentId: string;
  documentTitle: string;
  sectionHeading: string | null;
  label: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
  similarity: number;
}

/** Top-k chunks by cosine similarity (1 - cosine distance), best first. */
export async function searchChunks(db: Db, queryEmbedding: number[], k: number): Promise<RetrievedChunk[]> {
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, queryEmbedding)})`;
  const rows = await db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      documentTitle: documents.title,
      sectionHeading: chunks.sectionHeading,
      chunkIndex: chunks.chunkIndex,
      tokenCount: chunks.tokenCount,
      content: chunks.content,
      similarity,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .orderBy(desc(similarity))
    .limit(k);

  return rows.map((r) => ({
    ...r,
    similarity: Number(r.similarity),
    label: citationLabel(r.content, r.sectionHeading, r.chunkIndex),
  }));
}
