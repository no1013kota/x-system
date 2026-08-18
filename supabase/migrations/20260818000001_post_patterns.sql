-- 要件02 §3.21 post_patterns 新設 ＋ §3.8/§3.9/§3.10/§3.20 の参照列追加。
-- この版では旧 `pattern`（enum）が正本のまま。新列は「並べて埋める」だけで誰も読まない。
-- 冪等（if not exists / on conflict / drop trigger if exists）。

create table if not exists post_patterns (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete cascade,

  -- 画面に出る唯一の名前。内部IDは画面に出さない（要件06 §1.0）
  name text not null,
  -- 補足。**ポスト数はここに書かせない**（T-M8-33の再発防止）。画面が max_posts から自動で付ける
  description text,

  -- null = システム既定（コード定数 SYSTEM_DEFAULT_TEMPLATES[seed_key]・src/lib/prompts/gen-prompts.ts）を使う。
  -- 「システム既定に戻す」= null に戻す。コード側のプロンプト改善が既存アカウントへ
  -- 届く経路を保つ（T-M7-37 の回帰防止）。自作パターンは非null必須（下のCHECK）。
  prompt text,

  -- 旧 GENERATION_MAX_POSTS / PATTERN_MAX_POSTS / draft-editor のインライン表 /
  -- dailyLimitOk の planned / ROLLBACK_SAFE_BUDGET を**1つの数**へ統合。運営者が変更できる
  max_posts smallint not null default 4,

  -- 旧 baseWebSearchForPattern の switch。'with_url' が P-2 の「URL指定時のみ」
  web_search_policy text not null default 'always',
  web_search_max_uses smallint not null default 3,
  -- 旧 sourceRequired(pattern, hasReferenceUrl)。語彙を web_search と揃える
  source_policy text not null default 'with_url',
  -- 旧「P-6のみ <news_digest> を渡す」
  include_news_digest boolean not null default false,
  -- 旧「pattern === 'p2' のときだけ『自分の考え』欄を出す」（画面の出し分けのみ）
  asks_user_opinion boolean not null default false,
  -- P-5専用。運営者は編集できない（画面に出さない・seedのみ true）
  requires_quote_url boolean not null default false,

  sort_order integer not null default 100,
  -- 既定パターン由来の識別子。自作は null。seedの冪等化と「既定に戻す」に使う
  seed_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint post_patterns_name_len check (char_length(name) between 1 and 30),
  -- 名前は PT-SUGGEST（{{patterns}}）へ差し込まれる。改行・タグ文字を禁止する
  constraint post_patterns_name_safe check (name !~ '[\n\r<>]'),
  constraint post_patterns_desc_len check (description is null or char_length(description) <= 120),
  -- 上限は AI設定＞プロンプトの保存上限と同じ（貼れる長さと保存できる長さを一致させる）
  constraint post_patterns_prompt_len check (prompt is null or char_length(prompt) between 1 and 8000),
  constraint post_patterns_prompt_required check (seed_key is not null or prompt is not null),
  constraint post_patterns_max_posts_range check (max_posts between 1 and 10),
  constraint post_patterns_web_search_policy
    check (web_search_policy in ('always','with_url','never')),
  constraint post_patterns_web_search_uses check (web_search_max_uses between 0 and 5),
  -- 「調べない」と「回数>0」の矛盾を作れないようにする
  constraint post_patterns_web_search_consistent
    check ((web_search_policy = 'never') = (web_search_max_uses = 0)),
  constraint post_patterns_source_policy check (source_policy in ('always','with_url','never')),
  constraint post_patterns_seed_key
    check (seed_key is null or seed_key in ('p1','p2','p3','p4','p5','p6')),
  constraint post_patterns_quote_not_digest
    check (not (requires_quote_url and include_news_digest)),
  -- seed_key は1アカウント1つ（null は複数可＝自作パターン）
  constraint post_patterns_account_seed_key unique (x_account_id, seed_key),
  -- 複合FKの参照先（他アカウントのパターンを参照することがDBレベルで不可能になる）
  constraint post_patterns_account_id_key unique (x_account_id, id)
);

-- 表示名は重複させない（画面で見分けられなくなる）
create unique index if not exists post_patterns_account_name_key
  on post_patterns (x_account_id, lower(name));
create index if not exists post_patterns_account_sort_idx
  on post_patterns (x_account_id, sort_order, created_at);

