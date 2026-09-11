import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The api/ directory, whether running from src/ (tsx) or dist/src/ (built). */
export const API_ROOT = path.resolve(here, here.split(path.sep).includes("dist") ? "../.." : "..");
export const MIGRATIONS_DIR = path.join(API_ROOT, "drizzle");
export const CORPUS_DIR = path.join(API_ROOT, "..", "corpus");
