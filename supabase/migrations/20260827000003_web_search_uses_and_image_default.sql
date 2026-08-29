-- 費用の見直し（T-M8-334・運営者の指示 2026-08-27）。
--
-- 1. 既定パターンのWeb検索回数を 4 → 3 にする。
--    検索は1回ごとに課金され、**取ってきた本文が入力トークンにも乗る**ため、
--    生成1回の費用に最も効く。3回でも一次情報の確認には足りる想定で、
--    足りなければパターン側で上げられる（DBのCHECKは0〜5のまま）。
-- 2. 新しく作るXアカウントにも3で入るよう、seed関数の既定値を差し替える。
--
-- **利用者が自分で変えた値は触らない**——画面にこの項目は無いので、
-- いま 4 なのは seed 由来の行だけ。それだけを 3 へ寄せる。

update post_patterns
   set web_search_max_uses = 3, updated_at = now()
 where seed_key in ('p1', 'p4') and web_search_max_uses = 4;

-- seed関数の既定値（行の内容の正本はこの関数）。**直前の定義（20260822000005）を写して
-- Web検索回数だけを差し替える**——古い版を写すと、その後に落とした列（asks_user_opinion）や
-- 増えた列（max_posts_edit / placeholders）が巻き戻り、新規Xアカウントの連携が落ちる。
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
      ('p1','ニュース解説','話題のニュースを解説するスレッド',      4::smallint,6::smallint,'always'  ,3::smallint,'always'  ,false,false,10,'[{"name": "ニュース"}]'),
      ('p2','自分の考え・意見','本人の視点で述べる単発ポスト',      1,1,'with_url',2,'with_url',false,false,20,'[{"name": "自分の考え"}]'),
      ('p3','ノウハウ・ハウツー','今日から実践できる手順スレッド',  6,7,'always'  ,3,'with_url',false,false,30,'[]'),
      ('p4','トレンド便乗','いま話題のトピックに便乗する短いスレッド',2,5,'always' ,3,'always'  ,false,false,40,'[]'),
      ('p5','引用ポスト','対象ポストへの引用（URL付き投稿）',       3,3,'never'   ,0,'never'   ,false,true ,50,'[]'),
      ('p6','週次まとめ','直近7日の関連ニュースまとめ',            5,7,'always'  ,3,'always'  ,true ,false,60,'[]')
    ) as d(seed_key,name,description,max_posts,max_posts_edit,ws_policy,ws_uses,src_policy,
           digest,quote,sort_order,placeholders)
   on conflict (x_account_id, seed_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
