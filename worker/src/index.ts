import { YahooQuoteProvider, type Quote, type QuoteProvider } from "./quote";
import { formatLine, formatLines } from "./format";
import { inWatchWindow, isSummaryTick, jstDate } from "./market";
import { checkAlert, type AlertState } from "./alerts";

export interface Env {
  STATE: KVNamespace;
  /** "7203:トヨタ,6758:ソニー" — label after ":" is optional. */
  SYMBOLS: string;
  SUMMARY_EVERY_MIN: string;
  ALERT_STEP_PCT: string;
  NTFY_SERVER: string;
  /** Secret. Treat like a password: anyone who knows the topic can read it. */
  NTFY_TOPIC: string;
  /** Secret. Required as ?token= on /quote. */
  ACCESS_TOKEN: string;
}

export function parseSymbols(s: string): Array<{ code: string; label: string }> {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [code, label = ""] = x.split(":").map((y) => y.trim());
      return { code, label };
    });
}

async function fetchAll(provider: QuoteProvider, env: Env): Promise<Array<Quote | Error>> {
  return Promise.all(
    parseSymbols(env.SYMBOLS).map(({ code, label }) =>
      provider.get(code, label).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
    ),
  );
}

async function notify(
  env: Env,
  msg: { title: string; message: string; priority?: number; tags?: string[] },
  fetchFn: typeof fetch,
): Promise<void> {
  const res = await fetchFn(env.NTFY_SERVER.replace(/\/$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: env.NTFY_TOPIC, ...msg }),
  });
  if (!res.ok) throw new Error(`ntfy: HTTP ${res.status} ${await res.text()}`);
}

export async function runTick(
  env: Env,
  nowMs: number,
  provider: QuoteProvider = new YahooQuoteProvider(),
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  const sent: string[] = [];
  if (!inWatchWindow(nowMs)) return sent;
  const today = jstDate(nowMs);
  const results = await fetchAll(provider, env);
  // A quote stamped on another day means the market is closed (holiday): stay quiet.
  const live = results.filter((r): r is Quote => !(r instanceof Error) && jstDate(r.marketTime * 1000) === today);
  if (live.length === 0) return sent;

  const step = Number(env.ALERT_STEP_PCT);
  for (const q of live) {
    const key = `alert:${q.code}`;
    const prev = await env.STATE.get<AlertState>(key, "json");
    const { alert, state } = checkAlert(q.changePct, step, today, prev ?? undefined);
    if (!alert) continue;
    const up = q.changePct > 0;
    await notify(
      env,
      { title: `${up ? "上昇" : "下落"}アラート ${q.label}`, message: formatLine(q), priority: 4, tags: [up ? "chart_with_upwards_trend" : "chart_with_downwards_trend"] },
      fetchFn,
    );
    await env.STATE.put(key, JSON.stringify(state), { expirationTtl: 3 * 24 * 3600 });
    sent.push(`alert:${q.code}`);
  }

  if (isSummaryTick(nowMs, Number(env.SUMMARY_EVERY_MIN))) {
    // Skip if nothing moved since the last summary (e.g. lunch break, after close).
    const stamp = live.map((q) => `${q.code}@${q.marketTime}`).join(",");
    if ((await env.STATE.get("summary:last")) !== stamp) {
      await notify(env, { title: "株価", message: formatLines(results), priority: 2 }, fetchFn);
      await env.STATE.put("summary:last", stamp, { expirationTtl: 3 * 24 * 3600 });
      sent.push("summary");
    }
  }
  return sent;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/quote" || !env.ACCESS_TOKEN || url.searchParams.get("token") !== env.ACCESS_TOKEN) {
      return new Response("Not found", { status: 404 });
    }
    const only = url.searchParams.get("s");
    const match = only && env.SYMBOLS.split(",").find((x) => x.split(":")[0].trim() === only);
    const scoped = only ? { ...env, SYMBOLS: match || only } : env;
    const text = formatLines(await fetchAll(new YahooQuoteProvider(), scoped));
    return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  },

  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runTick(env, Date.now()).then((s) => console.log("sent", s)));
  },
} satisfies ExportedHandler<Env>;
