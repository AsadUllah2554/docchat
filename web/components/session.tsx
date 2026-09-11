"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { getSession, type SessionUser } from "@/lib/api";

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

// useSyncExternalStore needs a stable snapshot, so compare by the token string.
let lastToken: string | null | undefined;
let lastUser: SessionUser | null = null;
const snapshot = () => {
  const s = getSession();
  if ((s?.token ?? null) !== lastToken) {
    lastToken = s?.token ?? null;
    lastUser = s?.user ?? null;
  }
  return lastUser;
};

/** The logged-in user, or null. `undefined` during server render, before localStorage is readable. */
export function useSessionUser(): SessionUser | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

/** Sends the visitor to /login when there is no session. */
export function useRequireSession(): SessionUser | null | undefined {
  const user = useSessionUser();
  const router = useRouter();
  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);
  return user;
}
