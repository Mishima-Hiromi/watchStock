import { describe, expect, it } from "vitest";
import { parseYahooChart, type Quote, type QuoteProvider } from "../src/quote";
import { checkAlert } from "../src/alerts";
import { formatLine } from "../src/format";
import { inWatchWindow, isSummaryTick, jstDate } from "../src/market";
import worker, { parseSymbols, runTick, type Env } from "../src/index";

// 2026-09-25 (Fri) at a given JST time, as epoch ms.
const jst = (hhmm: string, day = "2026-09-25") => Date.parse(`${day}T${hhmm}:00+09:00`);

const quote = (over: Partial<Quote> = {}): Quote => ({
  code: "7203",
  label: "トヨタ",
  price: 2989.5,
  change: 20.5,
  changePct: 0.69,
  marketTime: jst("15:30") / 1000,
  ...over,
});

class MemKV {
  m = new Map<string, string>();
  async get(k: string, t?: string) {
    const v = this.m.get(k) ?? null;
    return t === "json" && v !== null ? JSON.parse(v) : v;
  }
  async put(k: string, v: string) {
    this.m.set(k, v);
  }
}

function setup(quotes: Record<string, Quote | Error>) {
  const posted: any[] = [];
  const env = {
    STATE: new MemKV() as unknown as KVNamespace,
    SYMBOLS: Object.keys(quotes).join(","),
    SUMMARY_EVERY_MIN: "30",
    ALERT_STEP_PCT: "2",
    NTFY_SERVER: "https://ntfy.example",
    NTFY_TOPIC: "t",
    ACCESS_TOKEN: "secret",
  } satisfies Env;
  const provider: QuoteProvider = {
    get: async (code) => {
      const q = quotes[code];
      if (q instanceof Error) throw q;
      return q;
    },
  };
  const fetchFn = (async (_u: string, init: RequestInit) => {
    posted.push(JSON.parse(init.body as string));
    return new Response("ok");
  }) as unknown as typeof fetch;
  return { env, provider, fetchFn, posted };
}

describe("parseYahooChart", () => {
  it("reads price and change from real response shape", () => {
    const q = parseYahooChart("7203", "", {
      chart: { result: [{ meta: { regularMarketPrice: 2989.5, chartPreviousClose: 2969, fulldayChange: 20.5, fulldayChangePercent: 0.69, regularMarketTime: 1790317800, shortName: "TOYOTA MOTOR CORP" } }] },
    });
    expect(q).toMatchObject({ price: 2989.5, change: 20.5, changePct: 0.69, label: "TOYOTA MOTOR CORP" });
  });
  it("computes change from previous close when fullday fields are absent", () => {
    const q = parseYahooChart("7203", "T", { chart: { result: [{ meta: { regularMarketPrice: 110, chartPreviousClose: 100, regularMarketTime: 1 } }] } });
    expect(q.change).toBe(10);
    expect(q.changePct).toBeCloseTo(10);
  });
  it("throws on unknown symbol", () => {
    expect(() => parseYahooChart("9999", "", { chart: { result: null, error: { description: "No data found" } } })).toThrow("No data found");
  });
});

describe("market clock", () => {
  it("watch window is 9:00-16:00 JST", () => {
    expect(inWatchWindow(jst("08:55"))).toBe(false);
    expect(inWatchWindow(jst("09:00"))).toBe(true);
    expect(inWatchWindow(jst("16:00"))).toBe(true);
    expect(inWatchWindow(jst("16:05"))).toBe(false);
  });
  it("summary ticks every N min from 9:00", () => {
    expect(isSummaryTick(jst("09:30"), 30)).toBe(true);
    expect(isSummaryTick(jst("09:35"), 30)).toBe(false);
    expect(isSummaryTick(jst("09:35"), 0)).toBe(false);
  });
  it("jstDate crosses UTC midnight correctly", () => {
    expect(jstDate(jst("00:30", "2026-09-26"))).toBe("2026-09-26");
  });
});

describe("checkAlert", () => {
  it("alerts once per new step, not on wobble", () => {
    let s = checkAlert(2.1, 2, "d", undefined);
    expect(s.alert).toBe(true);
    s = checkAlert(1.9, 2, "d", s.state);
    expect(s.alert).toBe(false);
    s = checkAlert(2.05, 2, "d", s.state);
    expect(s.alert).toBe(false);
    s = checkAlert(4.0, 2, "d", s.state);
    expect(s.alert).toBe(true);
    s = checkAlert(-2.0, 2, "d", s.state);
    expect(s.alert).toBe(true);
  });
  it("resets on a new day", () => {
    const s = checkAlert(2.1, 2, "d1", undefined);
    expect(checkAlert(2.1, 2, "d2", s.state).alert).toBe(true);
  });
});

describe("formatLine", () => {
  it("shows arrow, sign and JST time", () => {
    expect(formatLine(quote())).toBe("トヨタ 2,989.5 ▲20.5 +0.69% 15:30");
    expect(formatLine(quote({ change: -3, changePct: -0.1 }))).toBe("トヨタ 2,989.5 ▼3 -0.10% 15:30");
  });
});

describe("parseSymbols", () => {
  it("handles labels and whitespace", () => {
    expect(parseSymbols(" 7203:トヨタ , 6758 ")).toEqual([
      { code: "7203", label: "トヨタ" },
      { code: "6758", label: "" },
    ]);
  });
});

describe("runTick", () => {
  it("sends a summary on aligned ticks, and not twice for unchanged data", async () => {
    const { env, provider, fetchFn, posted } = setup({ "7203": quote() });
    expect(await runTick(env, jst("15:30"), provider, fetchFn)).toEqual(["summary"]);
    expect(posted[0]).toMatchObject({ topic: "t", title: "株価", message: "トヨタ 2,989.5 ▲20.5 +0.69% 15:30" });
    expect(await runTick(env, jst("16:00"), provider, fetchFn)).toEqual([]);
  });
  it("sends an alert when the step is crossed", async () => {
    const { env, provider, fetchFn, posted } = setup({ "7203": quote({ changePct: -2.5, change: -75 }) });
    expect(await runTick(env, jst("10:05"), provider, fetchFn)).toEqual(["alert:7203"]);
    expect(posted[0].title).toBe("下落アラート トヨタ");
    expect(await runTick(env, jst("10:10"), provider, fetchFn)).toEqual([]);
  });
  it("stays quiet on holidays (quote dated another day)", async () => {
    const { env, provider, fetchFn } = setup({ "7203": quote({ changePct: 5 }) });
    expect(await runTick(env, jst("10:00", "2026-09-28"), provider, fetchFn)).toEqual([]);
  });
  it("stays quiet outside the window", async () => {
    const { env, provider, fetchFn } = setup({ "7203": quote({ changePct: 5 }) });
    expect(await runTick(env, jst("20:00"), provider, fetchFn)).toEqual([]);
  });
});

describe("fetch /quote", () => {
  it("rejects missing token", async () => {
    const { env } = setup({});
    const res = await worker.fetch(new Request("https://x/quote"), env);
    expect(res.status).toBe(404);
  });
});
