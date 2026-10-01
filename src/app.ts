// Static PWA assets served by the Worker. The page holds no secrets; every API call needs the access token.

export const MANIFEST = JSON.stringify({
  id: "/",
  name: "watchStock",
  description: "日本株の値動きを、スマホと腕時計に通知します",
  lang: "ja",
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
.form { display:grid; gap:14px; }
.form label { display:grid; gap:6px; font-weight:600; font-size:15px; }
.form .muted { font-weight:400; }
textarea, select { font:inherit; width:100%; padding:10px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--fg); }
.err { color:var(--down); }
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
    <p class="muted">設置のときに決めた合言葉を入力してください。この端末にだけ保存されます。</p>
    <div class="row"><input id="token" type="password" autocomplete="off"><button class="primary" id="save">はじめる</button></div>
    <p class="muted" id="loginErr"></p>
  </section>

  <div id="app" hidden>
    <div class="note" id="installHint" hidden>
      <span id="hintIOS" hidden>iPhone で通知を受け取るには、Safari の共有ボタン →「ホーム画面に追加」をして、追加したアイコンから開き直してください。</span>
      <span id="hintAndroid" hidden>ホーム画面に追加すると、アプリのように開けます。下のボタンか、Chrome のメニュー（︙）→「ホーム画面に追加」（または「アプリをインストール」）を押してください。通知はこのままでも受け取れます。</span>
      <div class="row" style="margin-top:8px"><button id="installBtn" hidden>ホーム画面に追加</button></div>
    </div>

    <section>
      <h2>株価 <span class="muted" id="delayLabel">（約 15 分遅れ）</span></h2>
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
      <h2>通知の設定</h2>
      <form id="settingsForm" class="form">
        <label>銘柄 <span class="muted">1 行に 1 銘柄。「コード 表示名」の形で、表示名は省略可。最大 10 銘柄</span>
          <textarea id="symbols" rows="4" placeholder="7203 トヨタ&#10;6758 ソニー"></textarea></label>
        <label>まとめ通知 <span class="muted">全銘柄の株価を定期的に送る</span>
          <select id="summary">
            <option value="0">送らない</option><option value="15">15 分ごと</option><option value="30">30 分ごと</option>
            <option value="60">1 時間ごと</option><option value="120">2 時間ごと</option>
          </select></label>
        <label>値動きアラート <span class="muted">前日比がこの幅を新たに超えるたびに送る</span>
          <select id="step">
            <option value="0">送らない</option><option value="1">±1% ごと</option><option value="2">±2% ごと</option>
            <option value="3">±3% ごと</option><option value="5">±5% ごと</option>
          </select></label>
        <div class="row"><button class="primary" type="submit" id="saveSettings">保存</button></div>
        <p class="muted" id="settingsResult"></p>
      </form>
    </section>

    <section>
      <h2>この端末</h2>
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
  if (res.status === 503) throw new Error("no_access_token");
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

function setSelect(sel, value, text) {
  if (![...sel.options].some((o) => Number(o.value) === value)) sel.add(new Option(text, String(value)));
  sel.value = String(value);
}

async function loadConfig() {
  const { settings: st, subscriptions, delay } = await api("/api/status");
  if (delay && delay.samples > 0) $("delayLabel").textContent = "（" + delay.date.slice(5).replace("-", "/") + " の実測で約 " + Math.round(delay.sum / delay.samples) + " 分遅れ）";
  $("symbols").value = st.symbols.map((s) => (s.code + " " + s.label).trim()).join("\\n");
  setSelect($("summary"), st.summaryEveryMin, st.summaryEveryMin + " 分ごと");
  setSelect($("step"), st.alertStepPct, "±" + st.alertStepPct + "% ごと");
  $("config").textContent = "通知を受け取る端末: " + subscriptions + " 台";
}

$("settingsForm").onsubmit = async (e) => {
  e.preventDefault();
  const symbols = $("symbols").value.split("\\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [code, ...rest] = l.split(/[\\s:：]+/); return { code, label: rest.join(" ") }; });
  const body = { symbols, summaryEveryMin: Number($("summary").value), alertStepPct: Number($("step").value) };
  $("saveSettings").disabled = true; $("settingsResult").className = "muted"; $("settingsResult").textContent = "銘柄を確認中…";
  try {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const r = await res.json();
    if (res.status === 401) return handleErr(new Error("unauthorized"));
    if (!res.ok) { $("settingsResult").className = "err"; $("settingsResult").innerHTML = (r.errors || ["保存できませんでした"]).map(esc).join("<br>"); }
    else { $("settingsResult").textContent = "保存しました。次の通知から反映されます"; loadConfig(); loadQuotes(); }
  } catch (err) { $("settingsResult").className = "err"; $("settingsResult").textContent = "保存できませんでした: " + err.message; }
  $("saveSettings").disabled = false;
};

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isAndroid = /Android/.test(navigator.userAgent);
// Chrome on Android offers its own install prompt; keep it for our button.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("installBtn").hidden = false; });
window.addEventListener("appinstalled", () => { $("installHint").hidden = true; });
$("installBtn").onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  $("installBtn").hidden = true;
  if (outcome === "accepted") $("installHint").hidden = true;
};

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
  catch (e) {
    $("loginErr").textContent = e.message === "no_access_token"
      ? "合言葉がまだ設定されていません。Cloudflare の管理画面で、この Worker の「設定」→「変数とシークレット」（Settings → Variables and Secrets）に、名前 ACCESS_TOKEN・種類「シークレット」で合言葉を追加してから、もう一度入力してください。"
      : "合言葉が違います";
  }
};
$("logout").onclick = () => { store.set(null); location.reload(); };

function handleErr(e) { if (e.message === "unauthorized") { store.set(null); location.reload(); } }

function start() {
  $("login").hidden = true; $("app").hidden = false;
  $("installHint").hidden = !((isIOS || isAndroid) && !standalone);
  $("hintIOS").hidden = !isIOS;
  $("hintAndroid").hidden = !isAndroid;
  loadQuotes(); loadHistory(); loadConfig().catch(handleErr); refreshPushState();
  setInterval(loadQuotes, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadQuotes(); loadHistory(); } });
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
if (token) start(); else $("login").hidden = false;
</script>
</body>
</html>`;
