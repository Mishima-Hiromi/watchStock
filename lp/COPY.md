# watchStock LP: copy and sign-up API

For the NO MAP SANDBOX team site, page `/projects/watchstock/`. The site session builds the page in its own style; this file supplies the words and the API. `lp/index.html` is a working reference (same copy, same API calls), not the page to ship.

Agreed scope: hub agreements A5 (publish on the team site), A6 (measure demand by pre-registration + desired price), A7 (outline). Tone follows the site's CONTENT_GUIDELINES: first person, matter-of-fact, no superlatives or urgency. The page does not show sign-up counts (site agreement A3).

## Copy

Each item is Japanese, then English.

### Header

- Product name: `watchStock`
- Headline
  - スマホを出せなくても、腕時計で株価の動きが分かる。
  - Know how your stocks move, on your watch, without reaching for your phone.
- Lead
  - 仕事中はスマホを開けないけれど、腕時計なら見られる。その時間に株価の動きを知りたくて、自分たちのために作りました。持っている銘柄の株価を、決まった時間ごとのまとめと、大きく動いたときのアラートで腕時計に届けます。
  - We can't open our phones at work, but we can glance at a watch. We wanted to follow our stocks during those hours, so we built this for ourselves. It sends a regular price summary for the stocks you follow, plus an alert when one makes a big move.
- Example on a watch face (show as a watch screen, not as text): app name `株価`, title `上昇アラート トヨタ`, body `3,048 ▲62 / +2.08% 10:25`
  - Caption: 腕時計に届くアラートの例。前日比が ±2% を超えるごとに知らせます（幅は変えられます）。
  - Caption: An alert as it appears on a watch. You get one each time the day's change crosses another ±2% (adjustable).

### できること / What it does

1. 決まった時間に株価のまとめ / A price summary on schedule
   - 取引時間中、30 分ごとなど決めた間隔で、全銘柄の株価をまとめて届けます。
   - During trading hours, all your stocks in one notification, every 30 minutes or whatever interval you choose.
   - Sample line: `トヨタ 2,986.5 ▼3 -0.10% 15:30`
2. 大きく動いたらアラート / An alert on big moves
   - 前日比が決めた幅を新しく超えたときだけ知らせます。同じ日に同じ段階では 1 回だけです。
   - Only when the day's change crosses a new step you set. Once per step per day.
3. Apple Watch ならチャートも / Charts on Apple Watch
   - Apple Watch では、純正の「株価」アプリでいつでもチャートを確認でき、文字盤のボタンから今の株価も呼び出せます。
   - On Apple Watch, the built-in Stocks app shows charts any time, and a watch-face button pulls up current prices.

### 使える端末 / Devices

- iPhone + Apple Watch
  - iOS 16.4 以降。アプリはホーム画面に追加して使います（App Store は不要）。
  - iOS 16.4 or later. Added to the home screen; no App Store needed.
- Android + 各社の腕時計 / Android + most watches
  - Chrome で使います。Wear OS、Galaxy Watch、Huawei、Garmin など、スマホの通知が届く腕時計に対応します。
  - Runs in Chrome. Works with any watch that mirrors phone notifications: Wear OS, Galaxy Watch, Huawei, Garmin and others.

### 無料版 / The free version

- 無料版は、株価が約 15 分遅れです。あなた専用のサーバーを無料の範囲で動かすので、費用は 0 円です。画像付きの手順どおりに 30 分ほどで始められます。
- The free version shows prices about 15 minutes delayed. It runs on your own server within free tiers, so it costs nothing. The illustrated guide takes about 30 minutes (Japanese).
- Link: 導入ガイドを見る / Open the setup guide → https://mishima-hiromi.github.io/watchStock/

