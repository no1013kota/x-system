-- T-M8-129 U3b: 旧 `pattern`（enum）列を nullable にする（ADR-0008）。
--
-- 利用者が作ったパターンは `p1`〜`p6` のどれでもない。旧列が NOT NULL のままだと、
-- 自作パターンで下書きや予約を作るときに**嘘の値（例: 'p1'）を書くしかない**。
-- 旧列を読む経路は U3b で無くなる（表示は `pattern_name`、生成は `pattern_spec`）ので、
-- 「旧enumでは表せない」を null で正直に表す。列そのものの撤去は U5。

alter table drafts          alter column pattern drop not null;
alter table schedule_slots  alter column pattern drop not null;

-- 予約は「動いているならパターンを持つ」を `pattern_id` 側で担保している（U1のCHECK）。
-- 旧列側の `p5` 禁止CHECKは null を通すのでそのまま残す（U5で列と一緒に消える）。

comment on column drafts.pattern is
  '旧enum。表示は pattern_name、検証は max_posts/max_posts_edit を使う。自作パターンでは null。U5で撤去';
comment on column schedule_slots.pattern is
  '旧enum。使うパターンは pattern_id。自作パターンでは null。U5で撤去';
comment on column generation_jobs.pattern is
  '旧enum。生成の振る舞いは pattern_spec から決まる。自作パターンでは null。U5で撤去';
