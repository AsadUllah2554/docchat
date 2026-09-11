import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import type { Db } from "../db/client.js";
import { chunks, documents } from "../db/schema.js";
import { chunkMarkdown, promoteNumberedHeadings, titleOf, type ChunkOptions } from "./chunk.js";
import type { Embedder } from "./embed.js";

export const MIN_TEXT_CHARS = 100;
export const SUPPORTED_EXTENSIONS = [".md", ".markdown", ".txt", ".pdf"];

export class IngestError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

/** Turns an uploaded file into markdown-ish text with headings the chunker can use. */
export async function fileToText(filename: string, bytes: Uint8Array): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new IngestError(`Unsupported file type "${ext || "none"}". Upload .md, .txt or .pdf.`, 415);
  }
  if (ext === ".pdf") {
    let text: string;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      text = (await extractText(pdf, { mergePages: true })).text;
    } catch {
      throw new IngestError("This PDF could not be read. It may be damaged or password protected.");
    }
    return promoteNumberedHeadings(text);
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return ext === ".txt" ? promoteNumberedHeadings(text) : text;
}

export interface IngestInput {
  filename: string;
  text: string;
  title?: string;
  userId: string | null;
}

/**
 * Chunk, embed and store one document. Synchronous by design: there is no job queue,
 * and the corpus documents ingest in a few seconds.
 */
export async function ingestDocument(db: Db, embedder: Embedder, input: IngestInput, opts: ChunkOptions) {
  if (input.text.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
    throw new IngestError("No extractable text in this file. Scanned PDFs are not supported (no OCR).");
  }

  const title = input.title?.trim() || titleOf(input.text) || path.basename(input.filename, path.extname(input.filename));
  const pieces = chunkMarkdown(input.text, { countTokens: embedder.countTokens, ...opts });

  // The title and heading go into the embedded text (not the stored content), so a chunk
  // about "notice" still matches a question about "terminating a retainer".
  const vectors = await embedder.embedPassages(
    pieces.map((p) => [title, p.sectionHeading, p.content].filter(Boolean).join("\n")),
  );

  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({ title, source: input.filename, userId: input.userId, chunkCount: pieces.length })
      .returning();
    if (pieces.length) {
      await tx.insert(chunks).values(
        pieces.map((p, i) => ({
          documentId: doc.id,
          content: p.content,
          embedding: vectors[i],
          chunkIndex: p.chunkIndex,
          tokenCount: embedder.countTokens(p.content),
          sectionHeading: p.sectionHeading,
        })),
      );
    }
    return doc;
  });
}
