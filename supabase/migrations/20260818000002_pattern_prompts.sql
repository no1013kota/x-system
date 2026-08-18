-- T-M8-129 U2: 型プロンプトの正本を prompt_templates から post_patterns へ移す（ADR-0008）。
--
-- U1 で `post_patterns` を作ったが、生成はまだ `prompt_templates`（kind=p1〜p6）を読んでいる。
-- 利用者がパターンを追加できるようにすると kind（固定7値）では表せないため、型プロンプトは
-- `post_patterns.prompt` を正本にする。`prompt_templates` は画像プロンプト（kind='image'）専用になる。
--
-- **利用者が保存した上書きを黙って無効にしない。** 先に写して検算し、写せたことを確認してから消す。
-- 冪等（写す条件が `prompt is null` のみ・削除は存在しなければ0件）。

-- 1) アカウント上書き（kind=p1〜p6）を post_patterns.prompt へ写す。
--    `p.prompt is null`（＝まだシステム既定のまま）のときだけ書く。再実行しても上書きしない。
update post_patterns p
   set prompt = t.content, updated_at = now()
  from prompt_templates t
 where t.x_account_id = p.x_account_id
   and t.x_account_id is not null
   and p.seed_key is not null
   and t.kind = p.seed_key
   and p.prompt is null;

-- 2) 検算。写せていない上書きが1件でもあれば止める（黙って進めない）。
--    パターン行が消えている（U4以降に削除された）ケースも取り残しとして数える。
do $$
declare leftover int;
begin
  select count(*) into leftover
    from prompt_templates t
   where t.x_account_id is not null
     and t.kind <> 'image'
     and not exists (
       select 1 from post_patterns p
        where p.x_account_id = t.x_account_id
          and p.seed_key = t.kind
          and p.prompt = t.content);
  if leftover > 0 then
    raise exception '型プロンプトの上書き % 件を post_patterns へ移せていない（手動確認が必要）', leftover;
  end if;
end $$;

-- 3) 写し終えた上書きを消す。正本を2か所に置かない（どちらが効いているか分からなくなる）。
delete from prompt_templates where x_account_id is not null and kind <> 'image';

-- 4) system default 行（x_account_id is null）の型ぶんも消す。
--    `post_patterns.prompt is null` ＝ コード定数 `SYSTEM_DEFAULT_TEMPLATES` を使う、が新しい解決順。
--    行を残すと「コードを直したのに反映されない」経路が復活する（T-M7-37 の再発）。
delete from prompt_templates where x_account_id is null and kind <> 'image';

-- 5) U1 で送った `generation_jobs.pattern_spec` の必須化。
--    まず埋め戻す（`pattern_id` があれば spec を作れる）。
update generation_jobs gj
   set pattern_spec = pattern_spec_of(gj.pattern_id)
 where gj.kind = 'post_generation'
   and gj.pattern_spec is null
   and gj.pattern_id is not null;

-- **`not valid` で入れる。** 過去の行（パターンが特定できないまま終了した古いjob）を
-- 落とすためではなく、**これから作る行**を守るための制約。既存行を弾くと migration 自体が
-- 適用できず、運営者には理由が分からない形で止まる。
do $$ begin
  alter table generation_jobs add constraint generation_jobs_pattern_spec_required
    check (kind <> 'post_generation' or pattern_spec is not null) not valid;
exception when duplicate_object then null; end $$;

-- 6) 予約枠も同じ理由でパターンを必須にできる状態になった（U1で CHECK は入れてある）。
--    ここでは `pattern_id` が埋まっていない有効な枠が無いことだけ確かめる。
do $$
declare orphan int;
begin
  select count(*) into orphan from schedule_slots where enabled and pattern_id is null;
  if orphan > 0 then
    raise exception '有効なのにパターンが無い予約枠が % 件ある', orphan;
  end if;
end $$;
