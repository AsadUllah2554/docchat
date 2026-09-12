# DocChat

Ask questions across your documents. Every answer cites its source. It says "I don't know" when it doesn't.

DocChat answers questions over a set of business documents, with retrieval you can see: the retrieved excerpts appear, with their similarity scores, before the answer starts, and every sentence of the answer links to the excerpt it came from. When the closest excerpt is below a similarity threshold, the API refuses **without calling the model at all**.

![Answer streaming with the sources panel open and a citation hovered](docs/screenshots/chat.png)

**Live demo:** https://docchat-eta.vercel.app · demo login `demo@docchat.dev` / `docchat-demo` (shown on the login screen) · **API docs:** `<api-url>/docs`

> The web app is deployed; the API needs a host that runs a Node process (see Deploying). Set `NEXT_PUBLIC_API_URL` to it and redeploy the web app.

## Numbers

Retrieval, from `npm run eval -- --sizes 300,500,800` in `api/`: 20 hand-written questions, 16 answerable from the corpus and 4 not. Full table in [`api/eval/results.md`](api/eval/results.md).

| Chunk size | Chunks | Hit@1 | Hit@5 | MRR | Chunks over the embedding window |
|---|---|---|---|---|---|
| 300 tokens | 31 | 69% | 94% | 0.79 | 0 |
| **500 tokens (default)** | 18 | **75%** | **100%** | **0.84** | 0 |
| 800 tokens | 13 | 50% | 94% | 0.66 | 8 of 13 |

- **800-token chunks lose.** `bge-small-en-v1.5` reads at most 512 tokens, so 8 of the 13 chunks had their tails cut off before embedding, and hit@1 dropped to 50%.
- **300-token chunks ranked the right chunk lower more often** (MRR 0.79 against 0.84). The question about owning the delivered work found its clause only at rank 8.
- **The refusal threshold is 0.60.** On these 20 questions the lowest answerable top match scored 0.647 and two of the four unanswerable questions scored 0.49 and 0.42, so those two are refused before any model call. The other two ("insurance", "hosting price") score 0.61–0.64 because the corpus has related text. They reach the model, which is instructed to reply `NOT_IN_DOCUMENTS` when the excerpts do not answer the question; that becomes a refusal too. The threshold was not tuned higher to catch them, because refusing a real question is worse than one extra model call.

Full pipeline, from `npm run eval -- --answers` against the deployed database with Groq serving the answers:

| Metric | Value |
|---|---|
| Answerable questions answered correctly | 16 of 16 |
| ...with an inline citation | 14 of 16 |
| Answerable questions wrongly refused | 0 of 16 |
| Unanswerable questions refused | 3 of 4 |
| Refusals made before any model call | 2 |
| Errors | 0 |
| Avg estimated cost per answered question | $0.0007 |
| Avg latency, answered questions | 21s |

Three of those need context.

**The fourth unanswerable question was not a failure.** Asked "how much does managed hosting
cost per month", the model answered "hosting is billed separately from the Retainer
[chunk:18]. However, the provided documents do not state the exact monthly cost" — the
supported part, with a citation, plus an explicit statement of what the documents do not say.
That is what the prompt asks for. Nothing was fabricated in any of the 20 answers.

**Two answers were correct but uncited.** Citation is instructed, not enforced, so the model
occasionally states a correct fact without the `[chunk:id]` tag. The UI reports the count of
cited sources under every answer, so an uncited answer is visible rather than silent.

**Latency** is dominated by free-tier waits: this run had exhausted Groq's daily token
allowance, so most questions waited for the time the provider asked for before being answered.
Retrieval itself takes about 0.5s, and an unthrottled answer streams in about 3 seconds.

## Failure cases

Each one is covered by a test in `api/tests/`.

