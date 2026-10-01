import { describe, expect, it } from "vitest";
import { parseYahooChart, type Quote, type QuoteProvider } from "../src/quote";
import { checkAlert } from "../src/alerts";
import { formatLine } from "../src/format";
import { inWatchWindow, isSummaryTick, jstDate } from "../src/market";
import { handleFetch, parseSymbols, runTick, type Env } from "../src/index";
import type { Message } from "../src/push";
import { validateSettings } from "../src/settings";
import { SERVICE_WORKER } from "../src/app";

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
  const posted: Message[] = [];
  const env = {
    STATE: new MemKV() as unknown as KVNamespace,
    SYMBOLS: Object.keys(quotes).join(","),
    SUMMARY_EVERY_MIN: "30",
    ALERT_STEP_PCT: "2",
    ACCESS_TOKEN: "secret",
  } satisfies Env;
  const provider: QuoteProvider = {
    get: async (code) => {
      const q = quotes[code];
      if (q instanceof Error) throw q;
      return q;
    },
  };
  const notify = async (m: Message) => {
    posted.push(m);
  };
  return { env, provider, notify, posted };
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
  it("starts over when the step changes", () => {
    const s = checkAlert(4.1, 2, "d", undefined); // level 2 at 2% steps
    expect(checkAlert(1.5, 1, "d", s.state)).toMatchObject({ alert: true, state: { step: 1, maxUp: 1 } });
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
    const { env, provider, notify, posted } = setup({ "7203": quote() });
    expect(await runTick(env, jst("15:30"), provider, notify)).toEqual(["summary"]);
    expect(posted[0]).toMatchObject({ kind: "summary", title: "株価", body: "トヨタ 2,989.5 ▲20.5 +0.69% 15:30" });
    expect(await runTick(env, jst("16:00"), provider, notify)).toEqual([]);
  });
  it("sends an alert when the step is crossed", async () => {
    const { env, provider, notify, posted } = setup({ "7203": quote({ changePct: -2.5, change: -75 }) });
    expect(await runTick(env, jst("10:05"), provider, notify)).toEqual(["alert:7203"]);
    expect(posted[0].title).toBe("下落アラート トヨタ");
    expect(await runTick(env, jst("10:10"), provider, notify)).toEqual([]);
  });
  it("stays quiet on holidays (quote dated another day)", async () => {
    const { env, provider, notify } = setup({ "7203": quote({ changePct: 5 }) });
    expect(await runTick(env, jst("10:00", "2026-09-28"), provider, notify)).toEqual([]);
  });
  it("stays quiet outside the window", async () => {
    const { env, provider, notify } = setup({ "7203": quote({ changePct: 5 }) });
    expect(await runTick(env, jst("20:00"), provider, notify)).toEqual([]);
  });
});

