-- T-M8-132: パターンに「プレースホルダー」を持たせる（運営者の指示・2026-08-18）。
--
-- 利用者がプロンプト内に `{名前}` と書き、投稿作成画面でその値を入力できるようにする。
-- これまで「自分の考え」だけが固定の入力欄（`asks_user_opinion`）だったが、
-- **どんな項目を毎回入れたいかは型ごとに違う**ので、利用者が自分で決められる形にする。
--
-- 形: [{"name": "自分の考え"}, {"name": "対象読者"}]
--   `name` がそのまま `{name}` に対応し、投稿作成画面の入力欄の見出しにもなる。

alter table post_patterns
  add column if not exists placeholders jsonb not null default '[]'::jsonb;

/**
 * プレースホルダーの形を検査する。
 * CHECK にサブクエリは書けないため関数へ切り出す（immutable なので CHECK から呼べる）。
 *
 * **`{` `}` 改行 `<` `>` を名前に許さない。** プロンプトへ差し込む文字列なので、
 * 対応する括弧が壊れたり、プロンプトの構造を壊したりする文字を通さない。
 */
create or replace function post_patterns_placeholders_ok(value jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(value) = 'array'
     and jsonb_array_length(value) <= 10
     and not exists (
       select 1 from jsonb_array_elements(value) e
        where jsonb_typeof(e) <> 'object'
           or jsonb_typeof(e->'name') <> 'string'
           or char_length(e->>'name') = 0
           or char_length(e->>'name') > 20
           or e->>'name' ~ '[{}\n\r<>]'
     );
$$;

do $$ begin
  alter table post_patterns add constraint post_patterns_placeholders_shape
    check (post_patterns_placeholders_ok(placeholders));
exception when duplicate_object then null; end $$;

-- ジョブの snapshot にも含める（実行中に編集されても当時の定義で差し込む）。
create or replace function pattern_spec_of(target uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'seed_key', p.seed_key, 'name', p.name, 'description', p.description,
    'prompt', p.prompt, 'max_posts', p.max_posts, 'max_posts_edit', p.max_posts_edit,
    'web_search_policy', p.web_search_policy, 'web_search_max_uses', p.web_search_max_uses,
    'source_policy', p.source_policy, 'include_news_digest', p.include_news_digest,
    'asks_user_opinion', p.asks_user_opinion, 'requires_quote_url', p.requires_quote_url,
    'placeholders', p.placeholders)
  from post_patterns p where p.id = target;
$$;

comment on column post_patterns.placeholders is
  'プロンプト内の {名前} に差し込む入力の定義。投稿作成画面が入力欄を出す（T-M8-132）';
