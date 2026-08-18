-- T-M8-135: 予約にも投稿作成と同じ生成入力を持たせる（運営者の指示・2026-08-18）。
--
-- 予約は「毎週この設定で作る」ものなので、投稿作成画面でその都度指定していた
-- **参考URL・プレースホルダーの値・この枠だけのプロンプト**を枠側に保存できないと、
-- 同じことを予約で再現できない（毎回パターン自体を書き換えるしかなくなる）。
--
-- 追加指示（`instructions`）は既にあるので、足りない3つだけを足す。

alter table schedule_slots
  add column if not exists source_url text,
  add column if not exists placeholder_values jsonb not null default '{}'::jsonb,
  add column if not exists prompt_override text;

-- 参考URLは https のみ（投稿作成の zod と同条件・要件02 §3.10）。
alter table schedule_slots drop constraint if exists schedule_slots_source_url_scheme;
do $$ begin
  alter table schedule_slots add constraint schedule_slots_source_url_scheme
    check (source_url is null or source_url ~ '^https://');
exception when duplicate_object then null; end $$;

-- プレースホルダーの値は「名前 → 文字列」のオブジェクト。
-- **配列や入れ子を弾く。** そのままプロンプトへ差し込むので、
-- 想定外の形が入ると差し込み結果が壊れる（`fillPlaceholders` は文字列前提）。
create or replace function schedule_slots_placeholder_values_ok(value jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(value) = 'object'
     and not exists (
       select 1 from jsonb_each(value) e
        where jsonb_typeof(e.value) <> 'string'
           or char_length(e.value #>> '{}') > 2000
     );
$$;

do $$ begin
  alter table schedule_slots add constraint schedule_slots_placeholder_values_shape
    check (schedule_slots_placeholder_values_ok(placeholder_values));
exception when duplicate_object then null; end $$;

-- この枠だけのプロンプト。パターン本体（`post_patterns.prompt`）と同じ上限。
do $$ begin
  alter table schedule_slots add constraint schedule_slots_prompt_override_len
    check (prompt_override is null or char_length(prompt_override) <= 8000);
exception when duplicate_object then null; end $$;

comment on column schedule_slots.source_url is
  'この枠の生成でAIに読ませる参考URL（任意・T-M8-135）';
comment on column schedule_slots.placeholder_values is
  'パターンの {名前} へ差し込む値。キーはプレースホルダー名（T-M8-135）';
comment on column schedule_slots.prompt_override is
  'この枠だけに使う生成プロンプト。null ならパターンのものを使う（T-M8-135）';
