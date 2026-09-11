import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { hashPassword, signToken, verifyPassword } from "../auth.js";
import type { AppDeps } from "../app.js";
import { users } from "../db/schema.js";

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export function authRoutes({ db, config }: AppDeps) {
  const router = Router();

  router.post("/register", async (req, res) => {
    const body = credentials.parse(req.body);
    const existing = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists. Log in instead." });
      return;
    }
    // New accounts are always members; admins are created by the seed script.
    const [user] = await db
      .insert(users)
      .values({ email: body.email, hashedPassword: await hashPassword(body.password), role: "member" })
      .returning();
    const auth = { id: user.id, email: user.email, role: user.role };
    res.status(201).json({ token: signToken(auth, config.JWT_SECRET, config.JWT_EXPIRES_IN), user: auth });
  });

  router.post("/login", async (req, res) => {
    const body = credentials.parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (!user || !(await verifyPassword(body.password, user.hashedPassword))) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    const auth = { id: user.id, email: user.email, role: user.role };
    res.json({ token: signToken(auth, config.JWT_SECRET, config.JWT_EXPIRES_IN), user: auth });
  });

  return router;
}