1. **Question outside the corpus → explicit refusal, no fabricated answer.** There are two layers. Retrieval refuses clearly off-topic questions (case 2). For questions where related text exists but does not answer them, the model is told to reply with exactly `NOT_IN_DOCUMENTS`. The server holds back the first characters of every stream until it knows they are not that sentinel, so a refusal never flashes up as text, and logs it with `refusal_reason: model`.
2. **All retrieved chunks below the threshold → say so, do not answer.** If the best match scores under 0.60, the API streams a `data-refusal` part, logs `refused: true, refusal_reason: below_threshold`, and never calls the model. The UI shows the closest score and the threshold, and says no answer was generated.
3. **File with no extractable text → clear ingestion error.** Under 100 non-whitespace characters (a scanned PDF, an empty file) gives 422: "No extractable text in this file. Scanned PDFs are not supported (no OCR)."
4. **Provider rate limited → fallback, recorded.** On a 429 the provider's own retry hint is honoured (Groq's free tier caps tokens per minute and replies "try again in 18s"), capped at 20 seconds; otherwise exponential backoff. After two consecutive 429s the request moves to the other provider. This covers everything up to the first streamed token. `fallback_from` is stored on the Query row and shown under the answer.
5. **Unauthorised request → 401.** Every endpoint except `/auth/*`, `/health` and `/docs` needs a bearer token.
6. **Non-admin deleting a document → 403.** Registration only creates members; admins come from the seed.

## How it works

```
                          ┌──────────────── api/ (Express, Render) ────────────────┐
web/ (Next.js, Vercel)    │                                                        │
 useChat ── POST /query ──▶ embed question (bge-small, local) ─▶ pgvector top 5    │
                          │        │                                               │
   sources panel ◀── data-sources ◀┘   best < 0.60? ── yes ─▶ data-refusal (no LLM)│
                          │                  │ no                                  │
   answer + [4.2] ◀─ text-delta ◀── Gemini ⇄ Groq, chunks tagged [chunk:id]         │
                          │                  │                                     │
   meta line ◀──── data-meta ◀──── Query row: latency, tokens, cost, refused       │
                          └────────────────────────────────────────────────────────┘
```

**Retrieval is written by hand, with no LangChain,** in `api/src/rag/`, small enough to explain line by line:

- `chunk.ts`: recursive character splitting. The document is split on the coarsest separator first (`## ` headings, then `### `, paragraphs, lines, sentences, words), and each piece is packed into chunks of up to 500 tokens with 50 tokens of overlap. Sizes are counted with the embedding model's own tokenizer, so "500 tokens" means what the model sees. Each chunk stores the nearest heading at or above its start.
- `ingest.ts`: the document title and section heading are prepended to the text that gets embedded (not to the stored content), so a chunk about "notice" still matches a question about "ending a retainer".
- `retrieve.ts`: cosine distance with an HNSW index (`vector_cosine_ops`), top 5.
- `answer.ts`: the threshold check, the prompt with `[chunk:id]` tags, streaming, the sentinel check and the Query row.
- `prompt.ts`: the versioned answer prompt.

**Embeddings run locally** with `@huggingface/transformers` (`Xenova/bge-small-en-v1.5`, 384 dimensions, quantised to about 34 MB). There is no embedding API key and no embedding quota, and the tests use the real model. The vector column is sized from one constant, next to the model name, in `embedding-model.ts`.

**Streaming** uses the Vercel AI SDK UI message stream protocol, produced by Express with `createUIMessageStream` and consumed by `useChat`. Retrieved chunks arrive as a `data-sources` part before the first token, which is both how the pipeline actually runs and what the sources panel shows.

**Citations** are labelled by section. A chunk that sits inside §4.2 cites as `[4.2]`, and one that spans §5 and §6 cites as `[5–6]`. Hovering a citation outlines its source card; clicking scrolls to it.

The provider module (`api/src/llm/`) is shared with DocExtract, plus `stream()`: one interface, Gemini and Groq implementations, retry, fallback and an on-disk response cache.

