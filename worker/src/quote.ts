export interface Quote {
  code: string;
  label: string;
  price: number;
  change: number;
  changePct: number;
  /** Exchange timestamp of the price (epoch seconds). */
  marketTime: number;
}

/** Swap this out if the data source changes. */
export interface QuoteProvider {
  get(code: string, label: string): Promise<Quote>;
}

/**
 * Yahoo Finance chart endpoint. Unofficial and undocumented; TSE prices are ~20 min delayed.
 * Each deployer fetches for themselves; the project never hosts or redistributes data.
 */
export class YahooQuoteProvider implements QuoteProvider {
  // Wrapped: calling the global fetch as a method of another object throws "Illegal invocation" on Workers.
  constructor(private fetchFn: typeof fetch = (input, init) => fetch(input, init)) {}

  async get(code: string, label: string): Promise<Quote> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}.T?interval=1d&range=1d`;
    const res = await this.fetchFn(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`${code}: HTTP ${res.status}`);
    return parseYahooChart(code, label, await res.json());
  }
}

export function parseYahooChart(code: string, label: string, body: any): Quote {
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    throw new Error(`${code}: ${body?.chart?.error?.description ?? "no data"}`);
  }
  const price: number = meta.regularMarketPrice;
  const prev: number | undefined = meta.chartPreviousClose ?? meta.previousClose;
  const change: number = meta.fulldayChange ?? (prev !== undefined ? price - prev : 0);
  const changePct: number =
    meta.fulldayChangePercent ?? (prev ? (change / prev) * 100 : 0);
  return {
    code,
    label: label || meta.shortName || code,
    price,
    change,
    changePct,
    marketTime: meta.regularMarketTime,
  };
}
