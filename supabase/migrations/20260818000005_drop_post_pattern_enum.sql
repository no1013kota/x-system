-- T-M8-129 U5: 旧 `post_pattern` enum と旧 `pattern` 列を撤去する（ADR-0008 の最終段）。
--
-- U3b でアプリは旧列を1か所も読まなくなり、U4 で利用者がパターンを作れるようになった。
-- 旧列を残すと「どちらが正か」が2つある状態が続き、いずれ片方だけを更新する事故になる。
--
-- **撤去する前に取り残しを確かめる。** `pattern_id` が無い行が残っていたら、
-- それは旧列しか手がかりが無い行なので、消すと**どのパターンで作ったのか永久に分からなくなる**。
-- その場合は例外で止める（黙って進めない・CLAUDE.md 原則1）。

do $$
declare orphan int;
begin
  -- 下書き: 名前の写しがあれば `pattern_id` が無くてもよい（削除されたパターンの履歴）。
  select count(*) into orphan from drafts where pattern_name is null;
  if orphan > 0 then
    raise exception '名前の写しが無い下書きが % 件ある（旧列を消すと型が分からなくなる）', orphan;
  end if;

  -- 生成job: `post_generation` は spec が要る（U2 の CHECK と同じ条件）。
  select count(*) into orphan
    from generation_jobs where kind = 'post_generation' and pattern_spec is null and pattern is not null;
  if orphan > 0 then
    raise exception 'specが無く旧列だけを持つ生成jobが % 件ある', orphan;
  end if;

  -- 予約: 有効な枠は `pattern_id` を持つ（U1 の CHECK）。停止中で両方nullは「選び直し待ち」。
  select count(*) into orphan from schedule_slots where enabled and pattern_id is null;
  if orphan > 0 then
    raise exception '有効なのにパターンが無い予約枠が % 件ある', orphan;
  end if;
end $$;

-- 旧列を読む経路が無いことを前提に落とす。fill トリガも一緒に不要になる。
drop trigger if exists drafts_fill_pattern_snapshot on drafts;
drop trigger if exists schedule_slots_fill_pattern_id on schedule_slots;
drop trigger if exists generation_jobs_fill_pattern_spec on generation_jobs;
drop function if exists schedule_slots_fill_pattern_id();

alter table schedule_slots drop constraint if exists schedule_slots_pattern_not_p5;

alter table drafts          drop column if exists pattern;
alter table schedule_slots  drop column if exists pattern;
alter table generation_jobs drop column if exists pattern;
alter table x_timeline_posts drop column if exists pattern;

drop type if exists post_pattern;

-- **fill トリガは作り直す。** 旧列は無くなったが、
-- 「名前・上限の写しを入れ忘れた下書き」「specの無い生成job」を作らせない役目は残る。
create or replace function drafts_fill_pattern_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
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
  -- 編集上限は実際のポスト数を下回らせない（作った直後に編集できない下書きを作らない）。
  new.max_posts_edit := coalesce(new.max_posts_edit,
    greatest(p.max_posts_edit, new.max_posts, coalesce(jsonb_array_length(new.thread), 1))::smallint);
  new.requires_quote_url := coalesce(new.requires_quote_url, p.requires_quote_url);
  return new;
end $$;

create trigger drafts_fill_pattern_snapshot before insert on drafts
  for each row execute function drafts_fill_pattern_snapshot();

create or replace function generation_jobs_fill_pattern_spec() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'post_generation' then return new; end if;
  if new.pattern_spec is null and new.pattern_id is not null then
    new.pattern_spec := pattern_spec_of(new.pattern_id);
  end if;
  return new;
end $$;

create trigger generation_jobs_fill_pattern_spec before insert on generation_jobs
  for each row execute function generation_jobs_fill_pattern_spec();

comment on column drafts.pattern_name is
  '生成時に写したパターン名。パターンを削除しても履歴の表示が変わらない（要件02 §3.9）';
