# Supabase ローカル開発

DBスキーマの正本は `docs/requirements/02_data_model.md`。マイグレーションはその実装。

## 前提

- Docker ランタイム（この環境では **colima**）。`colima start --cpu 4 --memory 8` で起動。
- Supabase CLI（`brew install supabase`）。
- `config.toml` は `[analytics] enabled = false`（colimaでは vector が docker.sock を bind mount できず起動失敗するため）。
- rootのgitignore済み`.env`へ`TURNSTILE_SECRET_KEY`を設定する。ローカル自動テストはCloudflare公式の常時成功secret `1x0000000000000000000000000000000AA`、失敗経路は常時失敗secret `2x0000000000000000000000000000000AA`を使い、本番secretを置かない。

## よく使うコマンド

```bash
supabase start          # ローカルスタック起動（初回はイメージpull）
supabase migration up   # 未適用のmigrationだけを当てる（ふだんはこちら。中のデータは残る）
supabase db reset       # DBを再作成し migrations/ を順に再適用（+ seed.sql）。**中のデータは全部消える**
supabase migration new <name>   # 新しいマイグレーションSQLの雛形を作成
supabase stop           # スタック停止
```

ローカルDB接続: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`（Studio: http://127.0.0.1:54323）。

## マイグレーション追加の手順

1. `supabase migration new <name>` で `migrations/<timestamp>_<name>.sql` を作成し、SQLを書く。
2. enum・テーブル・制約などの値の正本はコード側（例: `src/lib/db/enums.ts`）と一致させる。
3. `supabase migration up` で適用する。**`db reset` を既定にしない**——ローカルに作ったXアカウント・下書き・APIキーが毎回消え、画面確認をやり直すことになる。
   **`db reset` が要るのは、適用済みのmigrationファイルを編集・削除したとき**（差分では辻褄が合わないため）。逆に言えば、**一度適用したファイルは編集せず新しいmigrationを足す**。
4. DB検証テスト（`src/lib/db/*.db.test.ts`）を `npm run test` で実行する。ローカルスタック未起動時はスキップされる。

## 注意

- `.db.test.ts` はローカルSupabaseが起動している時のみ実行され、未起動時はスキップする（Docker非依存の環境でも `npm run test` が通る）。
- 秘密値（service role key 等）はコミットしない。ローカルの匿名/サービスキーは `supabase start` の出力で確認する。
- `[auth.captcha]`はTurnstileを有効化し、`env(TURNSTILE_SECRET_KEY)`を参照する。設定変更後はデータを保持したまま`supabase stop`→`supabase start`で反映する。本番はSupabase DashboardとCloudflareで別途実キーを設定し、公式テストキーを使用しない。
