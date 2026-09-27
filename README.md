# watchStock

iPhone を開けない場面でも、Apple Watch で日本株の値動きを確認するための仕組み。Mac も有料アカウントも不要で、運用費は 0 円。

- **通知**: 取引時間中、定時サマリーと値動きアラートが iPhone 経由で Watch に届く
- **ショートカット**: Watch の文字盤をタップすると、その時点の株価を表示する

> 株価は Yahoo Finance の非公式エンドポイントから取得しており、東証銘柄は約 20 分遅れ。公式 API ではないため、予告なく使えなくなる可能性がある。投資判断は自己責任で。

## 仕組み

```
Cloudflare Workers（無料枠）
  ├─ cron 5 分ごと ─ 株価取得 ─▶ ntfy.sh ─▶ iPhone の ntfy アプリ ─▶ Watch に通知
  └─ GET /quote ◀─ Watch のショートカット
```

各利用者が自分の Cloudflare アカウントにデプロイする。このリポジトリの作者はデータを保持も中継もしない。

## 必要なもの（すべて無料）

- Cloudflare アカウント（クレジットカード不要）
- Node.js 20 以上（Windows 可）
- iPhone に ntfy アプリ（App Store で「ntfy」を検索）

## セットアップ

### 1. デプロイ

```sh
cd worker
npm install
npx wrangler login                      # ブラウザで Cloudflare にログイン
npx wrangler kv namespace create STATE  # 出力された id を wrangler.toml の REPLACE_WITH_KV_ID に貼る
npx wrangler secret put NTFY_TOPIC      # 推測されにくいランダムな文字列（例: ws-8f3k2q9x7m）
npx wrangler secret put ACCESS_TOKEN    # ショートカット用の合言葉（ランダムな文字列）
npm run deploy                          # 表示された https://watchstock.<name>.workers.dev を控える
```

ntfy.sh のトピックは名前を知っている人なら誰でも読めるため、パスワードのように扱うこと。

初回のデプロイで「workers.dev subdomain を登録せよ」と出た場合は、表示されたダッシュボードの URL でサブドメインを登録してから再実行する。登録直後の数分間は SSL エラーで接続できないことがある。

### 2. 銘柄と通知の設定（`worker/wrangler.toml` の `[vars]`）

| 変数 | 既定値 | 意味 |
| --- | --- | --- |
| `SYMBOLS` | `7203:トヨタ` | 銘柄コード。`:` の後は表示名（省略すると英語名）。カンマ区切りで複数指定可 |
| `SUMMARY_EVERY_MIN` | `30` | 9:00 から何分ごとに全銘柄のサマリーを送るか。`0` で送らない |
| `ALERT_STEP_PCT` | `2` | 前日比がこの % 刻みで新たに広がったらアラート（+2%、+4%…／-2%、-4%…）。同じ日に同じ段階では再送しない |

変更したら `npm run deploy` で反映する。

### 3. iPhone の ntfy アプリ

1. ntfy アプリで「+」→ 手順 1 で決めた `NTFY_TOPIC` を購読する
2. 「設定」→「通知」→ ntfy の通知を許可する
3. Watch アプリ →「通知」→ ntfy が「iPhone を反映」になっていることを確認する

iPhone がロック中でポケットやカバンに入っていれば、通知は Watch に届く。

### 4. Watch のショートカット

iPhone の「ショートカット」アプリで新規作成する。

1. アクション「URL の内容を取得」を追加。URL は `https://watchstock.<name>.workers.dev/quote?token=<ACCESS_TOKEN>`
   - 1 銘柄だけ表示したい場合は `&s=7203` を付ける
2. アクション「結果を表示」を追加し、入力に「URL の内容」を指定する
3. ショートカットの詳細（ⓘ）で「Apple Watch に表示」をオンにする
4. Watch の文字盤を長押し →「編集」→ コンプリケーションに「ショートカット」→ 作成したものを選ぶ

表示例:

```
トヨタ 2,989.5 ▲20.5 +0.69% 15:30
ソニー 3,710 ▲47 +1.28% 15:30
```

末尾の時刻は価格の時刻（約 20 分遅れ）。

## 動作

- cron は平日 9:00〜16:55 JST に 5 分ごとに起動し、処理するのは 9:00〜16:00 のみ（遅延データの終値が 15:50 ごろ届くため）
- 価格の日付が当日でなければ休場とみなして通知しない（祝日カレンダーは不要）
- データが前回サマリーから変わっていなければサマリーを送らない（昼休み・引け後）
- 無料枠の消費: Workers 約 100 回／日、KV 書き込みは通知時のみ（上限 1,000 回／日）

## 開発

```sh
cd worker
npm test              # 単体テスト
npm run typecheck
npm run dev           # ローカル起動。.dev.vars に ACCESS_TOKEN / NTFY_TOPIC を書く
                      # http://127.0.0.1:8787/quote?token=... と /__scheduled で確認
```

データソースは `src/quote.ts` の `QuoteProvider` を実装すれば差し替えられる。
