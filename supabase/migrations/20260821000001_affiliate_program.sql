-- T-M8-174: 招待プログラム（正本: docs/cp/invite_cp.md・運営者の指示 2026-08-21）。
--
-- 5テーブル。金額はすべて integer（JPY・税込）。
-- - 報酬率は累計有料招待ユーザー数のランクで決まり、Commission作成時点の率をsnapshotする
-- - 報酬期間は初回有料課金から最大6ヶ月。紹介ユーザーの解約で終了し、再契約でも再開しない
-- - 振込は月末締め・翌月末支払・手数料980円・最低5,000円（手数料はCommissionと会計分離）
-- - 銀行口座はPayout Provider未契約のため口座番号をAES-256-GCMで暗号化保存（要決定D-33。
--   画面は末尾4桁のみ。振込は運営者が手動のため全桁が必要）

create table affiliate_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles (id) on delete cascade,
  code text not null unique,
  status text not null default 'active'
    constraint affiliate_accounts_status check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  affiliate_account_id uuid not null references affiliate_accounts (id) on delete cascade,
  -- 1ユーザーにつき招待者は1人・登録後変更不可（unique + アプリ側は on conflict do nothing）
  referred_user_id uuid not null unique references profiles (id) on delete cascade,
  attributed_at timestamptz not null default now(),
  -- 初回有料課金で開始。ends_at = started_at + 6ヶ月（解約で前倒し終了）
  commission_started_at timestamptz,
  commission_ends_at timestamptz,
  commission_terminated_reason text
    constraint affiliate_attributions_reason
    check (commission_terminated_reason in ('subscription_cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index affiliate_attributions_account_idx
  on affiliate_attributions (affiliate_account_id);

create table affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_account_id uuid not null references affiliate_accounts (id) on delete cascade,
  referred_user_id uuid not null,
  -- Stripe invoice.paid が Source of Truth。リトライwebhookは unique で冪等
  stripe_invoice_id text not null unique,
  eligible_amount integer not null check (eligible_amount >= 0),
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 10000),
  commission_amount integer not null check (commission_amount >= 0),
  status text not null default 'pending'
    constraint affiliate_commissions_status
    check (status in ('pending', 'payable', 'paid', 'reversed', 'held')),
  -- 返金確認期間の経過後に payable へ（tickが昇格させる）
  available_at timestamptz not null,
  -- 月末締めバッチが振込へ束ねたら設定（paid はバッチの支払完了時）
  payout_id uuid,
  created_at timestamptz not null default now()
);
create index affiliate_commissions_account_idx
  on affiliate_commissions (affiliate_account_id, status);

create table affiliate_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  affiliate_account_id uuid not null unique references affiliate_accounts (id) on delete cascade,
  provider text not null default 'internal',
  external_account_id text,
  bank_name text not null,
  branch_name text not null,
  account_type text not null default 'ordinary'
    constraint affiliate_payout_accounts_type check (account_type in ('ordinary', 'checking')),
  -- 全桁はAES-256-GCM暗号文のみ（要決定D-33）。平文カラムは作らない
  account_number_ciphertext text not null,
  bank_account_last4 text not null check (char_length(bank_account_last4) = 4),
  account_holder_name text not null,
  status text not null default 'active'
    constraint affiliate_payout_accounts_status check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_account_id uuid not null references affiliate_accounts (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  gross_amount integer not null check (gross_amount >= 0),
  fee_amount integer not null check (fee_amount >= 0),
  net_amount integer not null check (net_amount >= 0),
  status text not null default 'created'
    constraint affiliate_payouts_status check (status in ('created', 'paid', 'canceled')),
  payment_due_at timestamptz not null,
  paid_at timestamptz,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 同じ締め期間の二重作成を止める（月次バッチの冪等性）
  unique (affiliate_account_id, period_start)
);

alter table affiliate_commissions
  add constraint affiliate_commissions_payout_fk
  foreign key (payout_id) references affiliate_payouts (id) on delete set null;

-- RLS: 利用者は自分の行だけ読める。書き込みはServer（service_role）のみ。
alter table affiliate_accounts enable row level security;
create policy affiliate_accounts_select_own on affiliate_accounts
  for select using (user_id = auth.uid());
grant select on affiliate_accounts to authenticated;

alter table affiliate_attributions enable row level security;
create policy affiliate_attributions_select_own on affiliate_attributions
  for select using (
    affiliate_account_id in (select id from affiliate_accounts where user_id = auth.uid())
  );
grant select on affiliate_attributions to authenticated;

alter table affiliate_commissions enable row level security;
create policy affiliate_commissions_select_own on affiliate_commissions
  for select using (
    affiliate_account_id in (select id from affiliate_accounts where user_id = auth.uid())
  );
grant select on affiliate_commissions to authenticated;

alter table affiliate_payout_accounts enable row level security;
create policy affiliate_payout_accounts_select_own on affiliate_payout_accounts
  for select using (
    affiliate_account_id in (select id from affiliate_accounts where user_id = auth.uid())
  );
grant select on affiliate_payout_accounts to authenticated;

alter table affiliate_payouts enable row level security;
create policy affiliate_payouts_select_own on affiliate_payouts
  for select using (
    affiliate_account_id in (select id from affiliate_accounts where user_id = auth.uid())
  );
grant select on affiliate_payouts to authenticated;

-- Server側（service_role）はRLSをbypassするが、GRANTは明示する（/verify-integrationの検査対象）。
grant select, insert, update, delete on affiliate_accounts,
  affiliate_attributions, affiliate_commissions,
  affiliate_payout_accounts, affiliate_payouts to service_role;
