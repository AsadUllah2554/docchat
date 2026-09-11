import { describe, expect, it } from "vitest";
import { chunkMarkdown, citationLabel, estimateTokens, promoteNumberedHeadings } from "../src/rag/chunk.js";

const doc = [
  "# Policy",
  "",
  "Intro paragraph.",
  "",
  "## 1. Scope",
  "",
  "Short section about scope.",
  "",
  "## 2. Long section",
  "",
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. ${"The quick brown fox jumps over the lazy dog. ".repeat(6)}\n`),
  "### 2.1 Subsection",
  "",
  "The subsection text.",
].join("\n");

describe("chunkMarkdown", () => {
  const chunks = chunkMarkdown(doc, { maxTokens: 150, overlapTokens: 30 });

  it("keeps every chunk under the size limit", () => {
    for (const c of chunks) expect(estimateTokens(c.content)).toBeLessThanOrEqual(150);
  });

  it("covers the whole document in order", () => {
    expect(chunks[0].content.startsWith("# Policy")).toBe(true);
    expect(chunks.at(-1)!.content).toContain("The subsection text.");
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("records the nearest heading at or above each chunk", () => {
    const mid = chunks.find((c) => c.content.includes("Paragraph 5.") && !c.content.includes("## 2."));
    expect(mid?.sectionHeading).toBe("2. Long section");
    expect(chunks.at(-1)!.sectionHeading).toMatch(/^2/);
  });

  it("carries overlap from one chunk into the next when a section is split", () => {
    const i = chunks.findIndex((c) => c.content.includes("Paragraph 3."));
    const tail = chunks[i].content.slice(-40);
    expect(chunks[i + 1].content).toContain(tail.trim().split(". ").at(-1)!.trim());
  });
});

describe("citation labels", () => {
  it("uses the section number for a chunk inside one section", () => {
    expect(citationLabel("Either party may terminate...", "4.2 Termination for convenience", 3)).toBe("4.2");
  });

  it("uses a range when a chunk spans sections", () => {
    expect(citationLabel("## 5. IP\n\ntext\n\n## 6. Confidentiality\n\ntext", "5. IP", 4)).toBe("5–6");
  });

  it("falls back to a paragraph number", () => {
    expect(citationLabel("Intro", "Policy", 0)).toBe("¶1");
  });
});

describe("promoteNumberedHeadings", () => {
  it("turns numbered lines from PDFs into markdown headings", () => {
    expect(promoteNumberedHeadings("4.2 Termination for convenience\nEither party")).toBe("### 4.2 Termination for convenience\nEither party");
    expect(promoteNumberedHeadings("4 Term and termination")).toBe("## 4. Term and termination");
  });
});
