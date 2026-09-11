"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { ChunkBar } from "@/components/chunk-bar";
import { ChunkContent } from "@/components/chunk-content";
import { useRequireSession } from "@/components/session";
import { api } from "@/lib/api";
import type { ChunkRow, DocumentSummary } from "@/lib/types";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function DocumentsPage() {
  const user = useRequireSession();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [windowTokens, setWindowTokens] = useState(512);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ documents: DocumentSummary[]; embeddingMaxTokens: number }>("/documents")
      .then((r) => {
        setDocs(r.documents);
        setWindowTokens(r.embeddingMaxTokens);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!user) return null;
  const totalChunks = docs?.reduce((s, d) => s + d.chunkCount, 0) ?? 0;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="text-25 font-semibold tracking-tight">Documents</h1>
            {docs && (
              <p className="mt-1 text-13 text-chalk-dim tabular-nums">
                {docs.length} indexed · {totalChunks} chunks · the bar shows each chunk&apos;s size
              </p>
            )}
          </div>
          <UploadForm onDone={load} />
        </div>

        {loadError && <p className="mt-6 text-13 text-danger">{loadError}</p>}
        {docs && docs.length === 0 && (
          <p className="mt-8 text-15 text-chalk-dim">No documents yet. Add a .md, .txt or .pdf file to start.</p>
        )}
        {docs && docs.length > 0 && (
          <ul className="mt-8 border-t border-edge">
            {docs.map((d) => (
              <DocumentRow key={d.id} doc={d} windowTokens={windowTokens} isAdmin={user.role === "admin"} onDeleted={load} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function DocumentRow({
  doc,
  windowTokens,
  isAdmin,
  onDeleted,
}: {
  doc: DocumentSummary;
  windowTokens: number;
  isAdmin: boolean;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<ChunkRow[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setOpen((o) => !o);
    if (!chunks) {
      try {
        setChunks((await api<{ chunks: ChunkRow[] }>(`/documents/${doc.id}/chunks`)).chunks);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  }

  async function remove() {
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    }
  }

  return (
    <li className="border-b border-edge py-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="min-w-0">
          <Link href={`/documents/${doc.id}`} className="text-15 font-medium text-chalk hover:text-cite">
            {doc.title}
          </Link>
          <p className="mt-0.5 truncate text-12 text-chalk-dim">
            {doc.source} · added {dateFormat.format(new Date(doc.uploadedAt))}
          </p>
        </div>
        <div className="flex flex-col justify-center gap-1.5">
          <ChunkBar tokenCounts={doc.chunkTokenCounts} windowTokens={windowTokens} />
          <p className="text-12 text-chalk-dim tabular-nums">
            {doc.chunkCount} chunks
            {doc.chunkTokenCounts.length > 0 && ` · ${Math.min(...doc.chunkTokenCounts)}–${Math.max(...doc.chunkTokenCounts)} tokens`}
          </p>
        </div>
      </div>
      <div className="mt-2 flex gap-4 text-12">
        <button type="button" aria-expanded={open} onClick={toggle} className="text-cite hover:underline">
          {open ? "Hide chunks" : "Show chunks"}
        </button>
        <Link href={`/documents/${doc.id}`} className="text-chalk-dim hover:text-chalk">
          Inspect
        </Link>
        {isAdmin &&
          (confirming ? (
            <>
              <button type="button" onClick={remove} className="text-danger hover:underline">
                Delete permanently
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-chalk-dim hover:text-chalk">
                Keep
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="text-chalk-dim hover:text-danger">
              Delete
            </button>
          ))}
      </div>
      {error && <p className="mt-2 text-12 text-danger">{error}</p>}
      {open && chunks && (
        <ol className="mt-3 space-y-2">
          {chunks.map((c) => (
            <li key={c.id} className="border border-edge bg-slate-lift px-3.5 py-2.5">
              <p className="flex justify-between gap-3 text-12 text-chalk-dim tabular-nums">
                <span>
                  <span className="text-cite">§{c.label}</span> {c.sectionHeading}
                </span>
                <span className="shrink-0">{c.tokenCount} tokens</span>
              </p>
              <ChunkContent content={c.content} className="mt-1.5 line-clamp-3" />
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function UploadForm({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setStatus({ tone: "info", text: `Chunking and embedding ${file.name}` });
    const form = new FormData();
    form.append("file", file);
    try {
      const doc = await api<{ title: string; chunkCount: number }>("/documents", { method: "POST", body: form });
      setStatus({ tone: "info", text: `Added ${doc.title}: ${doc.chunkCount} chunks.` });
      onDone();
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="h-9 bg-chalk px-4 text-13 font-medium text-slate hover:bg-white disabled:bg-edge disabled:text-chalk-dim"
      >
        {busy ? "Adding document" : "Add document"}
      </button>
      <input
        ref={input}
        type="file"
        accept=".md,.markdown,.txt,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {status && (
        <p role="status" className={`max-w-xs text-right text-12 ${status.tone === "error" ? "text-danger" : "text-chalk-dim"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
