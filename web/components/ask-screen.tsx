"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, API_URL, getSession } from "@/lib/api";
import type { ChatMessage, DocumentSummary, MetaData, RefusalData, SourcesData } from "@/lib/types";
import { formatLatency } from "@/lib/format";
import { AnswerText } from "./answer-text";
import { AppHeader } from "./app-header";
import { RefusalCard } from "./refusal-card";
import { useRequireSession } from "./session";
import { SourcesPanel } from "./sources-panel";

const EXAMPLES = [
  "What is the notice period for terminating a retainer?",
  "What happens to retainer hours we don't use?",
  "Do you offer discounts for charities?",
];

const PROVIDERS: Record<string, string> = { gemini: "Gemini", groq: "Groq", fake: "Test model" };

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

interface Turn {
  question: ChatMessage;
  answer: ChatMessage | undefined;
  sources: SourcesData | null;
  refusal: RefusalData | null;
  meta: MetaData | null;
  text: string;
}

function toTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "user") continue;
    const answer = messages[i + 1]?.role === "assistant" ? messages[i + 1] : undefined;
    const parts = answer?.parts ?? [];
    turns.push({
      question: messages[i],
      answer,
      sources: parts.find((p) => p.type === "data-sources")?.data ?? null,
      refusal: parts.find((p) => p.type === "data-refusal")?.data ?? null,
      meta: parts.find((p) => p.type === "data-meta")?.data ?? null,
      text: parts.map((p) => (p.type === "text" ? p.text : "")).join(""),
    });
  }
  return turns;
}

const textOf = (m: ChatMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

function errorText(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    return JSON.parse(error.message).error ?? error.message;
  } catch {
    return error.message || "The answer could not be generated. Try again.";
  }
}

