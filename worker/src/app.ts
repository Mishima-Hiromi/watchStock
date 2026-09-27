// Static PWA assets served by the Worker. The page holds no secrets; every API call needs the access token.

export const MANIFEST = JSON.stringify({
  name: "watchStock",
  short_name: "株価",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#0f172a",
  theme_color: "#0f172a",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
});

export const SERVICE_WORKER = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: "watchStock", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "watchStock", {
    body: d.body || "", tag: d.tag, icon: "/icon-192.png", badge: "/icon-192.png",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => cs.length ? cs[0].focus() : self.clients.openWindow("/")));
});
`;

export const APP_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f172a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="株価">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>watchStock</title>
<style>
:root { --bg:#f8fafc; --card:#fff; --fg:#0f172a; --muted:#64748b; --line:#e2e8f0; --up:#16a34a; --down:#dc2626; --accent:#2563eb; --warn:#fef3c7; --warn-fg:#92400e; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f172a; --card:#1e293b; --fg:#f1f5f9; --muted:#94a3b8; --line:#334155; --up:#4ade80; --down:#f87171; --accent:#60a5fa; --warn:#422006; --warn-fg:#fde68a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif; padding:calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 24px); }
main { max-width:520px; margin:0 auto; display:grid; gap:14px; }
h1 { font-size:20px; margin:0; }
h2 { font-size:14px; margin:0 0 10px; color:var(--muted); font-weight:600; }
section { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; }
button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:10px; padding:10px 12px; cursor:pointer; }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
button:disabled { opacity:.5; }
input { font:inherit; width:100%; padding:10px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--fg); }
.row { display:flex; gap:8px; flex-wrap:wrap; }
.q { display:grid; grid-template-columns:1fr auto; align-items:baseline; padding:8px 0; border-bottom:1px solid var(--line); }
.q:last-child { border-bottom:0; }
.q .name { font-weight:600; }
.q .price { font-size:24px; font-weight:700; font-variant-numeric:tabular-nums; text-align:right; }
.q .chg { grid-column:2; text-align:right; font-variant-numeric:tabular-nums; }
.q .time { grid-column:1; grid-row:2; color:var(--muted); font-size:12px; }
.up { color:var(--up); } .down { color:var(--down); }
.muted { color:var(--muted); font-size:13px; }
.note { background:var(--warn); color:var(--warn-fg); border-radius:10px; padding:10px 12px; font-size:14px; line-height:1.6; }
.hist { list-style:none; margin:0; padding:0; }
.hist li { padding:8px 0; border-bottom:1px solid var(--line); font-size:14px; }
.hist li:last-child { border-bottom:0; }
.hist .meta { color:var(--muted); font-size:12px; }
.hist pre { margin:4px 0 0; white-space:pre-wrap; font:inherit; }
code { word-break:break-all; font-size:12px; }
[hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1>watchStock</h1>

  <section id="login" hidden>
    <h2>合言葉</h2>
    <p class="muted">デプロイ時に設定した ACCESS_TOKEN を入力してください。この端末にだけ保存されます。</p>
    <div class="row"><input id="token" type="password" autocomplete="off"><button class="primary" id="save">保存</button></div>
    <p class="muted" id="loginErr"></p>
  </section>

  <div id="app" hidden>
    <div class="note" id="installHint" hidden>
      iPhone で通知を受け取るには、Safari の共有ボタン →「ホーム画面に追加」をして、追加したアイコンから開き直してください。
    </div>

    <section>
      <h2>株価 <span class="muted">（約 20 分遅れ）</span></h2>
      <div id="quotes" class="muted">読み込み中…</div>
      <p class="muted" id="updated"></p>
    </section>

    <section>
      <h2>通知</h2>
      <p id="pushState" class="muted"></p>
      <div class="row">
        <button class="primary" id="enable">通知をオン</button>
        <button id="disable" hidden>この端末の通知をオフ</button>
      </div>
      <p class="muted" style="margin-top:12px">送信テスト（登録済みの全端末に届きます）</p>
      <div class="row">
        <button data-test="test">テスト通知</button>
        <button data-test="alert">アラートの見本</button>
        <button data-test="summary">まとめの見本</button>
      </div>
      <p class="muted" id="testResult"></p>
    </section>

    <section>
      <h2>送信履歴</h2>
      <ul class="hist" id="history"><li class="muted">まだありません</li></ul>
    </section>

    <section>
      <h2>Watch のショートカット用 URL</h2>
      <p class="muted">ショートカットの「URL の内容を取得」に貼り付けます。合言葉を含むので他人に見せないでください。</p>
      <div class="row"><button id="copy">URL をコピー</button></div>
      <p class="muted" id="copyResult"></p>
    </section>

    <section>
      <h2>設定</h2>
      <p class="muted" id="config"></p>
      <div class="row"><button id="logout">合言葉を消す</button></div>
    </section>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const store = { get: () => { try { return localStorage.getItem("token"); } catch { return null; } },
                set: (v) => { try { v ? localStorage.setItem("token", v) : localStorage.removeItem("token"); } catch {} } };
let token = store.get();

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
const fmt = (n, d = 1) => n.toLocaleString("ja-JP", { maximumFractionDigits: d });
const hhmm = (sec) => new Date(sec * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function loadQuotes() {
  try {
    const { quotes } = await api("/api/quotes");
    $("quotes").className = "";
    $("quotes").innerHTML = quotes.map((q) => q.error
      ? '<div class="q"><span class="name">⚠ ' + esc(q.error) + '</span></div>'
      : '<div class="q"><span class="name">' + esc(q.label) + ' <span class="muted">' + esc(q.code) + '</span></span>'
        + '<span class="price">' + fmt(q.price) + '</span>'
        + '<span class="time">' + hhmm(q.marketTime) + ' 時点</span>'
        + '<span class="chg ' + (q.change > 0 ? "up" : q.change < 0 ? "down" : "") + '">'
        + (q.change > 0 ? "▲" : q.change < 0 ? "▼" : "±") + fmt(Math.abs(q.change)) + ' (' + (q.changePct >= 0 ? "+" : "") + q.changePct.toFixed(2) + '%)</span></div>').join("");
    $("updated").textContent = "取得 " + new Date().toLocaleTimeString("ja-JP");
  } catch (e) { handleErr(e); }
}

async function loadHistory() {
  try {
    const { history } = await api("/api/history");
    $("history").innerHTML = history.length ? history.map((h) =>
      '<li><div class="meta">' + new Date(h.at).toLocaleString("ja-JP") + ' ・ ' + ({ alert: "アラート", summary: "まとめ", test: "テスト" }[h.kind] || h.kind)
      + ' ・ 配信 ' + h.delivered + '/' + h.total + ' 端末</div><strong>' + esc(h.title) + '</strong><pre>' + esc(h.body) + '</pre></li>').join("")
      : '<li class="muted">まだありません</li>';
  } catch (e) { handleErr(e); }
}

async function loadConfig() {
  const c = await api("/api/status");
  $("config").innerHTML = "銘柄: " + esc(c.symbols) + "<br>まとめ: " + (c.summaryEveryMin > 0 ? c.summaryEveryMin + " 分ごと" : "送らない")
    + "<br>アラート: 前日比 " + c.alertStepPct + "% 刻み<br>通知登録: " + c.subscriptions + " 端末"
    + "<br>変更は wrangler.toml を編集して再デプロイ";
}

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

async function currentSub() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function refreshPushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    $("pushState").textContent = isIOS && !standalone ? "ホーム画面に追加したアイコンから開くと通知を設定できます。" : "このブラウザは Web プッシュに対応していません。";
    $("enable").disabled = true; return;
  }
  if (Notification.permission === "denied") { $("pushState").textContent = "通知がブロックされています。端末の設定で許可してください。"; $("enable").disabled = true; return; }
  const sub = await currentSub();
  $("pushState").textContent = sub ? "この端末は通知を受け取ります。" : "この端末はまだ通知を受け取りません。";
  $("enable").hidden = !!sub; $("disable").hidden = !sub;
}

$("enable").onclick = async () => {
  $("enable").disabled = true;
  try {
    if (await Notification.requestPermission() !== "granted") throw new Error("通知が許可されませんでした");
    const { publicKey } = await api("/api/vapid");
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((publicKey.length + 3) % 4)), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api("/api/subscribe", { method: "POST", body: JSON.stringify(sub) });
  } catch (e) { $("pushState").textContent = "失敗: " + e.message; }
  $("enable").disabled = false;
  refreshPushState(); loadConfig();
};

$("disable").onclick = async () => {
  const sub = await currentSub();
  if (sub) { await api("/api/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
  refreshPushState(); loadConfig();
};

document.querySelectorAll("[data-test]").forEach((b) => b.onclick = async () => {
  $("testResult").textContent = "送信中…";
  try {
    const r = await api("/api/test", { method: "POST", body: JSON.stringify({ kind: b.dataset.test }) });
    $("testResult").textContent = r.total ? "送信しました（" + r.delivered + "/" + r.total + " 端末）" : "通知を登録した端末がありません。先に「通知をオン」を押してください。";
  } catch (e) { $("testResult").textContent = "失敗: " + e.message; }
  loadHistory();
});

$("copy").onclick = async () => {
  const url = location.origin + "/quote?token=" + encodeURIComponent(token);
  try { await navigator.clipboard.writeText(url); $("copyResult").textContent = "コピーしました"; }
  catch { $("copyResult").innerHTML = "<code>" + esc(url) + "</code>"; }
};

$("save").onclick = async () => {
  token = $("token").value.trim();
  try { await api("/api/status"); store.set(token); start(); }
  catch { $("loginErr").textContent = "合言葉が違います"; }
};
$("logout").onclick = () => { store.set(null); location.reload(); };

function handleErr(e) { if (e.message === "unauthorized") { store.set(null); location.reload(); } }

function start() {
  $("login").hidden = true; $("app").hidden = false;
  $("installHint").hidden = !(isIOS && !standalone);
  loadQuotes(); loadHistory(); loadConfig().catch(handleErr); refreshPushState();
  setInterval(loadQuotes, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadQuotes(); loadHistory(); } });
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
if (token) start(); else $("login").hidden = false;
</script>
</body>
</html>`;
