-- 要件02 §6 / 要件01 §8 / T-M7-45:
-- 生成画像用の private bucket をどの環境にも自動で作る。
--
-- これまで bucket の定義は `supabase/config.toml` にしか無く、**ローカルの `supabase start`
-- でしか作られていなかった**。migration では作られないため、staging / production では
-- 「画像生成が最後の保存だけ失敗する」状態になる（2026-08-01、stagingで bucket が0件だと実測）。
--
-- 手順書に「Dashboardで手動作成する」と書いても忘れる（CLAUDE.md 原則3）。migration に入れて
-- 環境を作るだけで揃うようにする。設定値は config.toml と一致させること。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'generated-images',
  'generated-images',
  false,                                              -- private。閲覧は署名URL経由のみ
  5242880,                                            -- 5MiB（config.toml と一致）
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- RLSポリシーは作らない。読み書きは service_role（RLSバイパス）と署名URLだけで行い、
-- authenticated / anon から直接触らせない（要件01 §8・`outbound-channels.ts` の storage_delete）。
