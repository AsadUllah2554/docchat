import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunks, documents, queries } from "../src/db/schema.js";
import { getEmbedder } from "../src/rag/embed.js";
import { searchChunks } from "../src/rag/retrieve.js";
import { seed } from "../src/seed.js";
import { makeTestApp, parseSse, resetDb, scriptedLLM, testConfig } from "./helpers.js";

// The fake model answers with a citation to the first excerpt it was given.
const answering = scriptedLLM((opts) => {
  const id = opts.user.match(/\[chunk:(\d+)\]/)![1];
  return `Either party can end a retainer with thirty days' written notice. [chunk:${id}]`;
});
const { app, db, pool } = makeTestApp(answering.llm);

let memberToken: string;
let adminToken: string;

beforeAll(async () => {
  await resetDb(db);
  await seed(db, await getEmbedder(), testConfig, undefined, () => {});
  const login = (email: string, password: string) => request(app).post("/auth/login").send({ email, password });
  memberToken = (await login(testConfig.DEMO_EMAIL, testConfig.DEMO_PASSWORD)).body.token;
  adminToken = (await login(testConfig.ADMIN_EMAIL!, testConfig.ADMIN_PASSWORD!)).body.token;
});

afterAll(async () => {
  await pool.end();
});

describe("auth", () => {
  it("registers a member, then logs in with the same credentials", async () => {
    const creds = { email: "New.Person@Example.com", password: "a-long-password" };
    const reg = await request(app).post("/auth/register").send(creds);
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email: "new.person@example.com", role: "member" });

    const login = await request(app).post("/auth/login").send(creds);
    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));

    const dup = await request(app).post("/auth/register").send(creds);
    expect(dup.status).toBe(409);
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app).post("/auth/login").send({ email: testConfig.DEMO_EMAIL, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is missing or invalid (failure case 5)", async () => {
    expect((await request(app).get("/documents")).status).toBe(401);
    expect((await request(app).post("/query").send({ question: "anything at all" })).status).toBe(401);
    const bad = await request(app).get("/documents").set("Authorization", "Bearer not-a-jwt");
    expect(bad.status).toBe(401);
  });
});

