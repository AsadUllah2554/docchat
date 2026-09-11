/**
 * Evaluates retrieval and refusal against eval/questions.json (16 answerable, 4 not).
 *
 *   npm run eval                        # retrieval at CHUNK_TOKENS, in memory, no API key
 *   npm run eval -- --sizes 300,500,800 # chunk-size comparison
 *   npm run eval -- --answers           # also run the full pipeline against DATABASE_URL (needs an LLM key)
 *
 * Retrieval runs on an in-memory index built from ./corpus, so chunk sizes can be compared
 * without touching the database. Writes eval/results.md.
 */
import "dotenv/config";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { getProvider } from "../src/llm/index.js";
import { runQuery, type MetaEvent, type RefusalEvent, type SourcesEvent } from "../src/rag/answer.js";
import { chunkMarkdown, titleOf } from "../src/rag/chunk.js";
import { getEmbedder, type Embedder } from "../src/rag/embed.js";
import { EMBEDDING_MAX_TOKENS } from "../src/rag/embedding-model.js";
import { CORPUS_DIR } from "../src/seed.js";

interface Question {
  question: string;
  source?: string;
  contains?: string;
  answerable?: boolean;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const config = getConfig();
const questions: Question[] = JSON.parse(await readFile(new URL("../eval/questions.json", import.meta.url), "utf8"));
const answerable = questions.filter((q) => q.answerable !== false);
const unanswerable = questions.filter((q) => q.answerable === false);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

interface IndexedChunk {
  source: string;
  content: string;
  tokens: number;
  vector: number[];
}

async function buildIndex(embedder: Embedder, maxTokens: number): Promise<IndexedChunk[]> {
  const out: IndexedChunk[] = [];
  for (const file of (await readdir(CORPUS_DIR)).filter((f) => f.endsWith(".md")).sort()) {
    const text = await readFile(path.join(CORPUS_DIR, file), "utf8");
    const title = titleOf(text) ?? file;
    const pieces = chunkMarkdown(text, { maxTokens, overlapTokens: config.CHUNK_OVERLAP_TOKENS, countTokens: embedder.countTokens });
    const vectors = await embedder.embedPassages(pieces.map((p) => [title, p.sectionHeading, p.content].filter(Boolean).join("\n")));
    pieces.forEach((p, i) => out.push({ source: file, content: p.content, tokens: embedder.countTokens(p.content), vector: vectors[i] }));
  }
  return out;
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

async function retrievalEval(embedder: Embedder, size: number) {
  const index = await buildIndex(embedder, size);
  const k = config.TOP_K;
  const scored = await Promise.all(
    questions.map(async (q) => {
      const v = await embedder.embedQuery(q.question);
      const ranked = index.map((c) => ({ c, sim: dot(v, c.vector) })).sort((a, b) => b.sim - a.sim);
      const rank = q.contains ? ranked.findIndex((r) => r.c.source === q.source && r.c.content.includes(q.contains!)) : -1;
      return { q, top: ranked[0].sim, rank };
    }),
  );
  const ans = scored.filter((s) => s.q.answerable !== false);
  const un = scored.filter((s) => s.q.answerable === false);

  // Threshold sweep: the best split between answerable and unanswerable top similarities.
  const sweep = Array.from({ length: 41 }, (_, i) => 0.4 + i * 0.01).map((t) => ({
    t,
    correct: ans.filter((s) => s.top >= t).length + un.filter((s) => s.top < t).length,
  }));
  const best = sweep.reduce((a, b) => (b.correct > a.correct ? b : a));

  return {
    size,
    chunks: index.length,
    avgTokens: Math.round(index.reduce((s, c) => s + c.tokens, 0) / index.length),
    overWindow: index.filter((c) => c.tokens > EMBEDDING_MAX_TOKENS).length,
    hit1: ans.filter((s) => s.rank === 0).length,
    hitK: ans.filter((s) => s.rank >= 0 && s.rank < k).length,
    mrr: ans.reduce((s, x) => s + (x.rank >= 0 ? 1 / (x.rank + 1) : 0), 0) / ans.length,
    refusedCorrectly: un.filter((s) => s.top < config.SIMILARITY_THRESHOLD).length,
    answeredWrongly: ans.filter((s) => s.top < config.SIMILARITY_THRESHOLD).length,
    bestThreshold: best.t,
    bestThresholdCorrect: best.correct,
    detail: scored,
  };
}

async function answerEval(embedder: Embedder) {
  const { db, pool } = createDb(config.DATABASE_URL);
  const rows = [];
  for (const q of questions) {
    let sources: SourcesEvent | undefined;
    let refusal: RefusalEvent | undefined;
    let error: string | undefined;
    let text = "";
    const meta: MetaEvent = await runQuery(
      { db, embedder, getLLM: getProvider, threshold: config.SIMILARITY_THRESHOLD, topK: config.TOP_K },
      { question: q.question, userId: null },
      (e) => {
        if (e.type === "sources") sources = e.data;
        if (e.type === "refusal") refusal = e.data;
        if (e.type === "text") text += e.delta;
        if (e.type === "error") error = e.message;
      },
    );
    const citedOk =
      q.contains && meta.citedChunkIds.some((id) => sources?.chunks.find((c) => c.id === id)?.content.includes(q.contains!));
    rows.push({ q, meta, refusal, error, text, citedOk: Boolean(citedOk) });
    console.log(`${meta.refused ? `refused (${refusal?.reason})` : error ? "error" : "answered"}  ${meta.latencyMs}ms  ${q.question}`);
    if (!meta.refused && !meta.cacheHit) await new Promise((r) => setTimeout(r, Number(process.env.EVAL_DELAY_MS ?? 4000)));
  }
  await pool.end();

  const live = rows.filter((r) => !r.meta.cacheHit);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const ansRows = rows.filter((r) => r.q.answerable !== false);
  const unRows = rows.filter((r) => r.q.answerable === false);
  return {
    answeredCorrectlyCited: ansRows.filter((r) => !r.meta.refused && r.citedOk).length,
    answerableRefused: ansRows.filter((r) => r.meta.refused).length,
    refusalAccuracy: unRows.filter((r) => r.meta.refused).length,
    refusalsWithoutLLM: rows.filter((r) => r.refusal?.reason === "below_threshold").length,
    modelRefusals: rows.filter((r) => r.refusal?.reason === "model").length,
    errors: rows.filter((r) => r.error).length,
    avgLatencyMs: Math.round(avg(live.map((r) => r.meta.latencyMs))),
    avgAnsweredLatencyMs: Math.round(avg(live.filter((r) => !r.meta.refused).map((r) => r.meta.latencyMs))),
    avgCost: avg(live.filter((r) => r.meta.estimatedCost !== null).map((r) => r.meta.estimatedCost!)),
    rows,
  };
}

const embedder = await getEmbedder();
const sizes = (option("sizes") ?? String(config.CHUNK_TOKENS)).split(",").map(Number);
const retrieval: Awaited<ReturnType<typeof retrievalEval>>[] = [];
for (const size of sizes) retrieval.push(await retrievalEval(embedder, size));

const md: string[] = [
  "# Eval results",
  "",
  `${answerable.length} answerable questions, ${unanswerable.length} the corpus cannot answer. Top-k = ${config.TOP_K}, similarity threshold = ${config.SIMILARITY_THRESHOLD}, overlap = ${config.CHUNK_OVERLAP_TOKENS} tokens, embedding model window = ${EMBEDDING_MAX_TOKENS} tokens.`,
  "",
  "## Retrieval",
  "",
  "| Chunk size | Chunks | Avg tokens | Over model window | Hit@1 | Hit@5 | MRR | Unanswerable refused | Answerable wrongly refused | Best threshold |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...retrieval.map(
    (r) =>
      `| ${r.size} | ${r.chunks} | ${r.avgTokens} | ${r.overWindow} | ${pct(r.hit1, answerable.length)} | ${pct(r.hitK, answerable.length)} | ${r.mrr.toFixed(2)} | ${r.refusedCorrectly}/${unanswerable.length} | ${r.answeredWrongly}/${answerable.length} | ${r.bestThreshold.toFixed(2)} (${r.bestThresholdCorrect}/${questions.length}) |`,
  ),
  "",
  "### Top similarity per question",
  "",
  `| Question | ${retrieval.map((r) => `${r.size}: top sim / rank`).join(" | ")} |`,
  `|---|${retrieval.map(() => "---").join("|")}|`,
  ...questions.map(
    (q, i) =>
      `| ${q.question}${q.answerable === false ? " _(not in corpus)_" : ""} | ${retrieval
        .map((r) => {
          const d = r.detail[i];
          return `${d.top.toFixed(3)} / ${q.answerable === false ? "—" : d.rank >= 0 ? d.rank + 1 : "miss"}`;
        })
        .join(" | ")} |`,
  ),
  "",
];

if (flag("answers")) {
  const a = await answerEval(embedder);
  md.push(
    "## Full pipeline",
    "",
    `Run against the indexed database with the live model (${a.rows.find((r) => r.meta.model)?.meta.model ?? "no model"}).`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Answerable questions answered with a correct citation | ${a.answeredCorrectlyCited}/${answerable.length} |`,
    `| Answerable questions wrongly refused | ${a.answerableRefused}/${answerable.length} |`,
    `| Unanswerable questions refused | ${a.refusalAccuracy}/${unanswerable.length} |`,
    `| Refusals made without calling the model | ${a.refusalsWithoutLLM} |`,
    `| Refusals made by the model (NOT_IN_DOCUMENTS) | ${a.modelRefusals} |`,
    `| Refusal rate overall | ${pct(a.rows.filter((r) => r.meta.refused).length, a.rows.length)} |`,
    `| Errors | ${a.errors} |`,
    `| Avg latency, all questions | ${(a.avgLatencyMs / 1000).toFixed(2)}s |`,
    `| Avg latency, answered questions | ${(a.avgAnsweredLatencyMs / 1000).toFixed(2)}s |`,
    `| Avg estimated cost per answered question | $${a.avgCost.toFixed(5)} |`,
    "",
  );
}

await writeFile(new URL("../eval/results.md", import.meta.url), md.join("\n"));
console.log(md.join("\n"));
