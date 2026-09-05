-- どのパターンも「必要があれば最大3回」Web検索する（T-M8-442・運営者の指示 2026-09-05・要決定 D-57）。
--
-- これまで P-2（自分の考え・意見）は「参考URLがあるときだけ・最大2回」、P-5（引用ポスト）は「使わない」だった。
-- 運営者の指示で、既定パターン6種すべてを「常に検索ツールを渡す・最大3回」に揃える
-- （「常に」は検索ツールを渡す意味で、使うかどうかはモデルが必要に応じて決める）。
-- 自作パターンは元から always／3（post-patterns-store.ts）。
--
-- 1. 既存行: P-2／P-5 の seed 由来の行を always／3 へ。画面にこの項目は無いので、seed_key が p2/p5 の行は
--    すべて seed 由来（利用者が変えた値は存在しない）。
update post_patterns
   set web_search_policy = 'always', web_search_max_uses = 3, updated_at = now()
 where seed_key in ('p2', 'p5')
   and (web_search_policy <> 'always' or web_search_max_uses <> 3);

-- 2. 新しく作る X アカウントにも同じ既定で入るよう、seed 関数を差し替える。
--    **直前の定義（20260827000003）を写して P-2／P-5 の Web検索列だけ変える**（古い版を写すと列が巻き戻る）。
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
      ('p2','自分の考え・意見','本人の視点で述べる単発ポスト',      1,1,'always'  ,3,'with_url',false,false,20,'[{"name": "自分の考え"}]'),
      ('p3','ノウハウ・ハウツー','今日から実践できる手順スレッド',  6,7,'always'  ,3,'with_url',false,false,30,'[]'),
      ('p4','トレンド便乗','いま話題のトピックに便乗する短いスレッド',2,5,'always' ,3,'always'  ,false,false,40,'[]'),
      ('p5','引用ポスト','対象ポストへの引用（URL付き投稿）',       3,3,'always'  ,3,'never'   ,false,true ,50,'[]'),
      ('p6','週次まとめ','直近7日の関連ニュースまとめ',            5,7,'always'  ,3,'always'  ,true ,false,60,'[]')
    ) as d(seed_key,name,description,max_posts,max_posts_edit,ws_policy,ws_uses,src_policy,
           digest,quote,sort_order,placeholders)
   on conflict (x_account_id, seed_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
