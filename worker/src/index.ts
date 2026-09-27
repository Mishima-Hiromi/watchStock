import { YahooQuoteProvider, type Quote, type QuoteProvider } from "./quote";
import { formatLine, formatLines } from "./format";
import { inWatchWindow, isSummaryTick, jstDate } from "./market";
import { checkAlert, type AlertState } from "./alerts";
import { addSub, getHistory, getVapidKeys, listSubs, removeSub, webPushNotifier, type Message, type Notifier } from "./push";
import { APP_HTML, MANIFEST, SERVICE_WORKER } from "./app";
import { ICON_180, ICON_192, ICON_512 } from "./icons";

export interface Env {
  STATE: KVNamespace;
  /** "7203:トヨタ,6758:ソニー" — label after ":" is optional. */
  SYMBOLS: string;
  SUMMARY_EVERY_MIN: string;
  ALERT_STEP_PCT: string;
  /** Secret. Required for the API and /quote. */
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

async function fetchAll(provider: QuoteProvider, symbols: string): Promise<Array<Quote | Error>> {
  return Promise.all(
    parseSymbols(symbols).map(({ code, label }) =>
      provider.get(code, label).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
    ),
  );
}

export const alertMessage = (q: Quote): Message => ({
  kind: "alert",
  title: `${q.changePct > 0 ? "上昇" : "下落"}アラート ${q.label}`,
  body: formatLine(q),
});

export const summaryMessage = (results: Array<Quote | Error>): Message => ({
  kind: "summary",
  title: "株価",
  body: formatLines(results),
});

export async function runTick(
  env: Env,
  nowMs: number,
  provider: QuoteProvider = new YahooQuoteProvider(),
  notify: Notifier = webPushNotifier(env.STATE),
): Promise<string[]> {
  const sent: string[] = [];
  if (!inWatchWindow(nowMs)) return sent;
  const today = jstDate(nowMs);
  const results = await fetchAll(provider, env.SYMBOLS);
  // A quote stamped on another day means the market is closed (holiday): stay quiet.
  const live = results.filter((r): r is Quote => !(r instanceof Error) && jstDate(r.marketTime * 1000) === today);
  if (live.length === 0) return sent;

  const step = Number(env.ALERT_STEP_PCT);
  for (const q of live) {
    const key = `alert:${q.code}`;
    const prev = await env.STATE.get<AlertState>(key, "json");
    const { alert, state } = checkAlert(q.changePct, step, today, prev ?? undefined);
    if (!alert) continue;
    await notify(alertMessage(q));
    await env.STATE.put(key, JSON.stringify(state), { expirationTtl: 3 * 24 * 3600 });
    sent.push(`alert:${q.code}`);
  }

  if (isSummaryTick(nowMs, Number(env.SUMMARY_EVERY_MIN))) {
    // Skip if nothing moved since the last summary (e.g. lunch break, after close).
    const stamp = live.map((q) => `${q.code}@${q.marketTime}`).join(",");
    if ((await env.STATE.get("summary:last")) !== stamp) {
      await notify(summaryMessage(results));
      await env.STATE.put("summary:last", stamp, { expirationTtl: 3 * 24 * 3600 });
      sent.push("summary");
    }
  }
  return sent;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const png = (b64: string) =>
  new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });

function authorized(req: Request, url: URL, env: Env): boolean {
  if (!env.ACCESS_TOKEN) return false;
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return (bearer ?? url.searchParams.get("token")) === env.ACCESS_TOKEN;
}

async function handleApi(
  req: Request,
  url: URL,
  env: Env,
  provider: QuoteProvider,
  notify: Notifier,
): Promise<Response> {
  if (!authorized(req, url, env)) return json({ error: "unauthorized" }, 401);
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case "GET /api/status":
      return json({
        symbols: env.SYMBOLS,
        summaryEveryMin: Number(env.SUMMARY_EVERY_MIN),
        alertStepPct: Number(env.ALERT_STEP_PCT),
        subscriptions: (await listSubs(env.STATE)).length,
      });
    case "GET /api/quotes": {
      const results = await fetchAll(provider, env.SYMBOLS);
      return json({ quotes: results.map((r) => (r instanceof Error ? { error: r.message } : r)) });
    }
    case "GET /api/vapid":
      return json({ publicKey: (await getVapidKeys(env.STATE)).publicKey });
    case "POST /api/subscribe": {
      const sub = (await req.json()) as any;
      if (typeof sub?.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) {
        return json({ error: "invalid subscription" }, 400);
      }
      // Remember our own origin for the VAPID "sub" claim used by cron pushes.
      await env.STATE.put("meta:origin", url.origin);
      return json({ subscriptions: await addSub(env.STATE, sub) });
    }
    case "POST /api/unsubscribe": {
      const { endpoint } = (await req.json()) as { endpoint?: string };
      return json({ subscriptions: endpoint ? await removeSub(env.STATE, endpoint) : (await listSubs(env.STATE)).length });
    }
    case "POST /api/test": {
      const { kind } = (await req.json()) as { kind?: string };
      let msg: Message;
      if (kind === "alert" || kind === "summary") {
        const results = await fetchAll(provider, env.SYMBOLS);
        const first = results.find((r): r is Quote => !(r instanceof Error));
        if (kind === "alert" && !first) return json({ error: "株価を取得できませんでした" }, 502);
        msg = kind === "alert" ? alertMessage(first!) : summaryMessage(results);
        msg = { ...msg, title: `${msg.title}（見本）` };
      } else {
        msg = { kind: "test", title: "テスト通知", body: "watchStock から通知が届きました" };
      }
      await notify({ ...msg, kind: "test" });
      const [last] = await getHistory(env.STATE);
      return json({ delivered: last?.delivered ?? 0, total: last?.total ?? 0 });
    }
    case "GET /api/history":
      return json({ history: await getHistory(env.STATE) });
  }
  return json({ error: "not found" }, 404);
}

export async function handleFetch(
  req: Request,
  env: Env,
  provider: QuoteProvider = new YahooQuoteProvider(),
  notify: Notifier = webPushNotifier(env.STATE),
): Promise<Response> {
  const url = new URL(req.url);
  switch (url.pathname) {
    case "/":
      return new Response(APP_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    case "/manifest.webmanifest":
      return new Response(MANIFEST, { headers: { "Content-Type": "application/manifest+json" } });
    case "/sw.js":
      return new Response(SERVICE_WORKER, { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-cache" } });
    case "/icon-180.png":
      return png(ICON_180);
    case "/icon-192.png":
      return png(ICON_192);
    case "/icon-512.png":
      return png(ICON_512);
    case "/quote": {
      // Plain text for the Apple Watch shortcut.
      if (!authorized(req, url, env)) return new Response("Not found", { status: 404 });
      const only = url.searchParams.get("s");
      const match = only && env.SYMBOLS.split(",").find((x) => x.split(":")[0].trim() === only);
      const text = formatLines(await fetchAll(provider, only ? match || only : env.SYMBOLS));
      return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
  }
  if (url.pathname.startsWith("/api/")) return handleApi(req, url, env, provider, notify);
  return new Response("Not found", { status: 404 });
}

export default {
  fetch: (req: Request, env: Env) => handleFetch(req, env),

  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runTick(env, Date.now()).then((s) => console.log("sent", s)));
  },
} satisfies ExportedHandler<Env>;
