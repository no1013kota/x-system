-- T-M8-395: 文末（tone.sentence_style）を自由入力へ。旧enum値を日本語表記へ置換する。
-- （schemaは自由文字列を受けるため、置換しなくても壊れないが、
--   アカウント.mdへ「文末: polite」とそのまま載ってしまうのを防ぐ。）
update x_accounts
   set settings = jsonb_set(
     settings,
     '{tone,sentence_style}',
     case settings->'tone'->>'sentence_style'
       when 'polite' then to_jsonb('です・ます調'::text)
       when 'assertive' then to_jsonb('断定調'::text)
       else settings->'tone'->'sentence_style'
     end)
 where settings is not null
   and settings->'tone' ? 'sentence_style'
   and settings->'tone'->>'sentence_style' in ('polite', 'assertive');

update x_accounts
   set settings_proposal = jsonb_set(
     settings_proposal,
     '{tone,sentence_style}',
     case settings_proposal->'tone'->>'sentence_style'
       when 'polite' then to_jsonb('です・ます調'::text)
       when 'assertive' then to_jsonb('断定調'::text)
       else settings_proposal->'tone'->'sentence_style'
     end)
 where settings_proposal is not null
   and settings_proposal->'tone' ? 'sentence_style'
   and settings_proposal->'tone'->>'sentence_style' in ('polite', 'assertive');
