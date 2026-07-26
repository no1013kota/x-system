-- service_role へのテーブル権限付与（要件02 §1）。
--
-- 20260720000004_rls_policies.sql は `authenticated` への SELECT だけを付与し、`service_role`
-- への GRANT を書いていなかった。そのため PostgREST 経由（Supabase client）で service_role が
-- public テーブルへアクセスすると `42501 permission denied` になる。`profiles` だけは別経路で
-- 権限が付いていたため露見が遅れ、`GET /api/x/oauth/start` の active 連携数カウント
-- （x_accounts）が `internal_error` で落ちていた（2026-07-26 にローカルで再現）。
--
-- service_role は server-only の秘密鍵で、RLS をバイパスする前提の管理用ロール（Supabase 既定も
-- public スキーマ全体へ ALL を付与する）。アプリの重い処理は直結 pg（DATABASE_URL）を使うが、
-- PostgREST 経由の管理系クエリも動く状態に揃える。
--
-- 注意: `authenticated` の権限はここでは一切変更しない（SELECT のみ・書き込みは Server Action 経由）。
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- 以降に作られるテーブルへも自動で付与し、同じ抜けを繰り返さない。
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
