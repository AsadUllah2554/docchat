import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(24, "JWT_SECRET must be at least 24 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  /** Comma-separated origins allowed to call the API from a browser. */
  WEB_ORIGIN: z.string().default("http://localhost:3200"),

  /** Below this cosine similarity the best match is too weak, and the API refuses without calling the model. */
  SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
  TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  CHUNK_TOKENS: z.coerce.number().int().min(50).default(500),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).default(50),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  DEMO_EMAIL: z.string().email().default("demo@docchat.dev"),
  DEMO_PASSWORD: z.string().min(8).default("docchat-demo"),
  /** Ingest ./corpus and create the demo users on boot when the database is empty. */
  SEED_ON_BOOT: z.stringbool().default(false),

  RATE_LIMIT_QUERIES_PER_10_MIN: z.coerce.number().int().default(30),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function getConfig(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}
