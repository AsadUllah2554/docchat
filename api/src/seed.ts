import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { documents, users } from "./db/schema.js";
import type { Embedder } from "./rag/embed.js";
import { CORPUS_DIR } from "./paths.js";
import { ingestDocument } from "./rag/ingest.js";

export { CORPUS_DIR };

async function upsertUser(db: Db, email: string, password: string, role: "member" | "admin") {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return existing;
  const [user] = await db.insert(users).values({ email, hashedPassword: await hashPassword(password), role }).returning();
  return user;
}

/** Creates the demo and admin users, and ingests every corpus file not already indexed. */
export async function seed(db: Db, embedder: Embedder, config: Config, corpusDir = CORPUS_DIR, log = console.log) {
  await upsertUser(db, config.DEMO_EMAIL, config.DEMO_PASSWORD, "member");
  const admin =
    config.ADMIN_EMAIL && config.ADMIN_PASSWORD ? await upsertUser(db, config.ADMIN_EMAIL, config.ADMIN_PASSWORD, "admin") : null;
  if (!admin) log("ADMIN_EMAIL/ADMIN_PASSWORD not set: no admin account created");

  const files = (await readdir(corpusDir)).filter((f) => f.endsWith(".md")).sort();
  for (const file of files) {
    const already = await db.query.documents.findFirst({ where: eq(documents.source, file) });
    if (already) continue;
    const text = await readFile(path.join(corpusDir, file), "utf8");
    const doc = await ingestDocument(
      db,
      embedder,
      { filename: file, text, userId: admin?.id ?? null },
      { maxTokens: config.CHUNK_TOKENS, overlapTokens: config.CHUNK_OVERLAP_TOKENS },
    );
    log(`Ingested ${file}: ${doc.chunkCount} chunks`);
  }
}
