import "dotenv/config";
import { getConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { getEmbedder } from "../src/rag/embed.js";
import { seed } from "../src/seed.js";

const config = getConfig();
const { db, pool } = createDb(config.DATABASE_URL);
await seed(db, await getEmbedder(), config);
await pool.end();
