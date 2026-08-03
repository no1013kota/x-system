-- 分野を必須にし、「その他」を選択肢へ加える（T-M8-29・2026-08-03 ユーザー判断）。
--
-- 直前の migration では NULL=「指定なし」を許していたが、既定のまま押されると
-- 利用者は分野を選んだつもりで選んでいない状態になる。**選ばせるか、明示的に「その他」と
-- 言わせる**方針へ変えた。「その他」は追加指示に分野を書くという意思表示。
--
-- 既存行（NULL）は 'other' へ寄せる。挙動は変わらない（プロンプトへ分野を出さないため）。

alter table schedule_slots
  drop constraint schedule_slots_theme_valid;

update schedule_slots set theme = 'other' where theme is null;

alter table schedule_slots
  alter column theme set not null;

alter table schedule_slots
  add constraint schedule_slots_theme_valid
  check (
    theme = any (array['ai', 'web3', 'investment', 'business', 'business_ops', 'sns', 'other'])
  );

comment on column schedule_slots.theme is
  '分野（発信テーマ）。必須。値は src/lib/post/post-theme.ts の POST_THEME_IDS（テーマ6値＋other）。other は追加指示に分野を書く意思表示で、プロンプトへは分野を出さない。';
