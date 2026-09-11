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

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Fetch against the API with the session token. A 401 clears the session, which sends the page to login. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getSession();
  const headers = new Headers(init.headers);
  if (session) headers.set("Authorization", `Bearer ${session.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("The API could not be reached. It may be starting up; try again in a few seconds.", 0);
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
