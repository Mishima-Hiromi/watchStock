// Pre-registration for a real-time version of watchStock, posted from the landing page.
// Stores only what the person chose (price, device, language) and an optional email.
// No IP address is stored; a salted hash is kept for one day to limit repeated posts.

export interface Env {
  SIGNUPS: KVNamespace;
  /** Secret. Required as Bearer token for /tally and /export. */
  ADMIN_TOKEN: string;
  /** Comma-separated origins allowed to post, e.g. "https://no-map-sandbox.vercel.app". */
  ALLOWED_ORIGINS: string;
}

export const PRICES = ["free", "300", "500", "1000", "more"] as const;
export const DEVICES = ["iphone", "android", "other"] as const;
export const LANGS = ["ja", "en"] as const;
const PAID = new Set(["300", "500", "1000", "more"]);
const MAX_POSTS_PER_DAY = 5;

export interface Signup {
  price: (typeof PRICES)[number];
  device: (typeof DEVICES)[number];
  lang: (typeof LANGS)[number];
  email?: string;
  at: number;
}
type Meta = Omit<Signup, "email"> & { hasEmail: boolean };

const te = new TextEncoder();
async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(body: any): { signup?: Omit<Signup, "at">; error?: string } {
  if (!body || typeof body !== "object") return { error: "invalid body" };
  if (!PRICES.includes(body.price)) return { error: "price" };
  if (!DEVICES.includes(body.device)) return { error: "device" };
  const lang = LANGS.includes(body.lang) ? body.lang : "ja";
  let email: string | undefined;
  if (body.email != null && String(body.email).trim() !== "") {
    email = String(body.email).trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) return { error: "email" };
  }
  return { signup: { price: body.price, device: body.device, lang, ...(email ? { email } : {}) } };
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : {};
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

async function overLimit(req: Request, env: Env, now: number): Promise<boolean> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `rl:${await sha256(`${env.ADMIN_TOKEN}:${ip}:${day}`)}`;
  const n = Number((await env.SIGNUPS.get(key)) ?? "0");
  if (n >= MAX_POSTS_PER_DAY) return true;
  await env.SIGNUPS.put(key, String(n + 1), { expirationTtl: 86400 });
  return false;
}

/** Keyed by email hash when an email is given, so re-registering updates instead of double counting. */
async function recordKey(email: string | undefined): Promise<string> {
  return email ? `r:e:${await sha256(email)}` : `r:a:${crypto.randomUUID()}`;
}

export interface Tally {
  total: number;
  paid: number;
  withEmail: number;
  byPrice: Record<string, number>;
  byDevice: Record<string, number>;
  byLang: Record<string, number>;
  first?: number;
  last?: number;
}

export async function tally(kv: KVNamespace): Promise<Tally> {
  const t: Tally = { total: 0, paid: 0, withEmail: 0, byPrice: {}, byDevice: {}, byLang: {} };
  let cursor: string | undefined;
  do {
    const page = await kv.list<Meta>({ prefix: "r:", cursor });
    for (const k of page.keys) {
      const m = k.metadata;
      if (!m) continue;
      t.total++;
      if (PAID.has(m.price)) t.paid++;
      if (m.hasEmail) t.withEmail++;
      t.byPrice[m.price] = (t.byPrice[m.price] ?? 0) + 1;
      t.byDevice[m.device] = (t.byDevice[m.device] ?? 0) + 1;
      t.byLang[m.lang] = (t.byLang[m.lang] ?? 0) + 1;
      t.first = Math.min(t.first ?? m.at, m.at);
      t.last = Math.max(t.last ?? m.at, m.at);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return t;
}

const admin = (req: Request, env: Env) =>
  !!env.ADMIN_TOKEN && req.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(req.url);
  const c = cors(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });

  if (req.method === "POST" && url.pathname === "/signup") {
    if (!c["Access-Control-Allow-Origin"]) return json({ error: "origin" }, 403);
    const body = await readJson(req);
    // Honeypot: a hidden field people never fill in. Pretend success so bots learn nothing.
    if (body?.website) return json({ ok: true }, 200, c);
    const { signup, error } = validate(body);
    if (!signup) return json({ error }, 400, c);
    if (await overLimit(req, env, now)) return json({ error: "too_many" }, 429, c);
    const key = await recordKey(signup.email);
    const meta: Meta = { price: signup.price, device: signup.device, lang: signup.lang, hasEmail: !!signup.email, at: now };
    await env.SIGNUPS.put(key, JSON.stringify({ ...signup, at: now }), { metadata: meta });
    return json({ ok: true }, 200, c);
  }

  if (req.method === "POST" && url.pathname === "/delete") {
    if (!c["Access-Control-Allow-Origin"]) return json({ error: "origin" }, 403);
    const email = String((await readJson(req))?.email ?? "").trim().toLowerCase();
    // Same answer whether or not the address was registered, so this can't be used to probe the list.
    if (EMAIL_RE.test(email)) await env.SIGNUPS.delete(await recordKey(email));
    return json({ ok: true }, 200, c);
  }

  if (req.method === "GET" && url.pathname === "/tally") {
    if (!admin(req, env)) return json({ error: "unauthorized" }, 401);
    return json(await tally(env.SIGNUPS));
  }

  if (req.method === "GET" && url.pathname === "/export") {
    if (!admin(req, env)) return json({ error: "unauthorized" }, 401);
    const rows = ["email,price,device,lang,registered_at"];
    let cursor: string | undefined;
    do {
      const page = await env.SIGNUPS.list<Meta>({ prefix: "r:e:", cursor });
      for (const k of page.keys) {
        const s = await env.SIGNUPS.get<Signup>(k.name, "json");
        if (s?.email) rows.push([s.email, s.price, s.device, s.lang, new Date(s.at).toISOString()].join(","));
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return new Response(rows.join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
  }

  return json({ error: "not found" }, 404);
}

export default { fetch: (req: Request, env: Env) => handle(req, env) } satisfies ExportedHandler<Env>;
