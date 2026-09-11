import { migrate } from "drizzle-orm/node-postgres/migrator";
import { MIGRATIONS_DIR } from "../paths.js";
import type { Db } from "./client.js";

export async function runMigrations(db: Db, migrationsFolder = MIGRATIONS_DIR) {
  await migrate(db, { migrationsFolder });
}
