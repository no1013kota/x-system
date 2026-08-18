-- T-M8-129 U3: 「編集で許すポスト数の上限」もパターンの属性にする（ADR-0008）。
--
-- `PATTERN_MAX_POSTS`（要件06 §4.3）は enum のIDで引く定数だった。用途は2つ:
--   (1) 下書き編集で許すポスト数の上限（既存の下書きを無効にしないため生成上限より広い）
--   (2) 定時実行の日次枠の見積り（最悪ケースで予約する）
-- **利用者が作ったパターンは enum のIDを持たない**ため、このままでは値が決まらない。
--
-- 生成上限（`max_posts`）から式で導くことはできない。既定6種の実際の値は
--   p1: 生成4/編集6、p2: 1/1、p3: 6/7、p4: 2/5、p5: 3/3、p6: 5/7
-- で規則性が無く、たとえば「生成+2」にすると p4 が 5→4 へ**狭まり、既存の5ポストの
-- 下書きが編集できなくなる**（黙って壊れる）。値として持つ。

alter table post_patterns
  add column if not exists max_posts_edit smallint;

-- 既定6種は現在の `PATTERN_MAX_POSTS` の値をそのまま入れる（挙動を変えない）。
update post_patterns set max_posts_edit = case seed_key
    when 'p1' then 6 when 'p2' then 1 when 'p3' then 7
    when 'p4' then 5 when 'p5' then 3 when 'p6' then 7 end
 where seed_key is not null and max_posts_edit is null;

-- 自作パターンは「生成上限＋2、ただしスレッド全体の上限7まで」を既定にする。
-- 生成された分に少し足して整えられる幅を持たせる。
update post_patterns set max_posts_edit = least(7, max_posts + 2)
 where seed_key is null and max_posts_edit is null;

do $$
declare missing int;
begin
  select count(*) into missing from post_patterns where max_posts_edit is null;
  if missing > 0 then
    raise exception '編集上限が決まっていないパターンが % 件ある', missing;
  end if;
end $$;

alter table post_patterns alter column max_posts_edit set not null;
alter table post_patterns alter column max_posts_edit set default 7;

-- 生成上限もスレッド全体の上限（7ポスト・要件02 §3.9）に合わせる。
-- U1 では 1〜10 にしていたが、それだと 8 以上を設定した時点で編集上限（<=7）と
-- 両立しなくなり、画面で入れられるのに保存できない状態になる。
alter table post_patterns drop constraint if exists post_patterns_max_posts_range;
do $$ begin
  alter table post_patterns add constraint post_patterns_max_posts_range
    check (max_posts between 1 and 7);
exception when duplicate_object then null; end $$;

do $$ begin
  -- 編集上限は生成上限以上・スレッド全体の上限（7）以下。
  alter table post_patterns add constraint post_patterns_edit_limit_range
    check (max_posts_edit >= max_posts and max_posts_edit between 1 and 7);
exception when duplicate_object then null; end $$;

-- 下書きにも写す。**後からパターンを編集しても、過去の下書きの編集可能範囲が変わらない。**
alter table drafts add column if not exists max_posts_edit smallint;

update drafts d set max_posts_edit = coalesce(
    (select p.max_posts_edit from post_patterns p where p.id = d.pattern_id),
    case d.pattern::text
      when 'p1' then 6 when 'p2' then 1 when 'p3' then 7
      when 'p4' then 5 when 'p5' then 3 when 'p6' then 7 else 7 end)
 where max_posts_edit is null;

-- 既に上限を超えている下書き（過去の運用で作られたもの）は、その件数まで許す。
-- **編集できなくなる下書きを作らない**（原則1: 黙って壊れない）。
update drafts d set max_posts_edit = jsonb_array_length(d.thread)
 where jsonb_array_length(d.thread) > d.max_posts_edit;

do $$
declare bad int;
begin
  select count(*) into bad from drafts where max_posts_edit is null;
  if bad > 0 then raise exception '編集上限が入っていない下書きが % 件ある', bad; end if;
  select count(*) into bad from drafts where jsonb_array_length(thread) > max_posts_edit;
  if bad > 0 then raise exception '編集できない下書きを % 件作ってしまった', bad; end if;
