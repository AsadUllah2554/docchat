import type { RefusalData } from "@/lib/types";

const score = (n: number | null) => (n === null ? "—" : n.toFixed(2));

/** A refusal is correct behaviour, so it is stated plainly in gold, not styled as an error. */
export function RefusalCard({ refusal }: { refusal: RefusalData }) {
  return (
    <div className="max-w-[62ch] border-l-2 border-absent bg-slate-lift px-5 py-4" role="status">
      <p className="text-15 font-medium text-absent">Not in these documents.</p>
      {refusal.reason === "below_threshold" ? (
        <p className="mt-2 text-13 text-chalk-dim">
          {refusal.topSimilarity === null ? (
            "Nothing is indexed yet."
          ) : (
            <>
              Closest match scored <span className="text-chalk tabular-nums">{score(refusal.topSimilarity)}</span>, below the{" "}
              <span className="text-chalk tabular-nums">{score(refusal.threshold)}</span> threshold.
            </>
          )}{" "}
          No answer was generated.
        </p>
      ) : (
        <p className="mt-2 text-13 text-chalk-dim">
          The closest excerpts scored <span className="text-chalk tabular-nums">{score(refusal.topSimilarity)}</span> and were read by the
          model, which found they do not answer this question. No answer was given.
        </p>
      )}
    </div>
  );
}
