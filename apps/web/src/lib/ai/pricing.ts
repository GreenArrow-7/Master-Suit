import { prisma } from '../db';

/**
 * Tokenomics: what a model costs, priced at the moment it was used.
 *
 * The deployment-wide `AI_COST_USD_PER_MILLION_INPUT/_OUTPUT` pair this
 * replaces could only ever describe one model, and it changed retroactively:
 * editing the variable rewrote the cost of every request ever made. A price
 * here carries the date it took effect, so last month's spend keeps last
 * month's rate, and each recorded attempt names the exact price row it used.
 *
 * A model with no price is not guessed at. The attempt is recorded with a zero
 * cost and the portal says "unpriced" beside it, which is a question an
 * administrator can answer, rather than a number they would have to distrust.
 */
export interface ModelPrice {
  id: string;
  provider: string;
  model: string;
  inputPerM: number;
  outputPerM: number;
  currency: string;
  effectiveFrom: Date;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; price: ModelPrice | null }>();

/** Clears the price cache — used after an administrator edits a price. */
export function resetPriceCache(): void {
  cache.clear();
}

/** The price in force for this model at `at`, or null when none was ever set. */
export async function priceFor(provider: string, model: string, at: Date = new Date()): Promise<ModelPrice | null> {
  const key = `${provider}|${model}`;
  const hit = cache.get(key);
  // Only "now" is cached: a historical lookup is rare and must not be served a
  // price that was chosen for a different date.
  const live = Math.abs(at.getTime() - Date.now()) < TTL_MS;
  if (live && hit && Date.now() - hit.at < TTL_MS) return hit.price;

  const row = await prisma.aiModelPrice.findFirst({
    where: { provider, model, effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: 'desc' },
  });
  const price: ModelPrice | null = row
    ? {
        id: row.id,
        provider: row.provider,
        model: row.model,
        inputPerM: Number(row.inputPerM),
        outputPerM: Number(row.outputPerM),
        currency: row.currency,
        effectiveFrom: row.effectiveFrom,
      }
    : null;
  if (live) cache.set(key, { at: Date.now(), price });
  return price;
}

/**
 * Cost in millionths of the currency unit. Prices are quoted per million
 * tokens, so `tokens × pricePerMillion` is already micro-units — no division,
 * and no floating-point drift accumulating over a month of rows.
 */
export function costMicros(price: ModelPrice | null, inputTokens: number, outputTokens: number): bigint {
  if (!price) return 0n;
  const micros = inputTokens * price.inputPerM + outputTokens * price.outputPerM;
  return BigInt(Math.round(micros));
}

/** Micro-units back to a display amount, e.g. 1_250_000n → 1.25. */
export function microsToAmount(micros: bigint | number): number {
  return Number(micros) / 1_000_000;
}
