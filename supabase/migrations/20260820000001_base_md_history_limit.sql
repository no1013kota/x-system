-- T-M8-156: アカウント.mdの履歴を1アカウント最大5版までに刈り込む。
--
-- `base_md_versions` は版ごとにアカウント.md**全文**を持つが削除経路が1つも無く、
-- しかも `md_merge` ジョブが学習のたびに自動で版を積むため、利用者が何もしなくても
-- 無制限に増えていた（ストレージ費用が読めない・運営者原則4）。
--
-- 上限値5は運営者の指示（2026-08-20）。**これはロールバック可能な範囲でもある**——
-- 6版以上前へは戻せなくなる（要件05）。
--
-- 適用前後の件数を NOTICE で出す。黙って行が消えるのを避けるため（原則1）。

do $$
declare
  before_count bigint;
  after_count bigint;
  deleted_count bigint;
begin
  select count(*) into before_count from public.base_md_versions;

  with ranked as (
    select id,
           row_number() over (partition by x_account_id order by version desc) as rn
      from public.base_md_versions
  )
  delete from public.base_md_versions v
   using ranked r
   where v.id = r.id and r.rn > 5;

  get diagnostics deleted_count = row_count;
  select count(*) into after_count from public.base_md_versions;

  raise notice 'base_md_versions: before=% deleted=% after=%',
    before_count, deleted_count, after_count;
end $$;
