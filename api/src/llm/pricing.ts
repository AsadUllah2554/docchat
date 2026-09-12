// USD per million tokens, [input, output]. List prices for paid tiers; the free tiers
// cost nothing, but the estimate shows what the same traffic would cost in production.
// Check provider pricing pages before quoting these numbers.
const PRICES: Record<string, [number, number]> = {
  // Gemini 3.6 Flash is $0.75/$3.75 until 31 Dec 2026, then $1.50/$7.50.
  "gemini-3.6-flash": [0.75, 3.75],
  "gemini-flash-latest": [0.75, 3.75], // alias: repoints as Google releases models
  "gemini-3.5-flash": [1.5, 9],
  "gemini-3.5-flash-lite": [0.3, 2.5],
  "gemini-2.5-flash": [0.3, 2.5],
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-2.5-pro": [1.25, 10],
  "openai/gpt-oss-20b": [0.075, 0.3],
  "openai/gpt-oss-120b": [0.15, 0.6],
  "llama-3.3-70b-versatile": [0.59, 0.79],
  "llama-3.1-8b-instant": [0.05, 0.08],
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}
