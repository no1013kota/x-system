-- T-M8-210: ニュース解説（p1）を {ニュース} プレースホルダー方式へ（運営者の指示 2026-08-22）。
-- (1) seed関数のp1へ placeholders を追加（本文は20260818000010の実体を写し、p1の1行だけ変更）
-- (2) 既存のp1行（システム既定のまま=prompt null）へ placeholders をbackfill
-- (3) system default（prompt_templates kind='p1'）の本文をコード定数（PT_P1）と同じ内容へ更新
--     （通常はscheduler_tickのseedSystemPromptTemplatesが追随するが、適用直後から一致させる）

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
      ('p1','ニュース解説','話題のニュースを解説するスレッド',      4::smallint,6::smallint,'always'  ,4::smallint,'always'  ,false,false,10,'[{"name": "ニュース"}]'),
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

-- 既存p1: システム既定のまま（prompt null）の行だけ placeholders を追随させる。
-- 利用者がプロンプトを上書きしている行は触らない（本文に {ニュース} が無いのに宣言だけ増やさない）。
update post_patterns
   set placeholders = '[{"name": "ニュース"}]'::jsonb, updated_at = now()
 where seed_key = 'p1' and prompt is null and placeholders = '[]'::jsonb;

-- system default（prompt_templates）の本文を新PT_P1へ（コード定数 src/lib/prompts/gen-prompts.ts と同値）。
update prompt_templates
   set content = '# タスク
次のニュースを解説するスレッドを作る。
ニュース: {ニュース}
「（未指定）」のときは、<input>の参考URLのニュースを、それも未指定なら
発信テーマの直近の重要ニュースをWeb検索で1つ選ぶ。

# 手順
一次情報と背景をWeb検索で確認する。
読者にとっての意味を1つに絞る。

# 構成と分量
1ポスト目=フック＋読者にとっての意味（ここだけで要点が伝わるようにする）／
2ポスト目以降=補足する要点を1ポスト1つ。', updated_at = now()
 where x_account_id is null and kind = 'p1';
