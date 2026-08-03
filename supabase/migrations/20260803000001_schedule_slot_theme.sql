-- スケジュールのスロットに「分野（発信テーマ）」を持たせる（T-M8-28）。
--
-- これまではパターン（P-1〜P-6）だけを選べ、分野はベースmdの発信テーマからAIが毎回選んでいた。
-- 「月曜はAI、木曜は業務改善」のように曜日ごとに分野を決めたい、という要望に応える。
--
-- NULL は「指定なし（従来どおりAIが発信テーマから選ぶ）」。既存のスロットは NULL のままで
-- 挙動が変わらない。値は `src/lib/themes.ts` の THEME_IDS と同じ集合に制限する。

alter table schedule_slots
  add column theme text;

alter table schedule_slots
  add constraint schedule_slots_theme_valid
  check (
    theme is null
    or theme = any (array['ai', 'web3', 'investment', 'business', 'business_ops', 'sns'])
  );

comment on column schedule_slots.theme is
  '発信テーマ（分野）。NULL は指定なし＝ベースmdの発信テーマからAIが選ぶ。値は src/lib/themes.ts の THEME_IDS。';
