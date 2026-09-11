/**
 * The embedding model and its output dimension live together, because the vector column is
 * sized from this constant. Change the model and the dimension (and a migration) together:
 * a mismatch is rejected by pgvector at insert time.
 */
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMENSIONS = 384;
/** bge-small reads at most 512 tokens; anything longer is truncated before embedding. */
export const EMBEDDING_MAX_TOKENS = 512;
/** bge models embed queries with this instruction prefix, and passages without it. */
export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
