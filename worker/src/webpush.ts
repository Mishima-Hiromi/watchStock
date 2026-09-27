// Web Push sender using only WebCrypto: RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID).

const te = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

export const b64u = {
  encode(data: ArrayBuffer | Uint8Array): string {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(s: string): Bytes {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url. Given to the browser as applicationServerKey. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer;
  const privateJwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  return { publicKey: b64u.encode(pub), privateJwk };
}

/** RFC 8291 single-record aes128gcm body. `salt`/`senderKeys` are injectable for tests only. */
export async function encryptPayload(
  sub: PushSub,
  plaintext: Bytes,
  salt: Bytes = crypto.getRandomValues(new Uint8Array(16)),
  senderKeys?: CryptoKeyPair,
): Promise<Bytes> {
  const uaPub = b64u.decode(sub.keys.p256dh);
  const auth = b64u.decode(sub.keys.auth);
  const as = senderKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPub = new Uint8Array((await crypto.subtle.exportKey("raw", as.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as any, as.privateKey, 256));

  const ikm = await hkdf(auth, ecdh, concat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 = padding delimiter for the last (only) record.
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowSec: number): Promise<string> {
  const header = b64u.encode(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(
    te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })),
  );
  const priv = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, te.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${keys.publicKey}`;
}

export async function sendPush(
  sub: PushSub,
  payload: unknown,
  keys: VapidKeys,
  subject: string,
  opts: { ttlSec: number; urgency: "normal" | "high" },
  fetchFn: typeof fetch = (i, init) => fetch(i, init),
): Promise<Response> {
  const body = await encryptPayload(sub, te.encode(JSON.stringify(payload)));
  return fetchFn(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, keys, subject, Math.floor(Date.now() / 1000)),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttlSec),
      Urgency: opts.urgency,
    },
    body,
  });
}
