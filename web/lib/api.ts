"use client";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "demo@docchat.dev";
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "docchat-demo";

export interface SessionUser {
  id: string;
  email: string;
  role: "member" | "admin";
}

const TOKEN_KEY = "docchat.token";
const USER_KEY = "docchat.user";

export function getSession(): { token: string; user: SessionUser } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = localStorage.getItem(USER_KEY);
    return token && user ? { token, user: JSON.parse(user) } : null;
  } catch {
    return null;
  }
}

// The storage event only fires in other tabs; dispatch one so this tab's hooks update too.
const notify = () => window.dispatchEvent(new StorageEvent("storage", { key: TOKEN_KEY }));

export function saveSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  notify();
}

/** Pages using useRequireSession redirect to /login when this runs. */
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notify();
}

/** How a request failed: the server answered, the network did not, or we gave up waiting. */
export type ApiErrorKind = "http" | "network" | "timeout";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: ApiErrorKind = "http",
  ) {
    super(message);
  }
}

/** The API sleeps after 15 minutes idle and cold starts in under 30s; 45s means something is wrong. */
export const REQUEST_TIMEOUT_MS = 45_000;

/** Fetch against the API with the session token. A 401 clears the session, which sends the page to login. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getSession();
  const headers = new Headers(init.headers);
  if (session) headers.set("Authorization", `Bearer ${session.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError("The API did not respond in 45 seconds. It may be down.", 0, "timeout");
    }
    throw new ApiError("Could not reach the API. It may still be waking up.", 0, "network");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && session) clearSession();
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status}).`, res.status);
  return body as T;
}

export async function login(email: string, password: string, mode: "login" | "register" = "login") {
  const result = await api<{ token: string; user: SessionUser }>(`/auth/${mode}`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  saveSession(result.token, result.user);
  return result.user;
}
