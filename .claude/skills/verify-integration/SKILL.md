---
name: verify-integration
description: x-systemのDB・マイグレーション・RLS・Server Actions・API Route・認証・課金同期・ジョブ・Cronなど複数境界をまたぐ変更をローカルで安全に統合検証する。これらの実装・修正後、または統合/結合/DBテストを求められたときに使う。
---

# verify-integration：統合テスト

変更に関係する境界だけを選び、ローカルSupabaseを含む統合動作を検証する。単体テスト・E2E・外部liveの代わりにはしない。

## 手順

1. **範囲と契約**: タスク・docs・`git diff` から、今回守る契約（DB制約・RLS・API契約・状態遷移・冪等性・同時実行）を先に列挙。無関係な変更はしない。
2. **接続の安全**: 接続先がローカル（`127.0.0.1`/`localhost`）のテストSupabaseであることを秘密値を出さずに確認。Preview/本番DBで reset/drop/truncate/破壊的migrationをしない。`supabase db reset` は破棄可能なローカルでクリーン適用確認が要るときのみ、未明示なら承認を得る。
3. **前提**: `supabase status` でローカルスタックを確認（未起動だと `*.db.test.ts` は自動skipされる）。必要なら起動（ネットワーク取得や権限が要るなら承認）。テストデータは一意ID、他者データを上書きしない。
4. **対象テスト**（変更種別で選ぶ）: migration/RLS=schema/seed/RLS/別ユーザー拒否/制約。Action/API=認証/入力検証/所有権/Origin/署名/DB反映。job/Cron=lease/状態遷移/冪等/再試行/stale回収/deadline/同時実行。課金・利用量=Webhook重複/イベント順序/契約状態/枠の原子的更新。X・AI=モックで契約と記帳（liveはしない）。`rg` で対応する `*.db.test.ts`・route/actionテストを探し、無ければ追加する。
5. **実行**: 変更対象に近いテストから `npx vitest run <file>` で絞って実行→関連する境界群→共通基盤/schema/認証/RLSを変えたら `npm test` で退行確認。失敗は原因を特定し依頼範囲の実装/テストだけ直して再実行。
6. **完全性**: pass数だけでなく fail/skip/todo を確認。必須 `*.db.test.ts` が1件でもskipなら合格としない。作成データ・lock・実行中jobが残っていないこと、ログに秘密値（APIキー・token・暗号鍵・Cookie・個人情報）が無いことを確認。
7. **報告**: 環境・検証した契約・結果・skip・未検証事項。「合格」は必要な統合テストが全実行されfailと必須skipが0のときのみ。環境不足時は単体成功と統合未実施を分けて報告する。

## ルール

- テストを通す目的で RLS/認可/署名検証/冪等guard を弱めない。Preview/本番へ書き込まない、実課金・実投稿・実メールをしない。今回作成分だけ後片付けする。
