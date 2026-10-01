import { describe, expect, it } from "vitest";
import { handle, validate, type Env } from "../signup/src/index";

const ORIGIN = "https://no-map-sandbox.vercel.app";

class MemKV {
  m = new Map<string, { v: string; meta?: unknown }>();
  async get(k: string, t?: string) {
    const e = this.m.get(k);
    if (!e) return null;
    return t === "json" ? JSON.parse(e.v) : e.v;
  }
  async put(k: string, v: string, opts?: { metadata?: unknown }) {
    this.m.set(k, { v, meta: opts?.metadata });
  }
  async delete(k: string) {
    this.m.delete(k);
  }
  async list({ prefix = "" }: { prefix?: string }) {
    const keys = [...this.m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.meta }));
    return { keys, list_complete: true, cursor: "" };
  }
}

function setup() {
  const env = { SIGNUPS: new MemKV() as unknown as KVNamespace, ADMIN_TOKEN: "admin", ALLOWED_ORIGINS: ORIGIN } satisfies Env;
  let ip = 0;
  const post = (path: string, body: unknown, origin = ORIGIN, sameIp = false) =>
    handle(
      new Request(`https://signup.example${path}`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: { Origin: origin, "CF-Connecting-IP": sameIp ? "1.1.1.1" : `10.0.0.${++ip}` },
      }),
      env,
    );
  const get = (path: string, token?: string) =>
    handle(new Request(`https://signup.example${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }), env);
  return { env, post, get };
}

describe("validate", () => {
  it("accepts the choices on the page and normalizes email", () => {
    expect(validate({ price: "500", device: "iphone", lang: "en", email: " A@B.jp " })).toEqual({
      signup: { price: "500", device: "iphone", lang: "en", email: "a@b.jp" },
    });
    expect(validate({ price: "free", device: "android", email: "" }).signup).toEqual({ price: "free", device: "android", lang: "ja" });
  });
  it("rejects anything else", () => {
    expect(validate({ price: "999", device: "iphone" }).error).toBe("price");
    expect(validate({ price: "300", device: "pc" }).error).toBe("device");
    expect(validate({ price: "300", device: "iphone", email: "not-an-email" }).error).toBe("email");
    expect(validate(undefined).error).toBe("invalid body");
  });
});

describe("signup endpoint", () => {
  it("stores a sign-up and counts it in the tally", async () => {
    const { post, get } = setup();
    expect((await post("/signup", { price: "500", device: "iphone", lang: "ja", email: "a@b.jp" })).status).toBe(200);
    expect((await post("/signup", { price: "free", device: "android", lang: "en" })).status).toBe(200);
    const t = await (await get("/tally", "admin")).json();
    expect(t).toMatchObject({ total: 2, paid: 1, withEmail: 1, byPrice: { "500": 1, free: 1 }, byDevice: { iphone: 1, android: 1 }, byLang: { ja: 1, en: 1 } });
  });

  it("allows only the landing page origin, and answers CORS preflight", async () => {
    const { post, env } = setup();
    expect((await post("/signup", { price: "500", device: "iphone" }, "https://evil.example")).status).toBe(403);
    const pre = await handle(new Request("https://signup.example/signup", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("does not double count the same email, and lets the person delete it", async () => {
    const { post, get } = setup();
    await post("/signup", { price: "300", device: "iphone", email: "a@b.jp" });
    await post("/signup", { price: "1000", device: "iphone", email: "A@B.jp" });
    let t = await (await get("/tally", "admin")).json();
    expect(t).toMatchObject({ total: 1, byPrice: { "1000": 1 } });
    expect((await post("/delete", { email: "a@b.jp" })).status).toBe(200);
    t = await (await get("/tally", "admin")).json();
    expect(t.total).toBe(0);
  });

  it("ignores the honeypot and limits repeated posts from one address", async () => {
    const { post, get } = setup();
    expect((await post("/signup", { price: "500", device: "iphone", website: "spam" })).status).toBe(200);
    expect((await (await get("/tally", "admin")).json()).total).toBe(0);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post("/signup", { price: "free", device: "other" }, ORIGIN, true)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("keeps no IP address in stored records", async () => {
    const { post, env } = setup();
    await post("/signup", { price: "500", device: "iphone", email: "a@b.jp" }, ORIGIN, true);
    const stored = [...(env.SIGNUPS as unknown as MemKV).m.values()].map((e) => e.v + JSON.stringify(e.meta ?? ""));
    expect(stored.some((s) => s.includes("1.1.1.1"))).toBe(false);
  });

  it("protects tally and export with the admin token", async () => {
    const { post, get } = setup();
    await post("/signup", { price: "500", device: "iphone", email: "a@b.jp" });
    expect((await get("/tally")).status).toBe(401);
    expect((await get("/export", "wrong")).status).toBe(401);
    const csv = await (await get("/export", "admin")).text();
    expect(csv.split("\n")[1]).toMatch(/^a@b\.jp,500,iphone,ja,2\d{3}-/);
  });

  it("returns 400 for a malformed body", async () => {
    const { post } = setup();
    expect((await post("/signup", "{not json")).status).toBe(400);
  });
});
