"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEMO_EMAIL, DEMO_PASSWORD, login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e?: string, p?: string) {
    setPending(true);
    setError(null);
    try {
      await login(e ?? email, p ?? password, e ? "login" : mode);
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

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
          disabled={pending}
          onClick={() => submit(DEMO_EMAIL, DEMO_PASSWORD)}
          className="mt-3 h-9 bg-chalk px-4 text-13 font-medium text-slate hover:bg-white disabled:opacity-60"
        >
          Use demo account
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
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-10 w-full border border-edge bg-slate-lift px-3 text-15 focus:border-cite focus:outline-none"
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
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-10 w-full border border-edge bg-slate-lift px-3 text-15 focus:border-cite focus:outline-none"
          />
        </div>
        {error && <p className="text-13 text-danger">{error}</p>}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending} className="h-10 border border-chalk px-4 text-13 font-medium hover:bg-chalk hover:text-slate disabled:opacity-60">
            {mode === "login" ? "Log in" : "Create account"}
          </button>
          <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")} className="text-13 text-chalk-dim hover:text-chalk">
            {mode === "login" ? "Create an account instead" : "I have an account"}
          </button>
        </div>
      </form>
    </main>
  );
}