end $$;

alter table drafts alter column max_posts_edit set not null;

-- 生成時に写す（U2 で追加した他の写しと同じ扱い）。
create or replace function drafts_fill_pattern_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.pattern_id is null and new.pattern is not null then
    select id into new.pattern_id from post_patterns
     where x_account_id = new.x_account_id and seed_key = new.pattern::text;
  end if;
  if new.pattern_name is not null and new.max_posts is not null
     and new.max_posts_edit is not null then return new; end if;
  if new.pattern_id is null then
    raise exception 'drafts.pattern_id is required' using errcode = '23502';
  end if;
  select name, max_posts, max_posts_edit, requires_quote_url into p
    from post_patterns where id = new.pattern_id;
  if not found then
    raise exception 'post pattern % not found', new.pattern_id using errcode = '23503';
  end if;
  new.pattern_name := coalesce(new.pattern_name, p.name);
  new.max_posts := coalesce(new.max_posts,
    greatest(p.max_posts, coalesce(jsonb_array_length(new.thread), 1))::smallint);
  -- **編集上限は実際のポスト数を下回らせない。** 下回ると作った直後の下書きが編集できない。
  new.max_posts_edit := coalesce(new.max_posts_edit,
    greatest(p.max_posts_edit, new.max_posts, coalesce(jsonb_array_length(new.thread), 1))::smallint);
  new.requires_quote_url := p.requires_quote_url;
  return new;
end $$;

-- ジョブの snapshot にも含める（実行中にパターンを編集されても値が変わらない）。
create or replace function pattern_spec_of(target uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'seed_key', p.seed_key, 'name', p.name, 'description', p.description,
    'prompt', p.prompt, 'max_posts', p.max_posts, 'max_posts_edit', p.max_posts_edit,
    'web_search_policy', p.web_search_policy, 'web_search_max_uses', p.web_search_max_uses,
    'source_policy', p.source_policy, 'include_news_digest', p.include_news_digest,
    'asks_user_opinion', p.asks_user_opinion, 'requires_quote_url', p.requires_quote_url)
  from post_patterns p where p.id = target;
$$;

-- 既定パターンの投入にも編集上限を含める。**列の default（7）に任せない**——
-- 単発の型（自分の考え・意見）まで7ポストへ増やせてしまう。
create or replace function seed_default_post_patterns(target uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  insert into post_patterns (
    x_account_id, seed_key, name, description, max_posts, max_posts_edit,
    web_search_policy, web_search_max_uses, source_policy,
    include_news_digest, asks_user_opinion, requires_quote_url, sort_order)
  select target, d.seed_key,
         -- 復元時に自作パターンと名前が衝突したら「（復元）」を付ける
         case when exists (select 1 from post_patterns p
                            where p.x_account_id = target and lower(p.name) = lower(d.name))
              then d.name || '（復元）' else d.name end,
         d.description, d.max_posts, d.max_posts_edit, d.ws_policy, d.ws_uses, d.src_policy,
         d.digest, d.opinion, d.quote, d.sort_order
    from (values
      ('p1','ニュース解説','話題のニュースを解説するスレッド',      4::smallint,6::smallint,'always'  ,4::smallint,'always'  ,false,false,false,10),
      ('p2','自分の考え・意見','本人の視点で述べる単発ポスト',      1,1,'with_url',2,'with_url',false,true ,false,20),
      ('p3','ノウハウ・ハウツー','今日から実践できる手順スレッド',  6,7,'always'  ,3,'with_url',false,false,false,30),
      ('p4','トレンド便乗','いま話題のトピックに便乗する短いスレッド',2,5,'always' ,4,'always'  ,false,false,false,40),
      ('p5','引用ポスト','対象ポストへの引用（URL付き投稿）',       3,3,'never'   ,0,'never'   ,false,false,true ,50),
      ('p6','週次まとめ','直近7日の関連ニュースまとめ',            5,7,'always'  ,3,'always'  ,true ,false,false,60)
    ) as d(seed_key,name,description,max_posts,max_posts_edit,ws_policy,ws_uses,src_policy,
           digest,opinion,quote,sort_order)
   on conflict (x_account_id, seed_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
