import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type Role = "member" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const BCRYPT_ROUNDS = 10;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export function signToken(user: AuthUser, secret: string, expiresIn: string): string {
  return jwt.sign({ email: user.email, role: user.role }, secret, {
    subject: user.id,
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

/** 401 unless a valid bearer token is present. */
export function requireAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: "Missing bearer token. Log in and send it as Authorization: Bearer <token>." });
      return;
    }
    try {
      const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
      req.user = { id: payload.sub!, email: payload.email, role: payload.role };
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token. Log in again." });
    }
  };
}

/** 403 unless the authenticated user has the role. Use after requireAuth. */
export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: `This action needs the ${role} role.` });
      return;
    }
    next();
  };
}
