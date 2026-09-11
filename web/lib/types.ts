import type { UIMessage } from "ai";

// Mirrors the data parts streamed by POST /query (api/src/rag/answer.ts).

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

export interface SourcesData {
  chunks: RetrievedChunk[];
  threshold: number;
  topSimilarity: number | null;
  retrievalMs: number;
}

export interface RefusalData {
  reason: "below_threshold" | "model";
  topSimilarity: number | null;
  threshold: number;
  llmCalled: boolean;
}

export interface MetaData {
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

export type ChatMessage = UIMessage<never, { sources: SourcesData; refusal: RefusalData; meta: MetaData }>;

export interface DocumentSummary {
  id: string;
  title: string;
  source: string;
  uploadedAt: string;
  chunkCount: number;
  chunkTokenCounts: number[];
}

export interface ChunkRow {
  id: number;
  chunkIndex: number;
  sectionHeading: string | null;
  label: string;
  tokenCount: number;
  content: string;
}

export interface QueryRow {
  id: string;
  question: string;
  answer: string | null;
  refused: boolean;
  refusalReason: "below_threshold" | "model" | null;
  topSimilarity: number | null;
  retrievedChunkIds: number[];
  provider: string | null;
  model: string | null;
  fallbackFrom: string | null;
  latencyMs: number;
  estimatedCost: number | null;
  error: string | null;
  createdAt: string;
}
