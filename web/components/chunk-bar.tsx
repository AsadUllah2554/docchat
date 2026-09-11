/**
 * One segment per chunk, width proportional to its token count: shows at a glance how
 * evenly a document was split. Segments over the embedding window are marked in gold.
 */
export function ChunkBar({ tokenCounts, windowTokens }: { tokenCounts: number[]; windowTokens: number }) {
  const total = tokenCounts.reduce((a, b) => a + b, 0) || 1;
  return (
    <div
      className="flex h-1.5 w-full gap-px"
      role="img"
      aria-label={`${tokenCounts.length} chunks, ${Math.min(...tokenCounts)} to ${Math.max(...tokenCounts)} tokens`}
    >
      {tokenCounts.map((t, i) => (
        <span
          key={i}
          title={`Chunk ${i + 1}: ${t} tokens`}
          className={t > windowTokens ? "bg-absent" : "bg-chalk-dim"}
          style={{ flexGrow: t, flexBasis: 0, minWidth: 2, opacity: 0.35 + 0.65 * Math.min(t / windowTokens, 1) }}
        />
      ))}
      {tokenCounts.length === 0 && <span className="flex-1 bg-edge" />}
      <span className="sr-only">{total} tokens in total</span>
    </div>
  );
}
