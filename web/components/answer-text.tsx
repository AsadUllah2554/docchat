"use client";

import { Fragment } from "react";
import type { RetrievedChunk } from "@/lib/types";

const CITATION = /\[chunk:(\d+)\]/g;

/**
 * Renders the model's answer with `[chunk:12]` tags turned into inline citation links
 * labelled by section, e.g. [4.2]. A half-streamed tag at the end is held back.
 */
export function AnswerText({
  text,
  chunks,
  streaming,
  onHover,
  onSelect,
}: {
  text: string;
  chunks: RetrievedChunk[];
  streaming: boolean;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
}) {
  const visible = streaming ? text.replace(/\[(c(h(u(n(k(:\d*)?)?)?)?)?)?$/, "") : text;
  const byId = new Map(chunks.map((c) => [c.id, c]));

  const paragraphs = visible.trim().split(/\n{2,}/);
  return (
    <div className="max-w-[62ch] space-y-4 font-serif text-17 text-chalk">
      {paragraphs.map((para, pi) => {
        const parts: React.ReactNode[] = [];
        let last = 0;
        for (const m of para.matchAll(CITATION)) {
          parts.push(para.slice(last, m.index));
          const id = Number(m[1]);
          const chunk = byId.get(id);
          parts.push(
            chunk ? (
              <button
                key={`${pi}-${m.index}`}
                type="button"
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(id)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(id)}
                title={`${chunk.documentTitle}${chunk.sectionHeading ? ` — ${chunk.sectionHeading}` : ""}`}
                className="mx-px align-baseline font-sans text-[0.8em] text-cite underline-offset-2 hover:underline"
              >
                [{chunk.label}]
              </button>
            ) : (
              // The model cited a chunk it was not given: show it, unlinked, rather than hide it.
              <span key={`${pi}-${m.index}`} className="font-sans text-[0.8em] text-chalk-dim" title="Unknown source">
                [?]
              </span>
            ),
          );
          last = m.index + m[0].length;
        }
        parts.push(para.slice(last));
        return (
          <p key={pi}>
            {parts.map((p, i) => (
              <Fragment key={i}>{p}</Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
