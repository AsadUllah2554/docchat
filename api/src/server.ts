import { count } from "drizzle-orm";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { documents } from "./db/schema.js";
import { getProvider } from "./llm/index.js";
import { getEmbedder } from "./rag/embed.js";
import { seed } from "./seed.js";

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL);

if (config.SEED_ON_BOOT) {
  // Deploys start with a working demo: schema, users and the corpus.
  await runMigrations(db);
  const [{ n }] = await db.select({ n: count() }).from(documents);
  if (n === 0) await seed(db, await getEmbedder(), config);
}

// Load the embedding model now rather than on the first question.
void getEmbedder().catch((err) => console.error("Embedding model failed to load:", err));

const app = createApp({ db, config, getEmbedder, getLLM: getProvider });
const server = app.listen(config.PORT, () => {
  console.log(`DocChat API on http://localhost:${config.PORT} (docs at /docs)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      await (await getEmbedder()).dispose();
      process.exit(0);
    });
  });
}
