-- T-M8-422: 原価台帳に「誰が払うか」（payer）を持つ（要件02 §3.17）。
--
-- 台帳は BYOK（スタンダード＝利用者のAPIキー・利用者自身のXアプリ）の呼び出しも記録するが、
-- 列が無かったため /admin の「今月の原価」「粗利」「原価内訳」「原価/日」に利用者負担の費用が
-- 混ざり、BYOK 利用者が増えるほど赤字に見えた（PRD §6.1 の「原価」は運営キーの費用）。
-- 書き込み側（api-usage-ledger.ts）が記録時点のプラン／auth_type から決める。

alter table external_api_usage_events
  add column payer text not null default 'operator';

alter table external_api_usage_events
  add constraint external_api_usage_payer_valid check (payer in ('operator', 'user'));

comment on column external_api_usage_events.payer is
  '誰の負担か。operator=運営キー／運営のXアプリ、user=利用者のAPIキー（BYOK）／利用者自身のXアプリ';

-- 既存行の近似バックフィル（記録時点のプランは残っていないので、いまのプラン／auth_type で判定する）。
-- X: 利用者自身のXアプリ（auth_type=byok）は利用者負担。
update external_api_usage_events e
   set payer = 'user'
  from x_accounts xa
 where e.provider = 'x'
   and xa.id = e.x_account_id
   and xa.auth_type = 'byok';

-- AI: 利用枠を持たないプラン（スタンダード）は利用者のAPIキー。plans.ts の isOperatorManagedPlan と同じ判定
-- （運営キー同梱＝premium/expert）。plan が null の行は運営負担のまま（小さく見せない側に倒す）。
update external_api_usage_events e
   set payer = 'user'
  from profiles p
 where e.provider <> 'x'
   and p.id = e.user_id
   and p.plan = 'standard';

create index external_api_usage_events_payer_occurred_idx
  on external_api_usage_events (payer, occurred_at desc);
