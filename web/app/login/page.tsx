"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, DEMO_EMAIL, DEMO_PASSWORD, login } from "@/lib/api";
import { useColdStartMessage } from "@/lib/use-cold-start";
import { isApiWarm, warmApi } from "@/lib/warm";

/** How long a 429 holds the form before it becomes usable again. */
const RATE_LIMIT_COOLDOWN_MS = 5_000;

interface Failure {
  message: string;
  /** Network, timeout and 5xx are worth retrying as-is; a wrong password is not. */
  retry: boolean;
}

function describe(err: unknown): Failure {
  if (!(err instanceof ApiError)) return { message: "The login attempt failed.", retry: true };
  if (err.kind === "timeout") return { message: err.message, retry: true };
  if (err.kind === "network") return { message: err.message, retry: true };
  if (err.status === 401) return { message: "Email or password not recognised.", retry: false };
  // The limiter knows its own window; a generic "wait a moment" would be a guess, and wrong.
  if (err.status === 429) return { message: err.message, retry: false };
  if (err.status >= 500) return { message: `The API returned an error (${err.status}).`, retry: true };
  return { message: err.message, retry: false };
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastAttempt = useRef<{ email?: string; password?: string } | null>(null);
  const cooldown = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wake the API while the visitor reads the page, so submitting is usually against a warm backend.
  useEffect(() => warmApi(), []);
  useEffect(() => () => void (cooldown.current && clearTimeout(cooldown.current)), []);

  const waking = useColdStartMessage(pending, isApiWarm(), attempt);
  const disabled = pending || cooling;

  async function submit(demoEmail?: string, demoPassword?: string) {
    if (disabled) return;
    lastAttempt.current = { email: demoEmail, password: demoPassword };
    setAttempt((n) => n + 1);
    setPending(true);
    setFailure(null);
    try {
      await login(demoEmail ?? email, demoPassword ?? password, demoEmail ? "login" : mode);
      router.replace("/");
    } catch (err) {
      const described = describe(err);
      setFailure(described);
      setPending(false);
      if (err instanceof ApiError && err.status === 429) {
        setCooling(true);
        cooldown.current = setTimeout(() => setCooling(false), RATE_LIMIT_COOLDOWN_MS);
      }
    }
  }

  const retry = () => void submit(lastAttempt.current?.email, lastAttempt.current?.password);

  const busyLabel = mode === "register" ? "Creating account…" : "Signing in…";
  const spinner = <span className="spinner" aria-hidden="true" />;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="text-25 font-semibold tracking-tight">DocChat</h1>
      <p className="mt-2 text-15 text-chalk-dim">
        Ask questions across a set of documents. Every answer cites its source, and it says when the documents do not say.
      </p>

      <div className="mt-8 border-l-2 border-cite bg-slate-lift px-4 py-3.5">
        <p className="text-13 text-chalk">Demo account</p>
        <p className="mt-1 text-13 text-chalk-dim">
          <span className="text-chalk">{DEMO_EMAIL}</span> / <span className="text-chalk">{DEMO_PASSWORD}</span>
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => submit(DEMO_EMAIL, DEMO_PASSWORD)}
          className="mt-3 inline-flex h-9 items-center gap-2 bg-chalk px-4 text-13 font-medium text-slate hover:bg-white disabled:opacity-60"
        >
          {pending && spinner}
          {pending ? "Signing in…" : "Use demo account"}
        </button>
      </div>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <label htmlFor="email" className="text-12 text-chalk-dim">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            disabled={disabled}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-10 w-full border border-edge bg-slate-lift px-3 text-15 focus:border-cite focus:outline-none disabled:opacity-60"
          />
        </div>
        <div>
          <label htmlFor="password" className="text-12 text-chalk-dim">
            Password {mode === "register" && <span>(8 characters or more)</span>}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            disabled={disabled}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-10 w-full border border-edge bg-slate-lift px-3 text-15 focus:border-cite focus:outline-none disabled:opacity-60"
          />
        </div>
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex h-10 items-center gap-2 border border-chalk px-4 text-13 font-medium hover:bg-chalk hover:text-slate disabled:opacity-60"
          >
            {pending && spinner}
            {pending ? busyLabel : mode === "login" ? "Log in" : "Create account"}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-13 text-chalk-dim hover:text-chalk disabled:opacity-60"
          >
            {mode === "login" ? "Create an account instead" : "I have an account"}
          </button>
        </div>
      </form>

      {/* One line, replaced in place: the waking notice while in flight, the failure once it lands. */}
      <div aria-live="polite" className="mt-4 min-h-5">
        {pending
          ? waking && <p className="text-13 text-chalk-dim">{waking}</p>
          : failure && (
              <p className="text-13 text-danger">
                {failure.message}
                {failure.retry && (
                  <button
                    type="button"
                    onClick={retry}
                    className="ml-2 text-chalk-dim underline underline-offset-2 hover:text-chalk"
                  >
                    Try again
                  </button>
                )}
              </p>
            )}
      </div>
    </main>
  );
}
