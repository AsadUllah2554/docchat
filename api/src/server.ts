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

// Schema first: this is fast DDL, and /health reads the documents and chunks tables.
if (config.SEED_ON_BOOT) await runMigrations(db);

const app = createApp({ db, config, getEmbedder, getLLM: getProvider });
const server = app.listen(config.PORT, () => {
  console.log(`DocChat API on http://localhost:${config.PORT} (docs at /docs)`);
});

// Seeding loads the embedding model and embeds the whole corpus — minutes against an empty
// database. Keep it off the boot path so the port opens and the platform health check passes;
// until it finishes, /health answers ok with a document count of 0.
void (async () => {
  try {
    if (config.SEED_ON_BOOT) {
      const [{ n }] = await db.select({ n: count() }).from(documents);
      if (n === 0) await seed(db, await getEmbedder(), config);
    }
    // Load the embedding model now rather than on the first question.
    await getEmbedder();
  } catch (err) {
    console.error("Startup seeding failed:", err);
  }
})();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      await (await getEmbedder()).dispose();
      process.exit(0);
    });
  });
}