The 15 minutes is measured, not quoted: 32 samples on 2026-10-01 ranged 15.0–15.3 minutes (Yahoo's published figure is 20).

### リアルタイム版の事前登録 / Pre-register for a real-time version

- Intro
  - 遅れのない株価で届ける有料版を考えています。リアルタイムの株価を配るには取引所との契約が必要で、月々の費用がかかります。作るかどうかを決めるため、使いたい方の数と、払ってもよい金額を教えてください。
  - We're considering a paid version with no delay. Distributing real-time prices requires a contract with the exchange and a monthly fee, so before building it we'd like to know how many people want it and what they'd pay.
- Field: 月額いくらなら使いますか / What would you pay per month? (required, one of)
  - 無料なら使う / Only if free → `free`
  - 月 300 円 / ¥300 / month → `300`
  - 月 500 円 / ¥500 / month → `500`
  - 月 1,000 円 / ¥1,000 / month → `1000`
  - それ以上でも使う / More than that → `more`
- Field: 使う端末 / Your phone (required, one of): iPhone → `iphone`, Android → `android`, その他 / Other → `other`
- Field: メールアドレス（任意）/ Email (optional)
  - Hint: 入れていただいた方にだけ、リアルタイム版ができたときにお知らせします。 / Only if you'd like a note when the real-time version is ready.
- Button: 登録する / Register
- Privacy note (show near the form)
  - メールアドレスは、リアルタイム版のお知らせにだけ使い、ほかの目的には使いません。保存するのは入力いただいた内容だけです。連続送信を防ぐため、送信元を元に戻せない形にしたものを 1 日だけ記録し、その後は自動で消えます。
  - Your email is used only to tell you about the real-time version, nothing else. We store only what you enter. To prevent repeated submissions, we keep an irreversible fingerprint of the sender for one day, after which it is deleted automatically.
- Removal (collapsed is fine): 登録したメールアドレスを削除する / Remove my email, with an email field and a 削除する / Remove button.
- Messages

| key | 日本語 | English |
| --- | --- | --- |
| missing price | 月額を選んでください。 | Please choose a monthly price. |
| missing device | 使う端末を選んでください。 | Please choose your phone. |
| `email` | メールアドレスの形が正しくありません。 | That email address doesn't look right. |
| `too_many` | 送信が続いたため、時間をおいてもう一度お試しください。 | Too many submissions. Please try again later. |
| network / other | 送信できませんでした。通信状況を確かめて、もう一度お試しください。 | Couldn't send. Check your connection and try again. |
| success | 登録しました。ありがとうございます。 | You're registered. Thank you. |
| removed | 削除しました（登録がなかった場合も、この表示になります）。 | Removed (you'll see this even if the address wasn't registered). |

### よくある質問 / Questions

- なぜ無料版は 15 分遅れなのですか / Why is the free version 15 minutes behind?
  - 無料で使える株価は、取引所の決まりで遅れて配信されます。遅れのない株価を配るには取引所との有料の契約が必要です。
  - Prices that are free to use are released with a delay under exchange rules. Real-time prices need a paid agreement with the exchange.
- 無料版にお金はかかりますか / Does the free version cost anything?
  - かかりません。GitHub と Cloudflare の無料の範囲で動きます。クレジットカードの登録も要りません。
  - No. It runs within GitHub's and Cloudflare's free tiers, with no credit card.
- 株価や設定は誰が持っていますか / Who holds my data?
  - 無料版は、あなた専用のサーバーがあなたのために株価を取ってきます。私たちは株価も、あなたの銘柄も預かりません。
  - In the free version, your own server fetches prices for you. We never hold prices or your list of stocks.
- リアルタイム版はいつ出ますか / When will the real-time version be out?
  - まだ決まっていません。事前登録の数と希望の金額を見て、作るかどうかを決めます。登録しても料金は発生しません。
  - Not decided yet. We'll decide based on sign-ups and the prices people choose. Registering costs nothing.

### Footer

- 無料版のソースコード（MIT ライセンス）/ Free version source code (MIT): https://github.com/Mishima-Hiromi/watchStock
- 株価の情報は投資判断の参考です。売買はご自身の判断でお願いします。 / Prices are for reference only. Investment decisions are your own.

## Sign-up API

Source: `signup/src/index.ts`, tests: `test/signup.test.ts`. A separate Cloudflare Worker on the owner's account (`watchstock-signup`), not part of the free app.

Base URL (after the first deploy): `https://watchstock-signup.hm-7e451146.workers.dev`

Requests are accepted only from origins listed in `ALLOWED_ORIGINS` (`signup/wrangler.toml`, currently `https://no-map-sandbox.vercel.app`). Other origins get 403. Preflight (`OPTIONS`) is answered.

### POST /signup

```json
{ "price": "free|300|500|1000|more", "device": "iphone|android|other", "email": "optional", "lang": "ja|en", "website": "" }
```

- `website` is a honeypot: render it as a hidden text input that people never fill. If it is non-empty the server answers 200 and stores nothing.
- 200 `{ "ok": true }`
- 400 `{ "error": "price" | "device" | "email" | "invalid body" }`
- 429 `{ "error": "too_many" }` after 5 posts from one address in a day
- Registering again with the same email updates the earlier entry instead of adding one.

### POST /delete

```json
{ "email": "a@example.jp" }
```

Always 200 `{ "ok": true }`, whether or not the address was registered, so the list can't be probed.

### Owner only

`GET /tally` and `GET /export` (CSV of emails) need `Authorization: Bearer <ADMIN_TOKEN>`. They are for the owner, not for the page.
