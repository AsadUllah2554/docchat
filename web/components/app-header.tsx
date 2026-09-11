"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearSession } from "@/lib/api";
import { useSessionUser } from "./session";

const LINKS = [
  { href: "/", label: "Ask" },
  { href: "/documents", label: "Documents" },
  { href: "/log", label: "Log" },
];

export function AppHeader({ aside }: { aside?: React.ReactNode }) {
  const pathname = usePathname();
  const user = useSessionUser();

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b border-edge px-4 sm:px-6">
      <Link href="/" className="text-15 font-semibold tracking-tight text-chalk">
        DocChat
      </Link>
      <nav className="flex gap-4 text-13">
        {LINKS.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={active ? "text-chalk" : "text-chalk-dim hover:text-chalk"}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-4 text-12 text-chalk-dim">
        {aside}
        {user && (
          <>
            <span className="hidden sm:inline" title={`Role: ${user.role}`}>
              {user.email}
            </span>
            <button
              type="button"
              className="whitespace-nowrap hover:text-chalk"
              onClick={clearSession}
            >
              Log out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