## API

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/auth/register` | | Create a member account |
| POST | `/auth/login` | | Get a JWT |
| POST | `/documents` | member | Upload `.md`, `.txt` or `.pdf`; chunk, embed, store |
| GET | `/documents` | member | Documents with chunk counts and chunk sizes |
| GET | `/documents/:id/chunks` | member | Inspect the chunking |
| DELETE | `/documents/:id` | admin | Delete a document and its chunks |
| POST | `/query` | member | SSE: sources, answer, meta; or a refusal |
| GET | `/queries` | member | History, refusal rate, latency, cost |
| GET | `/health` | | Index status |

OpenAPI 3.1 spec at `/openapi.json`, Swagger UI at `/docs`. Rate limits: 30 auth attempts per 15 minutes per IP, and 30 questions per 10 minutes per user.

## Stack

**API:** Express 5, TypeScript, Zod, Drizzle ORM with committed migrations, Postgres + pgvector (Neon), transformers.js, JWT + bcrypt, express-rate-limit, Helmet, swagger-ui-express, Vitest + Supertest. Deployed on Render.

**Web:** Next.js 16, React 19, Tailwind CSS 4, Vercel AI SDK (`useChat`). Deployed on Vercel.

**Models:** Groq `openai/gpt-oss-20b` as primary, Gemini 3.6 Flash as fallback. Groq is primary because Gemini's free tier gives a small daily allowance; either can lead by setting `LLM_PROVIDER`.

## Setup

Needs Node 20.19+ and Postgres with pgvector.

```bash
# API
cd api
npm install
cp .env.example .env         # DATABASE_URL, JWT_SECRET, GEMINI_API_KEY
npm run db:migrate           # enables pgvector, creates tables
npm run seed                 # demo + admin users, ingests ../corpus
npm run dev                  # http://localhost:4000/docs

# Web
cd ../web
npm install
cp .env.example .env.local
npm run dev -- -p 3200       # http://localhost:3200
```

```bash
cd api
npm test                              # 25 tests; needs DATABASE_URL_TEST (pgvector), no API keys
npm run eval -- --sizes 300,500,800   # retrieval + chunk-size comparison, no API keys
npm run eval -- --answers             # full pipeline with the live model
```

Without an API key, retrieval, the sources panel and below-threshold refusals all work; only the answer text needs a model.

### Deploying

1. **Database:** create a Postgres database with pgvector available — Neon or Supabase both work — and put its pooled connection string in `DATABASE_URL`. `npm run db:migrate` enables the `vector` extension itself.
2. **API:** any host that runs a Node process works. The service uses about 260 MB of memory once the embedding model is loaded, so a 512 MB free instance is enough. `render.yaml` is ready for Render: create a Blueprint from it, then set `DATABASE_URL`, `WEB_ORIGIN` (the Vercel URL), `GEMINI_API_KEY`, `GROQ_API_KEY`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`. With `SEED_ON_BOOT=true` the first boot runs migrations, creates the demo user and ingests the corpus, so the demo works immediately. The build step downloads the embedding model.
3. **Web:** import the repo into Vercel with root directory `web`, and set `NEXT_PUBLIC_API_URL` to the Render URL.

## Corpus

`corpus/` holds six documents for a **fictional** agency, Fieldwork Studio: a master services agreement, retainer terms, a privacy notice, a delivery handbook, a security policy and an onboarding guide. They were written for this demo, with numbered clauses and cross-references between documents ("see clause 3.4 of the Master Services Agreement"). They also have deliberate gaps (insurance, nonprofit pricing, hosting prices) so refusals can be shown. Replace them with any markdown files and restart with an empty database.

## Free-tier caveat

The demo runs on free tiers. Render's free web services sleep after 15 minutes idle, so the first request can take 30–60 seconds while the API wakes and loads the embedding model. The free tiers are the binding constraint: Groq allows 8,000 tokens a minute (about two questions), and Gemini's free tier allows 20 requests a day for `gemini-3.6-flash`, which is why Groq leads and the cheaper `gemini-3.5-flash-lite` is the fallback. A 429 waits for the time the provider asks for, so a burst of questions queues rather than failing. When both are spent, retrieval, sources and refusals keep working and only the generated answer fails. Neon's free tier suspends an idle database, so the first query after a quiet spell waits for it to wake. Uploaded documents are visible to every demo user, so do not upload anything private.

## Known issues

- On macOS, stopping the API can print `libc++abi: mutex lock failed` after the server has already closed. It comes from onnxruntime-node tearing down its thread pool at process exit and does not affect requests.
