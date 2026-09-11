import type { RetrievedChunk } from "./retrieve.js";

export const PROMPT_VERSION = "answer-v1";

/** The model replies with exactly this when the excerpts do not answer the question. */
export const NOT_IN_DOCUMENTS = "NOT_IN_DOCUMENTS";

export const ANSWER_SYSTEM_PROMPT = `You answer questions about a set of business documents, using only the excerpts provided with each question.

Rules:
1. Use only the excerpts. Do not use outside knowledge, and do not guess at terms that are not written down.
2. Cite every statement inline with the tag of the excerpt it comes from, exactly as written, e.g. [chunk:12]. Put the tag straight after the sentence it supports. Use several tags if a sentence draws on several excerpts.
3. If the excerpts do not contain the answer, reply with exactly ${NOT_IN_DOCUMENTS} and nothing else.
4. If the excerpts answer only part of the question, answer that part and say plainly which part the documents do not cover.
5. When an excerpt refers to another clause that is also provided, use both. When it refers to a clause that is not provided, say that the answer depends on that clause.
6. Be direct: one to four sentences for most questions. Plain prose, no headings, no preamble such as "According to the documents".`;

export function buildAnswerPrompt(question: string, retrieved: RetrievedChunk[]): string {
  const excerpts = retrieved
    .map((c) => `[chunk:${c.id}] ${c.documentTitle}${c.sectionHeading ? ` — ${c.sectionHeading}` : ""}\n${c.content}`)
    .join("\n\n---\n\n");
  return `Excerpts:\n\n${excerpts}\n\n---\n\nQuestion: ${question}`;
}

/** Chunk ids the answer actually cites, in order of first use. */
export function citedChunkIds(answer: string): number[] {
  return [...new Set([...answer.matchAll(/\[chunk:(\d+)\]/g)].map((m) => Number(m[1])))];
}