describe("documents", () => {
  it("ingestion creates chunks with headings and token counts", async () => {
    const md = [
      "# Test Handbook",
      "",
      "## 1. Holidays",
      "",
      "Staff get twenty-eight days of paid holiday each year, including bank holidays. ".repeat(40),
      "",
      "## 2. Expenses",
      "",
      "Expenses over fifty pounds need a receipt and approval from a director before they are paid.",
    ].join("\n");
    const res = await request(app)
      .post("/documents")
      .set("Authorization", `Bearer ${memberToken}`)
      .attach("file", Buffer.from(md), "test-handbook.md");
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Test Handbook");
    expect(res.body.chunkCount).toBeGreaterThan(0);

    const inspect = await request(app).get(`/documents/${res.body.id}/chunks`).set("Authorization", `Bearer ${memberToken}`);
    expect(inspect.status).toBe(200);
    expect(inspect.body.chunks).toHaveLength(res.body.chunkCount);
    expect(res.body.chunkCount).toBeGreaterThan(1);
    // A chunk that starts mid-section records the heading above it.
    const headings = inspect.body.chunks.map((c: { sectionHeading: string }) => c.sectionHeading);
    expect(headings).toContain("1. Holidays");
    const expenses = inspect.body.chunks.find((c: { content: string }) => c.content.includes("receipt"));
    expect(expenses.label).toBe("2");
    for (const c of inspect.body.chunks) expect(c.tokenCount).toBeLessThanOrEqual(testConfig.CHUNK_TOKENS + 2);
  });

  it("rejects a file with no extractable text (failure case 3)", async () => {
    const res = await request(app)
      .post("/documents")
      .set("Authorization", `Bearer ${memberToken}`)
      .attach("file", Buffer.from("   \n\n  scan  \n"), "scan.txt");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No extractable text/);
  });

  it("forbids a member from deleting a document with 403 (failure case 6)", async () => {
    const doc = await db.query.documents.findFirst();
    const res = await request(app).delete(`/documents/${doc!.id}`).set("Authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
    expect(await db.query.documents.findFirst({ where: eq(documents.id, doc!.id) })).toBeTruthy();
  });

  it("lets an admin delete a document and its chunks", async () => {
    const doc = await db.query.documents.findFirst({ where: eq(documents.source, "client-onboarding-guide.md") });
    const res = await request(app).delete(`/documents/${doc!.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(chunks).where(eq(chunks.documentId, doc!.id))).toHaveLength(0);
  });
});

describe("retrieval", () => {
  it("returns the termination clause first for a question about ending a retainer", async () => {
    const embedder = await getEmbedder();
    const results = await searchChunks(db, await embedder.embedQuery("What is the notice period for terminating a retainer?"), 5);
    expect(results[0].documentTitle).toBe("Master Services Agreement");
    expect(results[0].content).toContain("thirty (30) days' written notice");
    expect(results[0].similarity).toBeGreaterThan(testConfig.SIMILARITY_THRESHOLD);
    // Best first
    expect(results.map((r) => r.similarity)).toEqual([...results.map((r) => r.similarity)].sort((a, b) => b - a));
  });
});

describe("POST /query", () => {
  it("streams sources before the answer, then meta, and logs the query", async () => {
    const res = await request(app)
      .post("/query")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ question: "What is the notice period for terminating a retainer?" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    const parts = parseSse(res.text);
    const types = parts.map((p) => p.type);
    expect(types.indexOf("data-sources")).toBeLessThan(types.indexOf("text-delta"));
    expect(types).toContain("data-meta");
    expect(types).not.toContain("data-refusal");

    const text = parts.filter((p) => p.type === "text-delta").map((p) => p.delta).join("");
    expect(text).toMatch(/thirty days/);
    const meta = parts.find((p) => p.type === "data-meta")!.data as { queryId: string; citedChunkIds: number[] };
    expect(meta.citedChunkIds).toHaveLength(1);

    const row = await db.query.queries.findFirst({ where: eq(queries.id, meta.queryId) });
    expect(row).toMatchObject({ refused: false, provider: "fake", inputTokens: 1000 });
    expect(row!.retrievedChunkIds).toHaveLength(5);
  });

  it("refuses a question outside the corpus without calling the model (failure cases 1 and 2)", async () => {
    const before = answering.calls.length;
    const res = await request(app)
      .post("/query")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ question: "Who won the 2022 football World Cup final?" });
    const parts = parseSse(res.text);

    const refusal = parts.find((p) => p.type === "data-refusal")!.data as { reason: string; topSimilarity: number; llmCalled: boolean };
    expect(refusal.reason).toBe("below_threshold");
    expect(refusal.llmCalled).toBe(false);
    expect(refusal.topSimilarity).toBeLessThan(testConfig.SIMILARITY_THRESHOLD);
    expect(parts.some((p) => p.type === "text-delta")).toBe(false);
    expect(answering.calls.length).toBe(before);

    const meta = parts.find((p) => p.type === "data-meta")!.data as { queryId: string };
    const row = await db.query.queries.findFirst({ where: eq(queries.id, meta.queryId) });
    expect(row).toMatchObject({ refused: true, refusalReason: "below_threshold", answer: null, provider: null });
  });

  it("validates the question", async () => {
    const res = await request(app).post("/query").set("Authorization", `Bearer ${memberToken}`).send({ question: "" });
    expect(res.status).toBe(400);
  });

  it("lists the caller's history with a refusal rate", async () => {
    const res = await request(app).get("/queries").set("Authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.total).toBeGreaterThanOrEqual(2);
    expect(res.body.stats.refused).toBeGreaterThanOrEqual(1);
  });
});

describe("model-level refusal", () => {
  it("turns a NOT_IN_DOCUMENTS reply into a refusal and streams no text", async () => {
    const refusing = scriptedLLM("NOT_IN_DOCUMENTS");
    const { app: refusingApp, pool: p2 } = makeTestApp(refusing.llm);
    const res = await request(refusingApp)
      .post("/query")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ question: "How much does managed hosting cost per month?" });
    await p2.end();

    const parts = parseSse(res.text);
    // Retrieval found related text, so the model was asked, and it declined.
    expect(refusing.calls).toHaveLength(1);
    expect((parts.find((p) => p.type === "data-refusal")!.data as { reason: string }).reason).toBe("model");
    expect(parts.some((p) => p.type === "text-delta")).toBe(false);
  });
});

describe("health and docs", () => {
  it("reports index status", async () => {
    const res = await request(app).get("/health");
    expect(res.body).toMatchObject({ status: "ok", dimensions: 384 });
    expect(res.body.chunks).toBeGreaterThan(0);
  });

  it("serves the OpenAPI spec", async () => {
    const res = await request(app).get("/openapi.json");
    expect(Object.keys(res.body.paths)).toContain("/documents/{id}/chunks");
  });
});