drop trigger if exists post_patterns_set_updated_at on post_patterns;
create trigger post_patterns_set_updated_at before update on post_patterns
  for each row execute function set_updated_at();

alter table post_patterns enable row level security;
drop policy if exists post_patterns_select_own on post_patterns;
create policy post_patterns_select_own on post_patterns
  for select to authenticated using (auth_owns_x_account(x_account_id));
grant select on post_patterns to authenticated;      -- 書き込みは Server のみ
grant all on post_patterns to service_role;          -- 既定権限に頼らず明示（20260726000002の反省）

-- ── 既定6件のseed（行の内容の正本はこの関数。プロンプト本文はコード定数） ──
create or replace function seed_default_post_patterns(target uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  insert into post_patterns (
    x_account_id, seed_key, name, description, max_posts,
    web_search_policy, web_search_max_uses, source_policy,
    include_news_digest, asks_user_opinion, requires_quote_url, sort_order)
  select target, d.seed_key,
         -- 復元時に自作パターンと名前が衝突したら「（復元）」を付ける
         case when exists (select 1 from post_patterns p
                            where p.x_account_id = target and lower(p.name) = lower(d.name))
              then d.name || '（復元）' else d.name end,
         d.description, d.max_posts, d.ws_policy, d.ws_uses, d.src_policy,
         d.digest, d.opinion, d.quote, d.sort_order
    from (values
      ('p1','ニュース解説','話題のニュースを解説するスレッド',      4::smallint,'always'  ,4::smallint,'always'  ,false,false,false,10),
      ('p2','自分の考え・意見','本人の視点で述べる単発ポスト',      1,'with_url',2,'with_url',false,true ,false,20),
      ('p3','ノウハウ・ハウツー','今日から実践できる手順スレッド',  6,'always'  ,3,'with_url',false,false,false,30),
      ('p4','トレンド便乗','いま話題のトピックに便乗する短いスレッド',2,'always' ,4,'always'  ,false,false,false,40),
      ('p5','引用ポスト','対象ポストへの引用（URL付き投稿）',       3,'never'   ,0,'never'   ,false,false,true ,50),
      ('p6','週次まとめ','直近7日の関連ニュースまとめ',            5,'always'  ,3,'always'  ,true ,false,false,60)
    ) as d(seed_key,name,description,max_posts,ws_policy,ws_uses,src_policy,
           digest,opinion,quote,sort_order)
   on conflict (x_account_id, seed_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

-- 新規Xアカウントには必ず入る（原則3: 人が思い出す手順にしない）
create or replace function x_accounts_seed_post_patterns() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform seed_default_post_patterns(new.id); return null; end $$;
drop trigger if exists x_accounts_seed_post_patterns on x_accounts;
create trigger x_accounts_seed_post_patterns after insert on x_accounts
  for each row execute function x_accounts_seed_post_patterns();

-- 既存アカウントへseed → 既存のプロンプト上書きを引き継ぐ（消さない）
do $$ declare a record; begin
  for a in select id from x_accounts loop perform seed_default_post_patterns(a.id); end loop;
end $$;
update post_patterns pp set prompt = ov.content
  from prompt_templates ov
 where ov.x_account_id = pp.x_account_id and ov.kind = pp.seed_key and pp.prompt is null;

-- ── jobs のスナップショット生成（1か所で定義し、トリガとアプリの両方が使う） ──
create or replace function pattern_spec_of(target uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'seed_key', p.seed_key, 'name', p.name, 'description', p.description,
    'prompt', p.prompt, 'max_posts', p.max_posts,
    'web_search_policy', p.web_search_policy, 'web_search_max_uses', p.web_search_max_uses,
    'source_policy', p.source_policy, 'include_news_digest', p.include_news_digest,
    'asks_user_opinion', p.asks_user_opinion, 'requires_quote_url', p.requires_quote_url)
  from post_patterns p where p.id = target;
$$;

-- ── 参照列（すべて追加のみ） ───────────────────────────────
alter table drafts            add column if not exists pattern_id uuid;
alter table drafts            add column if not exists pattern_name text;
alter table drafts            add column if not exists max_posts smallint;
alter table drafts            add column if not exists requires_quote_url boolean not null default false;
alter table schedule_slots    add column if not exists pattern_id uuid;
alter table generation_jobs   add column if not exists pattern_id uuid;
alter table generation_jobs   add column if not exists pattern_spec jsonb;
alter table x_timeline_posts  add column if not exists pattern_name text;

-- ── backfill（旧enum → 新列） ─────────────────────────────
update drafts d set
    pattern_id = pp.id,
    pattern_name = pp.name,
    -- 既存の下書きを保存できなくしない（旧編集上限は新 max_posts より大きい）
    max_posts = greatest(pp.max_posts, coalesce(jsonb_array_length(d.thread), 1))::smallint,
    requires_quote_url = pp.requires_quote_url
  from post_patterns pp
 where pp.x_account_id = d.x_account_id and pp.seed_key = d.pattern::text
   and d.pattern_name is null;

update schedule_slots ss set pattern_id = pp.id
  from post_patterns pp
 where pp.x_account_id = ss.x_account_id and pp.seed_key = ss.pattern::text
   and ss.pattern_id is null;

update generation_jobs gj set pattern_id = pp.id, pattern_spec = pattern_spec_of(pp.id)
  from post_patterns pp
 where pp.x_account_id = gj.x_account_id
   and pp.seed_key = coalesce(gj.pattern::text, 'p1')   -- 旧コードの `job.pattern ?? "p1"` に合わせる
   and gj.kind = 'post_generation' and gj.pattern_spec is null;

update x_timeline_posts x set pattern_name = pp.name
  from post_patterns pp
 where pp.x_account_id = x.x_account_id and pp.seed_key = x.pattern
   and x.pattern is not null and x.pattern_name is null;

-- 取り残しがあればここで止まる（黙って進めない）
do $$ declare n integer; begin
  select count(*) into n from drafts where pattern_name is null;
  if n > 0 then raise exception 'drafts backfill left % rows', n; end if;
  select count(*) into n from schedule_slots where pattern_id is null;
  if n > 0 then raise exception 'schedule_slots backfill left % rows', n; end if;
  select count(*) into n from generation_jobs
   where kind = 'post_generation' and pattern_spec is null;
  if n > 0 then raise exception 'generation_jobs backfill left % rows', n; end if;
end $$;

-- ── 旧経路のまま新列を埋める fill トリガ（U1がコード変更ゼロで済む理由） ──
-- **同一イベントのトリガはトリガ名のアルファベット順に発火する。** fill(f) → usable(p) の順に
-- なるよう命名している。順序が入れ替わると p5ガードが pattern_id=null を見て素通りする。
create or replace function drafts_fill_pattern_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.pattern_id is null and new.pattern is not null then
    select id into new.pattern_id from post_patterns
     where x_account_id = new.x_account_id and seed_key = new.pattern::text;
  end if;
  if new.pattern_name is not null and new.max_posts is not null then return new; end if;
  if new.pattern_id is null then
    raise exception 'drafts.pattern_id is required' using errcode = '23502';
  end if;
  select name, max_posts, requires_quote_url into p from post_patterns where id = new.pattern_id;
  if not found then
    raise exception 'post pattern % not found', new.pattern_id using errcode = '23503';
  end if;
  new.pattern_name := coalesce(new.pattern_name, p.name);
  new.max_posts := coalesce(new.max_posts,
    greatest(p.max_posts, coalesce(jsonb_array_length(new.thread), 1))::smallint);
  new.requires_quote_url := p.requires_quote_url;
  return new;
end $$;
drop trigger if exists drafts_fill_pattern_snapshot on drafts;
create trigger drafts_fill_pattern_snapshot before insert on drafts
  for each row execute function drafts_fill_pattern_snapshot();

create or replace function schedule_slots_fill_pattern_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- INSERT: 旧 `pattern` から引く。これがあるので U1 はアプリを1行も変えずに新列が埋まる。
  if tg_op = 'INSERT' then
    if new.pattern_id is null and new.pattern is not null then
      select id into new.pattern_id from post_patterns
       where x_account_id = new.x_account_id and seed_key = new.pattern::text;
    end if;
    return new;
  end if;

  -- UPDATE: **旧 `pattern` が変わったときだけ**引き直す。
  -- 無条件に埋めると、パターン削除時の detach（`pattern_id = null`）を書き戻してしまい、
  -- 直後の delete が外部キー違反で失敗する＝**既定パターンを一切削除できない**。
  -- 2026-08-18、`post-patterns.db.test.ts` が実際にこれを検出した。
  -- `pattern_id` を呼び出し側が自分で変えているときは触らない（U4 以降の CRUD がこちら）。
  if new.pattern is not null
     and new.pattern is distinct from old.pattern
     and new.pattern_id is not distinct from old.pattern_id then
    select id into new.pattern_id from post_patterns
     where x_account_id = new.x_account_id and seed_key = new.pattern::text;
  end if;
  return new;
end $$;
drop trigger if exists schedule_slots_fill_pattern_id on schedule_slots;
create trigger schedule_slots_fill_pattern_id before insert or update on schedule_slots
  for each row execute function schedule_slots_fill_pattern_id();

create or replace function generation_jobs_fill_pattern_spec() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'post_generation' then return new; end if;
  if new.pattern_id is null and new.pattern is not null then
    select id into new.pattern_id from post_patterns
     where x_account_id = new.x_account_id and seed_key = new.pattern::text;
  end if;
  if new.pattern_spec is null and new.pattern_id is not null then
    new.pattern_spec := pattern_spec_of(new.pattern_id);
  end if;
  -- 導出できないときは null のまま通す（U1 は既存経路を壊さないため。U2 で必須化する）。
  -- **黙って既定パターンを当てはめない**——どの型で生成したのか分からない履歴を作る方が害が大きい。
  return new;
end $$;
drop trigger if exists generation_jobs_fill_pattern_spec on generation_jobs;
create trigger generation_jobs_fill_pattern_spec before insert on generation_jobs
  for each row execute function generation_jobs_fill_pattern_spec();

-- ── 予約に使えないパターンをDBで止める（旧 CHECK schedule_slots_pattern_not_p5 の後継） ──
create or replace function schedule_slots_pattern_usable() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.pattern_id is null then return new; end if;   -- 削除済み＝enabled=false（下のCHECK）
  select name, requires_quote_url into p from post_patterns where id = new.pattern_id;
  if not found then
    raise exception 'post pattern % not found', new.pattern_id using errcode = '23503';
  end if;
  if p.requires_quote_url then
    raise exception 'pattern "%" requires a quote URL and cannot be scheduled', p.name
      using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists schedule_slots_pattern_usable on schedule_slots;
create trigger schedule_slots_pattern_usable before insert or update on schedule_slots
  for each row execute function schedule_slots_pattern_usable();

-- ── 削除時に参照を切り離す（archived_at を持たずに済ませる本体） ──
-- 予約は**設定を残したまま停止**する（曜日・時刻・テーマ・追加指示を黙って破棄しない）。
create or replace function post_patterns_detach_references() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update schedule_slots set pattern_id = null, enabled = false where pattern_id = old.id;
  update drafts           set pattern_id = null where pattern_id = old.id;
  update generation_jobs  set pattern_id = null where pattern_id = old.id;
  return old;
end $$;
drop trigger if exists post_patterns_detach_references on post_patterns;
create trigger post_patterns_detach_references before delete on post_patterns
  for each row execute function post_patterns_detach_references();

-- ── 制約（backfill後に効かせる） ──────────────────────────
alter table drafts alter column pattern_name set not null;
alter table drafts alter column max_posts    set not null;
do $$ begin
  alter table drafts add constraint drafts_pattern_fk
    foreign key (x_account_id, pattern_id) references post_patterns (x_account_id, id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table schedule_slots add constraint schedule_slots_pattern_fk
    foreign key (x_account_id, pattern_id) references post_patterns (x_account_id, id);
exception when duplicate_object then null; end $$;
do $$ begin
  -- 動いている予約は必ずパターンを持つ（原則1: 動いているのに型が無い状態を作らない）
  alter table schedule_slots add constraint schedule_slots_pattern_required
    check (not enabled or pattern_id is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table generation_jobs add constraint generation_jobs_pattern_fk
    foreign key (x_account_id, pattern_id) references post_patterns (x_account_id, id);
exception when duplicate_object then null; end $$;
-- **`generation_jobs.pattern_spec` はここでは必須化しない。**
-- `pattern` を持たない post_generation の挿入が既存経路に実在する（scheduler-tick の取り残し回収など）。
-- U1 の契約は「アプリを1行も変えない」なので、今 必須化すると既存の34件が落ちる。
-- **U2（生成が pattern_spec を実際に読む単位）で、常に spec を積む enqueue へ変えたうえで
-- `check (kind <> 'post_generation' or pattern_spec is not null)` を追加する。**

create index if not exists drafts_pattern_idx          on drafts (pattern_id);
create index if not exists schedule_slots_pattern_idx  on schedule_slots (pattern_id);
create index if not exists generation_jobs_pattern_idx on generation_jobs (pattern_id);
