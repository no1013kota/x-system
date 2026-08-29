-- 要件02 §3.22 prompt_presets 新設（T-M8-332・運営者の指示 2026-08-27）。
--
-- **アカウント.md と画像生成プロンプトを「1つだけ」から「複数持って選ぶ」へ。**
-- 投稿作成プロンプト（post_patterns）は既に複数持てるのに、この2つは1つしか持てず、
-- 別の書き方を試すには上書きするしかなかった（前の内容は履歴からしか戻せない）。
--
-- **生成が読む場所は変えない。** アカウント.mdは `x_accounts.base_md`、画像は
-- `prompt_templates`（x_account_id, kind='image'）のまま。ここは**人が育てる本棚**で、
-- 「使用中」の1件をその置き場へ写す。読む側を一切変えないので、
-- 生成・学習・画像のどの経路にも新しい失敗の種を作らない。

create table if not exists prompt_presets (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete cascade,
  -- base_md = アカウント.md / image = 画像生成プロンプト
  kind text not null,
  -- 画面に出る唯一の名前（post_patterns と同じ考え方）
  name text not null,
  content text not null,
  -- **使用中は kind ごとに1件だけ**（下の部分unique）。実際に生成が読む置き場への写し元
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint prompt_presets_kind_valid check (kind in ('base_md', 'image')),
  constraint prompt_presets_name_len check (char_length(name) between 1 and 30),
  -- 名前は画面の見出しに出る。改行・タグ文字は入れさせない（post_patterns と同じ）
  constraint prompt_presets_name_safe check (name !~ '[\n\r<>]'),
  -- 上限は各編集画面の保存上限と同じ（貼れる長さと保存できる長さを一致させる）
  constraint prompt_presets_content_len check (
    char_length(content) between 1 and case when kind = 'base_md' then 5000 else 8000 end
  )
);

-- 同じ区分の中で名前は重複させない（画面で見分けられなくなる）
create unique index if not exists prompt_presets_account_kind_name_key
  on prompt_presets (x_account_id, kind, lower(name));
-- **使用中は区分ごとに必ず1件以下**。2件になると「どちらが効いているか」が説明できない
create unique index if not exists prompt_presets_default_key
  on prompt_presets (x_account_id, kind) where is_default;
create index if not exists prompt_presets_account_kind_idx
  on prompt_presets (x_account_id, kind, created_at);

drop trigger if exists prompt_presets_set_updated_at on prompt_presets;
create trigger prompt_presets_set_updated_at before update on prompt_presets
  for each row execute function set_updated_at();

alter table prompt_presets enable row level security;
-- RLSは残す（将来 grant を付けたときに他人の行が見えない形を先に決めておく）が、
-- **`authenticated` へは grant しない**（T-M8-252）。ブラウザ（PostgREST）から読める範囲は
-- 実際に使う分だけにする方針で、この表はアプリが service_role でだけ読む。
drop policy if exists prompt_presets_select_own on prompt_presets;
create policy prompt_presets_select_own on prompt_presets
  for select to authenticated using (auth_owns_x_account(x_account_id));
revoke all on prompt_presets from anon, authenticated;
grant all on prompt_presets to service_role;       -- 既定権限に頼らず明示（20260726000002の反省）

-- ── いま使っている内容を「使用中」の1件目として取り込む ──────────────
-- 取り込まないと、この画面を開いた瞬間に本棚が空で「いま何が効いているのか」が消える。
insert into prompt_presets (x_account_id, kind, name, content, is_default)
select id, 'base_md', '既定', base_md, true
  from x_accounts
 where base_md_version >= 1 and char_length(base_md) between 1 and 5000
on conflict do nothing;

insert into prompt_presets (x_account_id, kind, name, content, is_default)
select x_account_id, 'image', '既定', content, true
  from prompt_templates
 where x_account_id is not null and kind = 'image'
   and char_length(content) between 1 and 8000
on conflict do nothing;