describe("HTTP routes", () => {
  const req = (path: string, init: RequestInit = {}, token?: string) =>
    new Request(`https://ws.example${path}`, {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    });

  it("serves the PWA shell without a token", async () => {
    const { env, provider, notify } = setup({});
    for (const p of ["/", "/manifest.webmanifest", "/sw.js", "/icon-180.png"]) {
      expect((await handleFetch(req(p), env, provider, notify)).status).toBe(200);
    }
    // The page script lives inside a TS template literal; escapes there are easy to break.
    const html = await (await handleFetch(req("/"), env, provider, notify)).text();
    const script = html.split("<script>")[1].split("</script>")[0];
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain(String.raw`.split(/[\s:：]+/)`);
    expect(() => new Function(SERVICE_WORKER)).not.toThrow();
    const icon = await handleFetch(req("/icon-180.png"), env, provider, notify);
    expect(new Uint8Array(await icon.arrayBuffer()).slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  });

  it("rejects API and /quote without the right token", async () => {
    const { env, provider, notify } = setup({});
    expect((await handleFetch(req("/api/status"), env, provider, notify)).status).toBe(401);
    expect((await handleFetch(req("/api/status", {}, "wrong"), env, provider, notify)).status).toBe(401);
    expect((await handleFetch(req("/quote"), env, provider, notify)).status).toBe(404);
  });

  it("subscribe -> status -> unsubscribe", async () => {
    const { env, provider, notify } = setup({ "7203": quote() });
    const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "x", auth: "y" } };
    const r1 = await handleFetch(req("/api/subscribe", { method: "POST", body: JSON.stringify(sub) }, "secret"), env, provider, notify);
    expect(await r1.json()).toEqual({ subscriptions: 1 });
    expect(await env.STATE.get("meta:origin")).toBe("https://ws.example");
    const bad = await handleFetch(req("/api/subscribe", { method: "POST", body: JSON.stringify({ endpoint: "http://x" }) }, "secret"), env, provider, notify);
    expect(bad.status).toBe(400);
    const st = await (await handleFetch(req("/api/status", {}, "secret"), env, provider, notify)).json();
    expect(st).toMatchObject({ settings: { symbols: [{ code: "7203", label: "" }], summaryEveryMin: 30, alertStepPct: 2 }, subscriptions: 1 });
    const r2 = await handleFetch(req("/api/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }, "secret"), env, provider, notify);
    expect(await r2.json()).toEqual({ subscriptions: 0 });
  });

  it("test sends use real wording, marked as samples", async () => {
    const { env, provider, notify, posted } = setup({ "7203": quote({ changePct: -2.5, change: -75 }) });
    for (const kind of ["test", "alert", "summary"]) {
      await handleFetch(req("/api/test", { method: "POST", body: JSON.stringify({ kind }) }, "secret"), env, provider, notify);
    }
    expect(posted.map((m) => m.title)).toEqual(["テスト通知", "下落アラート トヨタ（見本）", "株価（見本）"]);
    expect(posted.every((m) => m.kind === "test")).toBe(true);
    expect(posted[1].body).toBe("トヨタ 2,989.5 ▼75 -2.50% 15:30");
  });

  it("/quote returns plain text for the shortcut", async () => {
    const { env, provider, notify } = setup({ "7203": quote() });
    const res = await handleFetch(req("/quote?token=secret"), env, provider, notify);
    expect(await res.text()).toBe("トヨタ 2,989.5 ▲20.5 +0.69% 15:30");
  });
});

describe("user settings", () => {
  const put = (env: Env, provider: QuoteProvider, body: unknown) =>
    handleFetch(
      new Request("https://ws.example/api/settings", { method: "PUT", body: JSON.stringify(body), headers: { Authorization: "Bearer secret" } }),
      env,
      provider,
      async () => {},
    );

  it("validates shape and ranges", () => {
    expect(validateSettings({ symbols: [{ code: "7203" }, { code: "130a", label: "x" }], summaryEveryMin: 60, alertStepPct: 1.5 })).toEqual({
      settings: { symbols: [{ code: "7203", label: "" }, { code: "130A", label: "x" }], summaryEveryMin: 60, alertStepPct: 1.5 },
      errors: [],
    });
    const bad = validateSettings({ symbols: [{ code: "72" }, { code: "7203" }, { code: "7203" }], summaryEveryMin: 7, alertStepPct: 0.1 });
    expect(bad.settings).toBeUndefined();
    expect(bad.errors).toHaveLength(4);
    expect(validateSettings({ symbols: Array.from({ length: 11 }, (_, i) => ({ code: String(1000 + i) })), summaryEveryMin: 0, alertStepPct: 0 }).errors).toEqual(["銘柄は 10 個までです"]);
  });

  it("saves, and the next tick uses the saved settings", async () => {
    const { env, provider, notify, posted } = setup({ "7203": quote(), "6758": quote({ code: "6758", label: "ソニー", changePct: 1.2, change: 44 }) });
    env.SYMBOLS = "7203";
    const res = await put(env, provider, { symbols: [{ code: "6758", label: "ソニー" }], summaryEveryMin: 0, alertStepPct: 1 });
    expect(res.status).toBe(200);
    expect(await runTick(env, jst("10:00"), provider, notify)).toEqual(["alert:6758"]); // summary off, 1% step
    expect(posted[0].title).toBe("上昇アラート ソニー");
  });

  it("returns 400 for a malformed body", async () => {
    const { env, provider } = setup({ "7203": quote() });
    const res = await handleFetch(
      new Request("https://ws.example/api/settings", { method: "PUT", body: "{not json", headers: { Authorization: "Bearer secret" } }),
      env, provider, async () => {},
    );
    expect(res.status).toBe(400);
  });

  it("rejects codes the data source does not know", async () => {
    const { env, provider } = setup({ "7203": quote(), "9999": new Error("9999: HTTP 404") });
    const res = await put(env, provider, { symbols: [{ code: "7203" }, { code: "9999" }], summaryEveryMin: 30, alertStepPct: 2 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: ["銘柄コード「9999」の株価を取得できません"] });
    expect(await env.STATE.get("settings")).toBeNull();
  });
});

describe("feed delay measurement", () => {
  it("records the age of the freshest quote during continuous trading only", async () => {
    const { recordDelay } = await import("../src/delay");
    const q = (hhmm: string) => quote({ marketTime: jst(hhmm) / 1000 });
    const a = recordDelay(jst("10:30"), [q("10:08"), q("10:10")], null)!;
    expect(a).toMatchObject({ date: "2026-09-25", samples: 1, min: 20, max: 20 });
    const b = recordDelay(jst("10:35"), [q("10:14")], a)!;
    expect(b).toMatchObject({ samples: 2, min: 20, max: 21, sum: 41 });
    expect(recordDelay(jst("12:00"), [q("11:30")], b)).toBeUndefined(); // lunch break
    expect(recordDelay(jst("15:40"), [q("15:30")], b)).toBeUndefined(); // after close
  });

  it("is stored by the cron tick and reported by /api/status", async () => {
    const { env, provider, notify } = setup({ "7203": quote({ marketTime: jst("10:10") / 1000 }) });
    await runTick(env, jst("10:30"), provider, notify);
    const res = await handleFetch(new Request("https://ws.example/api/status", { headers: { Authorization: "Bearer secret" } }), env, provider, notify);
    expect((await res.json()).delay).toMatchObject({ samples: 1, min: 20, max: 20 });
  });
});

describe("missing ACCESS_TOKEN", () => {
  it("tells the app the secret is not set, instead of looking like a wrong password", async () => {
    const { env, provider, notify } = setup({ "7203": quote() });
    env.ACCESS_TOKEN = "";
    const res = await handleFetch(new Request("https://ws.example/api/status", { headers: { Authorization: "Bearer x" } }), env, provider, notify);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "no_access_token" });
  });
});
