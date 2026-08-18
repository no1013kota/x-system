-- T-M8-145: 使われていない `asks_user_opinion` を撤去する。
--
-- T-M8-132 で「自分の考え」の固定入力欄をやめ、**どんな項目を毎回入れたいかは
-- パターンの `placeholders` が決める**形へ一般化した。その時点でこの列は
-- **どこからも読まれなくなった**が、列・`pattern_spec_of()` の出力・seed関数・
-- TS の型（`PatternOption` / `PatternSpec`）に残り続けていた。
--
-- 死んだ属性は「まだ意味がある」と読ませる。実際に2026-08-18の監査で
-- 「これは何に使われているのか」を追う手間が発生した（CLAUDE.md 原則2）。
--
-- **`pattern_spec` は生成時のsnapshot**なので、過去のjobが持つJSONに
-- `asks_user_opinion` が残っていても誰も読まない（`parsePatternSpec` から外す）。

-- 1) 取り残しの検算: 本当に誰も参照していないか（トリガ・関数の定義本文を見る）。
do $$
declare refs text;
begin
  select string_agg(p.proname, ', ') into refs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc like '%asks_user_opinion%'
     and p.proname not in ('seed_default_post_patterns', 'pattern_spec_of');
  if refs is not null then
    raise exception '想定外の関数が asks_user_opinion を参照しています: %', refs;
  end if;
end $$;

-- 2) seed関数から外す（既定6件の投入・既定の復元で使う）。
create or replace function seed_default_post_patterns(target uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  insert into post_patterns (
    x_account_id, seed_key, name, description, max_posts, max_posts_edit,
    web_search_policy, web_search_max_uses, source_policy,
    include_news_digest, requires_quote_url, sort_order, placeholders)
  select target, d.seed_key,
         -- 復元時に自作パターンと名前が衝突したら「（復元）」を付ける
         case when exists (select 1 from post_patterns p
                            where p.x_account_id = target and lower(p.name) = lower(d.name))
              then d.name || '（復元）' else d.name end,
         d.description, d.max_posts, d.max_posts_edit, d.ws_policy, d.ws_uses, d.src_policy,
         d.digest, d.quote, d.sort_order, d.placeholders::jsonb
    from (values
      ('p1','ニュース解説','話題のニュースを解説するスレッド',      4::smallint,6::smallint,'always'  ,4::smallint,'always'  ,false,false,10,'[]'),
      ('p2','自分の考え・意見','本人の視点で述べる単発ポスト',      1,1,'with_url',2,'with_url',false,false,20,'[{"name": "自分の考え"}]'),
      ('p3','ノウハウ・ハウツー','今日から実践できる手順スレッド',  6,7,'always'  ,3,'with_url',false,false,30,'[]'),
      ('p4','トレンド便乗','いま話題のトピックに便乗する短いスレッド',2,5,'always' ,4,'always'  ,false,false,40,'[]'),
      ('p5','引用ポスト','対象ポストへの引用（URL付き投稿）',       3,3,'never'   ,0,'never'   ,false,true ,50,'[]'),
      ('p6','週次まとめ','直近7日の関連ニュースまとめ',            5,7,'always'  ,3,'always'  ,true ,false,60,'[]')
    ) as d(seed_key,name,description,max_posts,max_posts_edit,ws_policy,ws_uses,src_policy,
           digest,quote,sort_order,placeholders)
   on conflict (x_account_id, seed_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

-- 3) ジョブへ凍結するsnapshotからも外す。
create or replace function pattern_spec_of(target uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'seed_key', p.seed_key, 'name', p.name, 'description', p.description,
    'prompt', p.prompt, 'max_posts', p.max_posts, 'max_posts_edit', p.max_posts_edit,
    'web_search_policy', p.web_search_policy, 'web_search_max_uses', p.web_search_max_uses,
    'source_policy', p.source_policy, 'include_news_digest', p.include_news_digest,
    'requires_quote_url', p.requires_quote_url,
    'placeholders', p.placeholders)
  from post_patterns p where p.id = target;
$$;

-- 4) 列を落とす。
alter table post_patterns drop column if exists asks_user_opinion;
