import "dotenv/config";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

const { db, pool } = createDb(process.env.DATABASE_URL!);
await runMigrations(db);
await pool.end();
console.log("Migrations applied");
