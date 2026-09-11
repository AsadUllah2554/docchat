"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { ChunkBar } from "@/components/chunk-bar";
import { ChunkContent } from "@/components/chunk-content";
import { useRequireSession } from "@/components/session";
import { api } from "@/lib/api";
import type { ChunkRow } from "@/lib/types";

interface ChunksResponse {
  document: { id: string; title: string; source: string; uploadedAt: string; chunkCount: number };
  settings: { chunkTokens: number; overlapTokens: number; embeddingMaxTokens: number };
  chunks: ChunkRow[];
}

/** How one document was split: every chunk in order, with its heading, label and token count. */
export default function ChunkInspectionPage({ params }: PageProps<"/documents/[id]">) {
  const { id } = use(params);
  const user = useRequireSession();
  const [data, setData] = useState<ChunksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<ChunksResponse>(`/documents/${id}/chunks`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user, id]);

  if (!user) return null;
  const tokens = data?.chunks.map((c) => c.tokenCount) ?? [];

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <Link href="/documents" className="text-12 text-chalk-dim hover:text-chalk">
          Documents
        </Link>
        {error && <p className="mt-4 text-15 text-danger">{error}</p>}
        {data && (
          <>
            <h1 className="mt-1 text-25 font-semibold tracking-tight">{data.document.title}</h1>
            <p className="mt-1 text-13 text-chalk-dim tabular-nums">
              {data.chunks.length} chunks · {tokens.reduce((a, b) => a + b, 0).toLocaleString()} tokens · target {data.settings.chunkTokens},
              overlap {data.settings.overlapTokens} · embedding window {data.settings.embeddingMaxTokens}
            </p>
            <div className="mt-4">
              <ChunkBar tokenCounts={tokens} windowTokens={data.settings.embeddingMaxTokens} />
            </div>

            <ol className="mt-8 space-y-3">
              {data.chunks.map((c) => {
                const over = c.tokenCount > data.settings.embeddingMaxTokens;
                return (
                  <li key={c.id} className="grid grid-cols-1 gap-3 border border-edge bg-slate-lift p-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-5">
                    <div className="text-12 text-chalk-dim tabular-nums">
                      <p className="text-13 text-chalk">
                        <span className="text-cite">§{c.label}</span>
                        <span className="ml-2 text-chalk-dim">#{c.chunkIndex + 1}</span>
                      </p>
                      <p className="mt-1">
                        {c.tokenCount} tokens{over && <span className="text-absent"> · truncated</span>}
                      </p>
                      <div className="mt-1.5 h-1 w-full bg-edge" title={`${c.tokenCount} of ${data.settings.embeddingMaxTokens} tokens`}>
                        <div
                          className={`h-1 ${over ? "bg-absent" : "bg-cite"}`}
                          style={{ width: `${Math.min(100, (c.tokenCount / data.settings.embeddingMaxTokens) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1.5">id {c.id}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-12 text-chalk-dim">
                        Nearest heading: <span className="text-chalk">{c.sectionHeading ?? "none"}</span>
                      </p>
                      <ChunkContent content={c.content} className="mt-2" />
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
