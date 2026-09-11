/**
 * Recursive character splitting, written out rather than imported so every step can be
 * explained. The document is split on the coarsest separator first (section headings), and
 * any piece still over the size limit is split again on the next separator down. Pieces
 * are then packed into chunks of up to `maxTokens`, carrying `overlapTokens` of trailing
 * context into the next chunk. Every chunk records the nearest heading at or above its start.
 */

export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
  /** Token counter; pass the embedding model's tokenizer so sizes match what gets embedded. */
  countTokens?: (text: string) => number;
}

export interface TextChunk {
  content: string;
  chunkIndex: number;
  sectionHeading: string | null;
  /** Character offset in the source text, used to find the nearest heading. */
  start: number;
}

const SEPARATORS = ["\n## ", "\n### ", "\n#### ", "\n\n", "\n", ". ", " "];

/** ~4 characters per token for English prose; used when no tokenizer is passed in. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

interface Span {
  start: number;
  end: number;
}

/** Splits [start, end) into spans no longer than the limit, trying each separator in turn. */
function splitSpan(text: string, span: Span, maxTokens: number, seps: string[], count: (s: string) => number): Span[] {
  if (count(text.slice(span.start, span.end)) <= maxTokens) return [span];
  const [sep, ...rest] = seps;
  if (sep === undefined) {
    // No separators left: hard cut.
    const size = maxTokens * 4;
    const out: Span[] = [];
    for (let s = span.start; s < span.end; s += size) out.push({ start: s, end: Math.min(s + size, span.end) });
    return out;
  }

  // Cut before each separator so it stays attached to the text it introduces (e.g. a heading).
  const cuts = [span.start];
  for (let i = text.indexOf(sep, span.start + 1); i !== -1 && i < span.end; i = text.indexOf(sep, i + 1)) {
    cuts.push(sep === ". " ? i + 2 : i);
  }
  cuts.push(span.end);
  if (cuts.length === 2) return splitSpan(text, span, maxTokens, rest, count);

  const out: Span[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const piece = { start: cuts[i], end: cuts[i + 1] };
    if (piece.end > piece.start) out.push(...splitSpan(text, piece, maxTokens, rest, count));
  }
  return out;
}

/** Packs consecutive spans into chunks, with overlap taken from the end of the previous chunk. */
function packSpans(text: string, spans: Span[], maxTokens: number, overlapTokens: number, count: (s: string) => number): Span[] {
  const chunks: Span[] = [];
  let current: Span[] = [];
  const size = (xs: Span[]) => (xs.length ? count(text.slice(xs[0].start, xs[xs.length - 1].end)) : 0);

  for (const span of spans) {
    if (current.length && size([...current, span]) > maxTokens) {
      chunks.push({ start: current[0].start, end: current[current.length - 1].end });
      // Keep trailing spans that fit in the overlap budget.
      const carried: Span[] = [];
      for (let i = current.length - 1; i >= 0; i--) {
        if (size([current[i], ...carried]) > overlapTokens) break;
        carried.unshift(current[i]);
      }
      current = size([...carried, span]) > maxTokens ? [] : carried;
    }
    current.push(span);
  }
  if (current.length) chunks.push({ start: current[0].start, end: current[current.length - 1].end });
  return chunks;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/gm;

function headingsOf(text: string): { offset: number; level: number; title: string }[] {
  return [...text.matchAll(HEADING)].map((m) => ({ offset: m.index, level: m[1].length, title: m[2].trim() }));
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions): TextChunk[] {
  const text = markdown.replace(/\r\n/g, "\n");
  const headings = headingsOf(text);
  const count = opts.countTokens ?? estimateTokens;
  const pieces = splitSpan(text, { start: 0, end: text.length }, opts.maxTokens, SEPARATORS, count);
  const spans = packSpans(text, pieces, opts.maxTokens, opts.overlapTokens, count);

  return spans
    .map((span) => {
      const raw = text.slice(span.start, span.end);
      const lead = raw.length - raw.trimStart().length;
      const start = span.start + lead;
      const nearest = [...headings].reverse().find((h) => h.offset <= start);
      return { content: raw.trim(), start, sectionHeading: nearest?.title ?? null };
    })
    .filter((c) => c.content.length > 0)
    .map((c, chunkIndex) => ({ ...c, chunkIndex }));
}

/** The document's H1, if it has one. */
export function titleOf(markdown: string): string | null {
  return headingsOf(markdown).find((h) => h.level === 1)?.title ?? null;
}

/**
 * Plain text and PDF text have no markdown headings. Numbered lines such as
 * "4.2 Termination for convenience" become headings so they can be split and cited on.
 */
export function promoteNumberedHeadings(text: string): string {
  return text.replace(/^(\d+(?:\.\d+)*)\.?\s+([A-Z][^\n.]{2,80})$/gm, (_, num: string, title: string) => {
    const depth = Math.min(num.split(".").length + 1, 4);
    return `${"#".repeat(depth)} ${num}${num.includes(".") ? "" : "."} ${title}`;
  });
}

/**
 * Short label for citations, from the numbered headings inside the chunk: "4.2" for a chunk
 * within one section, "5–6" for a chunk that spans sections 5 and 6. Falls back to the
 * nearest heading's number, then to "¶n".
 */
export function citationLabel(content: string, sectionHeading: string | null, chunkIndex: number): string {
  const numbers = [...content.matchAll(/^#{1,6}\s+(\d+(?:\.\d+)*)/gm)].map((m) => m[1]);
  if (numbers.length) {
    const depth = Math.min(...numbers.map((n) => n.split(".").length));
    const top = numbers.filter((n) => n.split(".").length === depth);
    return top.length === 1 ? top[0] : `${top[0]}–${top[top.length - 1]}`;
  }
  return sectionHeading?.match(/^(\d+(?:\.\d+)*)/)?.[1] ?? `¶${chunkIndex + 1}`;
}
