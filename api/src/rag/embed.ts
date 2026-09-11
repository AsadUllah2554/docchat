import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, QUERY_PREFIX } from "./embedding-model.js";

export interface Embedder {
  model: string;
  dimensions: number;
  embedPassages(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  countTokens(text: string): number;
  /** Releases the ONNX session; call before exiting so native threads shut down cleanly. */
  dispose(): Promise<void>;
}

const BATCH = 16;

/**
 * Local embeddings with transformers.js: no API key, no quota, and the same model at
 * ingest and query time. The model (~34 MB, quantised) downloads once and is cached.
 */
export async function createLocalEmbedder(): Promise<Embedder> {
  env.cacheDir = process.env.MODEL_CACHE_DIR ?? path.join(process.cwd(), ".model-cache");
  const extractor: FeatureExtractionPipeline = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });

  async function embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      // bge uses the [CLS] vector; normalised so cosine similarity is a dot product.
      const tensor = await extractor(texts.slice(i, i + BATCH), { pooling: "cls", normalize: true });
      out.push(...(tensor.tolist() as number[][]));
    }
    const dim = out[0]?.length;
    if (dim !== undefined && dim !== EMBEDDING_DIMENSIONS) {
      throw new Error(`${EMBEDDING_MODEL} returned ${dim} dimensions; the vector column expects ${EMBEDDING_DIMENSIONS}`);
    }
    return out;
  }

  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    embedPassages: embed,
    embedQuery: async (text) => (await embed([QUERY_PREFIX + text]))[0],
    countTokens: (text) => extractor.tokenizer.encode(text).length,
    dispose: () => extractor.dispose(),
  };
}

let shared: Promise<Embedder> | undefined;

/** One embedder per process; loading the model takes a few seconds. */
export function getEmbedder(): Promise<Embedder> {
  shared ??= createLocalEmbedder();
  return shared;
}
