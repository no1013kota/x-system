-- T-M8-130: パターンの設定を「スレッド数」で扱えるようにする（0〜7）。
--
-- 画面は**スレッド数**（メインポストに続く本数。0 なら単発）で見せるが、
-- DBは今までどおり**総ポスト数**（`max_posts`）で持つ。`max_posts` はスレッド配列の
-- 上限としてコード全体で使われており、意味を変えると解釈が全箇所でずれる。
--   画面のスレッド数 = max_posts - 1  →  スレッド数 0〜7 は総ポスト数 1〜8
--
-- そのため総ポスト数の上限を 7 → 8 へ広げる。既存の値（最大6）は影響を受けない。

alter table post_patterns drop constraint if exists post_patterns_max_posts_range;
do $$ begin
  alter table post_patterns add constraint post_patterns_max_posts_range
    check (max_posts between 1 and 8);
exception when duplicate_object then null; end $$;

alter table post_patterns drop constraint if exists post_patterns_edit_limit_range;
do $$ begin
  -- 編集上限は生成上限以上・スレッド全体の上限（8）以下。
  alter table post_patterns add constraint post_patterns_edit_limit_range
    check (max_posts_edit >= max_posts and max_posts_edit between 1 and 8);
exception when duplicate_object then null; end $$;

-- 自作パターンの編集上限の既定（生成上限＋2）も 8 まで許す。
alter table post_patterns alter column max_posts_edit set default 8;

comment on column post_patterns.max_posts is
  '生成時の総ポスト数の上限（1〜8）。画面は「スレッド数」= この値 - 1 で見せる（0=単発）';
