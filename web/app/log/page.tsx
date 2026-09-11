"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { useRequireSession } from "@/components/session";
import { api } from "@/lib/api";
import { formatLatency } from "@/lib/format";
import type { QueryRow } from "@/lib/types";

interface Stats {
  total: number;
  refused: number;
  avgLatencyMs: number | null;
  avgCost: number | null;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function outcome(q: QueryRow): { text: string; tone: string } {
  if (q.error) return { text: "error", tone: "text-danger" };
  if (q.refusalReason === "below_threshold") return { text: "refused, no model call", tone: "text-absent" };
  if (q.refusalReason === "model") return { text: "refused by model", tone: "text-absent" };
  return { text: "answered", tone: "text-chalk-dim" };
}

export default function LogPage() {
  const user = useRequireSession();
  const [data, setData] = useState<{ queries: QueryRow[]; stats: Stats } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ queries: QueryRow[]; stats: Stats }>(`/queries?limit=100${user.role === "admin" ? "&all=true" : ""}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user]);

  if (!user) return null;
  const s = data?.stats;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-25 font-semibold tracking-tight">Query log</h1>
        {s && (
          <p className="mt-1 text-13 text-chalk-dim tabular-nums">
            {s.total} {s.total === 1 ? "question" : "questions"}
            {s.total > 0 && ` · ${Math.round((s.refused / s.total) * 100)}% refused`}
            {s.avgLatencyMs !== null && ` · avg ${formatLatency(s.avgLatencyMs)}`}
            {s.avgCost !== null && ` · avg $${s.avgCost.toFixed(5)} per answer`}
            {user.role === "admin" ? " · all users" : " · your questions"}
          </p>
        )}
        {error && <p className="mt-4 text-13 text-danger">{error}</p>}
        {data && data.queries.length === 0 && <p className="mt-8 text-15 text-chalk-dim">No questions yet. Ask one to see it logged here.</p>}
        {data && data.queries.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full border-collapse text-13">
              <thead>
                <tr className="border-b border-edge text-left text-12 text-chalk-dim">
                  <th scope="col" className="py-2 pr-4 font-normal">Question</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Outcome</th>
                  <th scope="col" className="py-2 pl-4 text-right font-normal">Top match</th>
                  <th scope="col" className="py-2 pl-4 text-right font-normal">Time</th>
                  <th scope="col" className="hidden py-2 pl-4 text-right font-normal sm:table-cell">When</th>
                </tr>
              </thead>
              <tbody>
                {data.queries.map((q) => {
                  const o = outcome(q);
                  return (
                    <tr key={q.id} className="border-b border-edge align-top">
                      <td className="max-w-md py-2.5 pr-4 text-chalk">{q.question}</td>
                      <td className={`py-2.5 pr-4 whitespace-nowrap ${o.tone}`}>
                        {o.text}
                        {q.fallbackFrom && <span className="text-chalk-dim"> · via {q.provider}</span>}
                      </td>
                      <td className="py-2.5 pl-4 text-right tabular-nums">{q.topSimilarity?.toFixed(2) ?? "—"}</td>
                      <td className="py-2.5 pl-4 text-right tabular-nums">{formatLatency(q.latencyMs)}</td>
                      <td className="hidden py-2.5 pl-4 text-right whitespace-nowrap text-chalk-dim sm:table-cell">
                        {timeFormat.format(new Date(q.createdAt))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
