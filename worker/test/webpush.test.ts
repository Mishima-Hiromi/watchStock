import { describe, expect, it } from "vitest";
import { createECDH, randomBytes, webcrypto } from "node:crypto";
import ece from "http_ece";
import { b64u, encryptPayload, generateVapidKeys, sendPush, vapidAuthorization } from "../src/webpush";
import { webPushNotifier, getHistory, addSub } from "../src/push";

// A browser-side subscription with keys we control, so we can decrypt what the server sends.
function fakeBrowser() {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  return {
    ua,
    auth,
    sub: { endpoint: "https://web.push.apple.com/QQ", keys: { p256dh: b64u.encode(ua.getPublicKey()), auth: b64u.encode(auth) } },
    decrypt: (body: Uint8Array) =>
      ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth }).toString("utf8"),
  };
}

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

describe("RFC 8291 encryption", () => {
  it("is decryptable by an independent implementation (http_ece)", async () => {
    const b = fakeBrowser();
    const body = await encryptPayload(b.sub, new TextEncoder().encode('{"title":"株価","body":"トヨタ ▲20.5"}'));
    expect(b.decrypt(body)).toBe('{"title":"株価","body":"トヨタ ▲20.5"}');
    // header: salt(16) + rs(4) + idlen(1) + keyid(65)
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
  });
});

describe("VAPID", () => {
  it("produces an ES256 JWT that verifies with the advertised public key", async () => {
    const keys = await generateVapidKeys();
    const h = await vapidAuthorization("https://web.push.apple.com/QQ", keys, "https://ws.example", 1_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64u.decode(m[2])));
    expect(claims).toEqual({ aud: "https://web.push.apple.com", exp: 1_000 + 12 * 3600, sub: "https://ws.example" });
    const pub = await webcrypto.subtle.importKey("raw", b64u.decode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64u.decode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
    expect(b64u.decode(keys.publicKey).length).toBe(65);
  });
});

describe("sendPush / notifier", () => {
  it("sends required headers and an end-to-end decryptable payload", async () => {
    const b = fakeBrowser();
    const keys = await generateVapidKeys();
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    await sendPush(b.sub, { title: "t", body: "b" }, keys, "https://ws.example", { ttlSec: 1800, urgency: "high" }, fetchFn);
    const hd = captured!.init.headers as Record<string, string>;
    expect(captured!.url).toBe(b.sub.endpoint);
    expect(hd).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "1800", Urgency: "high" });
    expect(hd.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(JSON.parse(b.decrypt(captured!.init.body as Uint8Array))).toEqual({ title: "t", body: "b" });
  });

  it("drops expired subscriptions (410) and records history", async () => {
    const kv = new MemKV() as unknown as KVNamespace;
    const alive = fakeBrowser(), dead = fakeBrowser();
    dead.sub.endpoint = "https://web.push.apple.com/DEAD";
    await addSub(kv, alive.sub);
    await addSub(kv, dead.sub);
    const fetchFn = (async (url: string) => new Response(null, { status: url.endsWith("DEAD") ? 410 : 201 })) as unknown as typeof fetch;
    await webPushNotifier(kv, fetchFn)({ kind: "alert", title: "上昇アラート", body: "x" });
    const subs = JSON.parse((await kv.get("subs"))!);
    expect(subs.map((s: any) => s.endpoint)).toEqual([alive.sub.endpoint]);
    expect((await getHistory(kv))[0]).toMatchObject({ kind: "alert", delivered: 1, total: 2 });
  });
});
