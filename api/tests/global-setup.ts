import "dotenv/config";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

export default async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("Set DATABASE_URL_TEST to a Postgres database with pgvector, used only by tests");
  const { db, pool } = createDb(url);
  await runMigrations(db);
  await pool.end();
}
