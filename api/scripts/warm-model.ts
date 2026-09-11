// Downloads the embedding model at build time so the first request after a deploy is not slow.
import { getEmbedder } from "../src/rag/embed.js";

const embedder = await getEmbedder();
console.log(`${embedder.model} ready (${embedder.dimensions} dimensions)`);
await embedder.dispose();
