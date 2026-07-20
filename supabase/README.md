# Supabase ローカル開発

DBスキーマの正本は `docs/requirements/02_data_model.md`。マイグレーションはその実装。

## 前提

- Docker ランタイム（この環境では **colima**）。`colima start --cpu 4 --memory 8` で起動。
- Supabase CLI（`brew install supabase`）。
- `config.toml` は `[analytics] enabled = false`（colimaでは vector が docker.sock を bind mount できず起動失敗するため）。

## よく使うコマンド

```bash
supabase start          # ローカルスタック起動（初回はイメージpull）
supabase db reset       # DBを再作成し migrations/ を順に再適用（+ seed.sql）
supabase migration new <name>   # 新しいマイグレーションSQLの雛形を作成
supabase stop           # スタック停止
```

ローカルDB接続: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`（Studio: http://127.0.0.1:54323）。

## マイグレーション追加の手順

1. `supabase migration new <name>` で `migrations/<timestamp>_<name>.sql` を作成し、SQLを書く。
2. enum・テーブル・制約などの値の正本はコード側（例: `src/lib/db/enums.ts`）と一致させる。
3. `supabase db reset` で再適用が通ることを確認する。
4. DB検証テスト（`src/lib/db/*.db.test.ts`）を `npm run test` で実行する。ローカルスタック未起動時はスキップされる。

## 注意

- `.db.test.ts` はローカルSupabaseが起動している時のみ実行され、未起動時はスキップする（Docker非依存の環境でも `npm run test` が通る）。
- 秘密値（service role key 等）はコミットしない。ローカルの匿名/サービスキーは `supabase start` の出力で確認する。
