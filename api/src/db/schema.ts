import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "../rag/embedding-model.js";

export const roleEnum = pgEnum("role", ["member", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  hashedPassword: text("hashed_password").notNull(),
  role: roleEnum("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  /** Original filename. */
  source: text("source").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  chunkCount: integer("chunk_count").notNull().default(0),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
});

export const chunks = pgTable(
  "chunks",
  {
    // Serial, not UUID: the model cites chunks as [chunk:123], and short ids are copied reliably.
    id: serial("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    tokenCount: integer("token_count").notNull(),
    sectionHeading: text("section_heading"),
  },
  (t) => [
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunks_document_idx").on(t.documentId, t.chunkIndex),
  ],
);

export const queries = pgTable(
  "queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    answer: text("answer"),
    retrievedChunkIds: integer("retrieved_chunk_ids").array().notNull(),
    provider: text("provider"),
    model: text("model"),
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCost: doublePrecision("estimated_cost"),
    refused: boolean("refused").notNull().default(false),
    /** below_threshold: no LLM call was made. model: the model said the excerpts do not answer it. */
    refusalReason: text("refusal_reason"),
    topSimilarity: real("top_similarity"),
    /** Set when the provider was rate limited and the fallback served the answer. */
    fallbackFrom: text("fallback_from"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("queries_user_created_idx").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
