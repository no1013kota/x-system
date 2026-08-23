-- T-M8-252: ブラウザ向けPostgREST（anon / authenticated）から読める範囲を、実際に使う分だけへ絞る。
--
-- Supabase の既定で public の全テーブルに `authenticated` の SELECT と、
-- anon/authenticated の TRUNCATE・TRIGGER・REFERENCES が付いていた。RLSがあるので
-- 他人の行は読めないが、**自分の行の暗号文（Xのトークン・APIキー・振込先口座番号）は
-- ブラウザから直接読めた**。アプリはこれらを service_role（サーバー）でしか読まないので、
-- 権限として持っている必要がない（持っている＝いつか使える、が事故の入口になる）。
--
-- **唯一の例外**は `profiles`。proxy（middleware）のルートガードが利用者自身のJWTで
-- `plan` / `subscription_status` を読む（src/lib/supabase/update-session.ts）。
-- ここだけ列を限定して残す。ほかの経路はすべて service_role のため影響しない。

revoke all on all tables in schema public from anon, authenticated;

-- ルートガードが読む列だけ（`id` は RLS の `using (id = auth.uid())` と絞り込みに要る）。
grant select (id, plan, subscription_status) on profiles to authenticated;

-- 以後に足すテーブルへ既定の権限を再発させない（忘れると同じ状態へ戻る・原則3）。
alter default privileges in schema public revoke all on tables from anon, authenticated;