export function AskScreen() {
  const user = useRequireSession();
  const reduceMotion = usePrefersReducedMotion();
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [input, setInput] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: `${API_URL}/query`,
        headers: (): Record<string, string> => {
          const token = getSession()?.token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // The API answers one question at a time; there is no conversation memory.
        prepareSendMessagesRequest: ({ messages }) => ({ body: { question: textOf(messages[messages.length - 1]) } }),
      }),
    [],
  );
  const { messages, sendMessage, status, error } = useChat<ChatMessage>({ transport });

  useEffect(() => {
    if (!user) return;
    api<{ documents: DocumentSummary[] }>("/documents")
      .then((r) => setDocuments(r.documents))
      .catch(() => setDocuments([]));
  }, [user]);

  const turns = toTurns(messages);
  const busy = status === "submitted" || status === "streaming";
  const shown = turns.find((t) => t.question.id === activeTurn) ?? turns[turns.length - 1];

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end", behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages.length, reduceMotion]);

  function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setActiveTurn(null);
    setSelectedId(null);
    setInput("");
    void sendMessage({ text: q });
  }

  const selectChunk = (turn: Turn, id: number) => {
    setActiveTurn(turn.question.id);
    setSelectedId(id);
    setSheetOpen(true);
  };

  if (!user) return null;

  const docCount = documents ? `${documents.length} ${documents.length === 1 ? "document" : "documents"}` : null;
  const panel = (
    <SourcesPanel
      sources={shown?.sources ?? null}
      question={turns.length > 1 && shown ? textOf(shown.question) : null}
      searching={Boolean(shown && !shown.sources && busy)}
      citedIds={shown?.meta?.citedChunkIds ?? [...(shown?.text ?? "").matchAll(/\[chunk:(\d+)\]/g)].map((m) => Number(m[1]))}
      hoveredId={hoveredId}
      selectedId={selectedId}
      documents={documents}
    />
  );

  return (
    <div className="flex h-dvh flex-col lg:grid lg:grid-cols-[65fr_35fr]">
      <main className="flex min-h-0 flex-1 flex-col">
        <AppHeader aside={docCount && <span className="hidden tabular-nums sm:inline">{docCount}</span>} />

        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-8">
          {turns.length === 0 ? (
            <div className="mx-auto max-w-[62ch] pt-16 sm:pt-24">
              <p className="font-serif text-17 text-chalk">Ask a question about the indexed documents.</p>
              <p className="mt-2 text-13 text-chalk-dim">
                Every answer cites the excerpts it used. If the documents do not cover the question, the answer is a refusal, not a
                guess.
              </p>
              <ul className="mt-6 space-y-2">
                {EXAMPLES.map((q) => (
                  <li key={q}>
                    <button type="button" onClick={() => ask(q)} className="text-left text-15 text-cite hover:underline">
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className="mx-auto max-w-[62ch] space-y-12 pt-8">
              {turns.map((turn, i) => {
                const last = i === turns.length - 1;
                const streaming = last && status === "streaming";
                const turnError = last ? errorText(error) : null;
                const isShown = turn === shown;
                return (
                  <li key={turn.question.id}>
                    <h2 className="text-19 font-medium text-chalk">
                      {isShown || turns.length === 1 ? (
                        textOf(turn.question)
                      ) : (
                        <button type="button" onClick={() => setActiveTurn(turn.question.id)} className="text-left hover:text-cite" title="Show this question's sources">
                          {textOf(turn.question)}
                        </button>
                      )}
                    </h2>
                    <div className="mt-4">
                      {turn.refusal ? (
                        <RefusalCard refusal={turn.refusal} />
                      ) : turn.text ? (
                        streaming && reduceMotion ? (
                          <p className="text-13 text-chalk-dim">Writing the answer.</p>
                        ) : (
                          <AnswerText
                            text={turn.text}
                            chunks={turn.sources?.chunks ?? []}
                            streaming={streaming}
                            onHover={(id) => {
                              if (id !== null) setActiveTurn(turn.question.id);
                              setHoveredId(id);
                            }}
                            onSelect={(id) => selectChunk(turn, id)}
                          />
                        )
                      ) : last && busy ? (
                        <p className="text-13 text-chalk-dim">{turn.sources ? "Writing the answer." : "Searching the index."}</p>
                      ) : null}
                      {turnError && <p className="mt-3 max-w-[62ch] text-13 text-danger">{turnError}</p>}
                    </div>
                    {turn.meta && <TurnMeta meta={turn.meta} />}
                  </li>
                );
              })}
            </ol>
          )}
          <div ref={threadEnd} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="shrink-0 border-t border-edge px-4 py-4 pb-20 sm:px-8 lg:pb-4"
        >
          <div className="mx-auto flex max-w-[62ch] items-end gap-3">
            <label htmlFor="question" className="sr-only">
              Question
            </label>
            <textarea
              id="question"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              placeholder="Ask a question"
              maxLength={1000}
              className="max-h-40 min-h-11 flex-1 resize-none border border-edge bg-slate-lift px-3.5 py-2.5 text-15 text-chalk placeholder:text-chalk-dim focus:border-cite focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || input.trim().length < 3}
              className="h-11 bg-chalk px-5 text-13 font-medium text-slate hover:bg-white disabled:bg-edge disabled:text-chalk-dim"
            >
              Ask
            </button>
          </div>
        </form>
      </main>

      {/* Desktop: a permanent column. Mobile: a bottom sheet. */}
      <aside aria-label="Sources" className="scroll-quiet hidden min-h-0 overflow-y-auto border-l border-edge bg-slate lg:block">
        {panel}
      </aside>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-edge bg-slate-lift lg:hidden">
        <button
          type="button"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}
          className="flex h-14 w-full items-center justify-between px-4 text-13"
        >
          <span className="font-medium text-chalk">
            Sources{shown?.sources ? <span className="ml-2 text-chalk-dim tabular-nums">{shown.sources.chunks.length}</span> : null}
          </span>
          <span className="text-chalk-dim">{sheetOpen ? "Hide" : "Show"}</span>
        </button>
        {sheetOpen && <div className="scroll-quiet max-h-[70dvh] overflow-y-auto border-t border-edge bg-slate">{panel}</div>}
      </div>
    </div>
  );
}

function TurnMeta({ meta }: { meta: MetaData }) {
  const parts: string[] = [];
  if (!meta.refused) parts.push(`${meta.citedChunkIds.length} ${meta.citedChunkIds.length === 1 ? "source" : "sources"} cited`);
  parts.push(formatLatency(meta.latencyMs));
  if (meta.provider) parts.push(PROVIDERS[meta.provider] ?? meta.provider);
  if (meta.fallbackFrom) parts.push(`fallback after ${PROVIDERS[meta.fallbackFrom] ?? meta.fallbackFrom} was rate limited`);
  if (meta.cacheHit) parts.push("cached");
  if (meta.refused && !meta.provider) parts.push("no model call");
  return <p className="mt-3 text-12 text-chalk-dim tabular-nums">{parts.join(" · ")}</p>;
}
