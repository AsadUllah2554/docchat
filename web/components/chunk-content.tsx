/**
 * Chunk text as compact paragraphs: markdown heading markers dropped, headings set in the
 * primary colour, blank lines turned into paragraph breaks.
 */
export function ChunkContent({ content, className = "" }: { content: string; className?: string }) {
  const blocks = content.split(/\n\s*\n/).filter((b) => b.trim());
  return (
    <div className={`space-y-1.5 text-13 text-chalk-dim ${className}`}>
      {blocks.map((block, i) => {
        const heading = block.match(/^#{1,6}\s+(.*)$/);
        return heading ? (
          <p key={i} className="pt-1 font-medium text-chalk first:pt-0">
            {heading[1]}
          </p>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {block}
          </p>
        );
      })}
    </div>
  );
}

/** The first numbered heading inside a chunk, else its nearest heading: used as a card title. */
export function displayHeading(content: string, sectionHeading: string | null): string | null {
  const numbered = content.match(/^#{1,6}\s+\d+(?:\.\d+)*\.?\s+(.+)$/m)?.[1];
  return numbered ?? sectionHeading?.replace(/^\d+(\.\d+)*\.?\s*/, "") ?? null;
}
