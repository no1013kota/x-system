-- T-M8-133: 既定の「自分の考え・意見」に `自分の考え` プレースホルダーを持たせる。
--
-- T-M8-132 で「自分の考え」の固定入力欄をやめてプレースホルダーへ一般化したが、
-- **既定パターン側にプレースホルダーを入れ忘れたため、意見を入力する手段が失われていた**
-- （`user_opinion` を送る画面が無くなり、プロンプトは「本人の考えを述べる」と言うのに
-- 利用者はそれを渡せない状態だった）。同じ仕組みで復旧する。
--
-- 対応するコード側のプロンプト（`PT_P2`）に `{自分の考え}` を入れてある。

update post_patterns
   set placeholders = '[{"name": "自分の考え"}]'::jsonb, updated_at = now()
 where seed_key = 'p2' and placeholders = '[]'::jsonb;

-- 新しいXアカウントの投入にも含める。
create or replace function seed_default_post_patterns(target uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  insert into post_patterns (
    x_account_id, seed_key, name, description, max_posts, max_posts_edit,
    web_search_policy, web_search_max_uses, source_policy,
    include_news_digest, asks_user_opinion, requires_quote_url, sort_order, placeholders)
  select target, d.seed_key,
         -- 復元時に自作パターンと名前が衝突したら「（復元）」を付ける
         case when exists (select 1 from post_patterns p
                            where p.x_account_id = target and lower(p.name) = lower(d.name))
              then d.name || '（復元）' else d.name end,
         d.description, d.max_posts, d.max_posts_edit, d.ws_policy, d.ws_uses, d.src_policy,
         d.digest, d.opinion, d.quote, d.sort_order, d.placeholders::jsonb
    from (values
      ('p1','ニュース解説','話題のニュースを解説するスレッド',      4::smallint,6::smallint,'always'  ,4::smallint,'always'  ,false,false,false,10,'[]'),
      ('p2','自分の考え・意見','本人の視点で述べる単発ポスト',      1,1,'with_url',2,'with_url',false,true ,false,20,'[{"name": "自分の考え"}]'),
      ('p3','ノウハウ・ハウツー','今日から実践できる手順スレッド',  6,7,'always'  ,3,'with_url',false,false,false,30,'[]'),
      ('p4','トレンド便乗','いま話題のトピックに便乗する短いスレッド',2,5,'always' ,4,'always'  ,false,false,false,40,'[]'),
      ('p5','引用ポスト','対象ポストへの引用（URL付き投稿）',       3,3,'never'   ,0,'never'   ,false,false,true ,50,'[]'),
      ('p6','週次まとめ','直近7日の関連ニュースまとめ',            5,7,'always'  ,3,'always'  ,true ,false,false,60,'[]')
    ) as d(seed_key,name,description,max_posts,max_posts_edit,ws_policy,ws_uses,src_policy,
           digest,opinion,quote,sort_order,placeholders)
   on conflict (x_account_id, seed_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
