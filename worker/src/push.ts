import { generateVapidKeys, sendPush, type PushSub, type VapidKeys } from "./webpush";

export interface Message {
  title: string;
  body: string;
  kind: "alert" | "summary" | "test";
}

export interface HistoryEntry extends Message {
  at: number;
  delivered: number;
  total: number;
}

export type Notifier = (msg: Message) => Promise<void>;

const HISTORY_MAX = 30;

/** VAPID keys are created on first use and kept in KV, so deployers configure nothing. */
export async function getVapidKeys(kv: KVNamespace): Promise<VapidKeys> {
  const existing = await kv.get<VapidKeys>("vapid:keys", "json");
  if (existing) return existing;
  const keys = await generateVapidKeys();
  await kv.put("vapid:keys", JSON.stringify(keys));
  return keys;
}

export async function listSubs(kv: KVNamespace): Promise<PushSub[]> {
  return (await kv.get<PushSub[]>("subs", "json")) ?? [];
}

export async function addSub(kv: KVNamespace, sub: PushSub): Promise<number> {
  const subs = (await listSubs(kv)).filter((s) => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  await kv.put("subs", JSON.stringify(subs));
  return subs.length;
}

export async function removeSub(kv: KVNamespace, endpoint: string): Promise<number> {
  const subs = (await listSubs(kv)).filter((s) => s.endpoint !== endpoint);
  await kv.put("subs", JSON.stringify(subs));
  return subs.length;
}

export async function getHistory(kv: KVNamespace): Promise<HistoryEntry[]> {
  return (await kv.get<HistoryEntry[]>("history", "json")) ?? [];
}

export function webPushNotifier(kv: KVNamespace, fetchFn?: typeof fetch): Notifier {
  return async (msg) => {
    const subs = await listSubs(kv);
    const keys = await getVapidKeys(kv);
    // Apple requires a contact URL or mailto: in the VAPID "sub" claim; use this Worker's own origin.
    const subject = (await kv.get("meta:origin")) ?? "https://example.invalid";
    let delivered = 0;
    const gone: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          const res = await sendPush(
            s,
            { title: msg.title, body: msg.body, tag: msg.kind === "summary" ? "summary" : undefined },
            keys,
            subject,
            { ttlSec: 30 * 60, urgency: msg.kind === "summary" ? "normal" : "high" },
            fetchFn,
          );
          if (res.ok) delivered++;
          else if (res.status === 404 || res.status === 410) gone.push(s.endpoint);
          else console.log("push failed", res.status, await res.text());
        } catch (e) {
          console.log("push error", e);
        }
      }),
    );
    if (gone.length) await kv.put("subs", JSON.stringify(subs.filter((s) => !gone.includes(s.endpoint))));
    const history = [{ ...msg, at: Date.now(), delivered, total: subs.length }, ...(await getHistory(kv))].slice(0, HISTORY_MAX);
    await kv.put("history", JSON.stringify(history));
  };
}
