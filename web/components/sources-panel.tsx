"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DocumentSummary, RetrievedChunk, SourcesData } from "@/lib/types";
import { ChunkContent, displayHeading } from "./chunk-content";

interface Props {
  sources: SourcesData | null;
  /** Shown under the heading when the thread has more than one question. */
  question: string | null;
  searching: boolean;
  citedIds: number[];
  hoveredId: number | null;
  selectedId: number | null;
  documents: DocumentSummary[] | null;
}

/**
 * Always present. Idle, it lists what is indexed. After a question, it shows what was
 * retrieved, best match first, with the similarity score on every card.
 */
export function SourcesPanel({ sources, question, searching, citedIds, hoveredId, selectedId, documents }: Props) {
  const cardRefs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    if (selectedId === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRefs.current.get(selectedId)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [selectedId]);

  if (!sources) {
    return (
      <div className="px-4 py-5 sm:px-5">
        <h2 className="text-13 font-medium text-chalk">{searching ? "Sources" : "Indexed documents"}</h2>
        {searching ? (
          <p className="mt-3 text-13 text-chalk-dim">Searching the index.</p>
        ) : documents === null ? null : documents.length === 0 ? (
          <p className="mt-3 text-13 text-chalk-dim">
            Nothing is indexed. <Link href="/documents" className="text-cite hover:underline">Add a document</Link> to start.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-edge border-y border-edge">
            {documents.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-3 py-2.5 text-13">
                <Link href={`/documents/${d.id}`} className="truncate text-chalk hover:text-cite">
                  {d.title}
                </Link>
                <span className="shrink-0 text-12 text-chalk-dim tabular-nums">{d.chunkCount} chunks</span>
              </li>
            ))}
          </ul>
        )}
        {!searching && documents && documents.length > 0 && (
          <p className="mt-4 text-12 text-chalk-dim">Retrieved excerpts appear here, best match first, before the answer is written.</p>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-5 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-13 font-medium text-chalk">Sources</h2>
        <span className="text-12 text-chalk-dim tabular-nums">
          {sources.chunks.length} retrieved · threshold {sources.threshold.toFixed(2)}
        </span>
      </div>
      {question && <p className="mt-1 truncate text-12 text-chalk-dim">For: {question}</p>}
      <ol className="mt-3 space-y-3">
        {sources.chunks.map((chunk) => (
          <SourceCard
            key={chunk.id}
            chunk={chunk}
            ref={(el) => {
              if (el) cardRefs.current.set(chunk.id, el);
              else cardRefs.current.delete(chunk.id);
            }}
            cited={citedIds.includes(chunk.id)}
            highlighted={hoveredId === chunk.id || selectedId === chunk.id}
            belowThreshold={chunk.similarity < sources.threshold}
          />
        ))}
      </ol>
    </div>
  );
}

function SourceCard({
  chunk,
  ref,
  cited,
  highlighted,
  belowThreshold,
}: {
  chunk: RetrievedChunk;
  ref: (el: HTMLElement | null) => void;
  cited: boolean;
  highlighted: boolean;
  belowThreshold: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = chunk.content.length > 420;

  return (
    <li
      ref={ref}
      id={`chunk-${chunk.id}`}
      className={`scroll-my-4 border bg-slate-lift px-3.5 py-3 ${highlighted ? "border-cite" : "border-edge"}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-13 font-medium text-chalk">
          <span className="text-cite">§{chunk.label}</span>{" "}
          <span className="break-words">{displayHeading(chunk.content, chunk.sectionHeading) ?? chunk.documentTitle}</span>
        </p>
        <span className="shrink-0 text-12 text-chalk tabular-nums" title="Cosine similarity to the question">
          {chunk.similarity.toFixed(2)}
        </span>
      </div>
      <p className="mt-0.5 flex gap-2 text-12 text-chalk-dim">
        <span className="truncate">{chunk.documentTitle}</span>
        {cited && <span className="shrink-0 text-cite">cited</span>}
        {belowThreshold && <span className="shrink-0">below threshold</span>}
      </p>
      <ChunkContent content={chunk.content} className={`mt-2 ${long && !expanded ? "line-clamp-7" : ""}`} />
      {long && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1.5 text-12 text-cite hover:underline">
          {expanded ? "Show less" : "Show full chunk"}
        </button>
      )}
    </li>
  );
}
