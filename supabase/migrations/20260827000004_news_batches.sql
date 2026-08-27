-- 要件02 §3.30 news_batches 新設（T-M8-338・運営者の指示 2026-08-27）。
--
-- ニュース取得を **Message Batches API**（トークン半額・結果は非同期）で回すため、
-- 「投げた」と「取り込んだ」の間の状態を持つ表。
--
-- **これが無いと「なぜニュースが来ないのか」が誰にも分からない。** 同期実行なら
-- その場で成否が決まるが、非同期では「AI側で処理中」「24時間で失効した」という
-- 中間状態が生まれる。運営者が状態確認（doctor）で追えるように行として残す（原則1・原則2）。

create table if not exists news_batches (
  id uuid primary key default gen_random_uuid(),
  -- provider側のバッチID（`msgbatch_...`）。取り込みのときに引く
  provider_batch_id text not null unique,
  -- 対象の時間窓（`cron_runs` と同じ `YYYY-MM-DDTHH`・UTC）。1窓につき1バッチ
  window_key text not null unique,
  -- このバッチへ入れた分野（custom_id と対）。取り込み時に「何が返ってこなかったか」を出せる
  categories text[] not null,
  -- 投げたときの取得窓（時間）。**取り込み時に計算し直さない**——取り込みは任意の時刻に走るので、
  -- そのときのJST時刻から窓を導くと、投げたときと違う基準で記事を選別してしまう
  lookback_hours smallint not null,
  -- 投げたときのモデル。**原価台帳の単価はこれで決まる**ので取り込み時に推測しない
  model text not null,
  -- pending  = 投げた（AI側で処理中）
  -- collected = 結果を取り込んで news_items / news_fetch_outcomes へ反映済み
  -- expired  = 24時間の期限切れ。**課金されない**が、その回のニュースは無い
  -- failed   = バッチ自体を作れなかった／取り込みで落ちた
  status text not null default 'pending',
  submitted_at timestamptz not null default now(),
  collected_at timestamptz,
  -- 取り込みで分かった失敗の短い識別子（画面・応答へ出してよい範囲）
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint news_batches_status_valid
    check (status in ('pending', 'collected', 'expired', 'failed'))
);

-- 取り込みcronは「まだ取り込んでいないもの」を古い順に引く
create index if not exists news_batches_pending_idx
  on news_batches (submitted_at) where status = 'pending';

drop trigger if exists news_batches_set_updated_at on news_batches;
create trigger news_batches_set_updated_at before update on news_batches
  for each row execute function set_updated_at();

alter table news_batches enable row level security;
-- 運営だけが見る表（利用者の画面には出ない）。`authenticated` へは grant しない（T-M8-252）。
revoke all on news_batches from anon, authenticated;
grant all on news_batches to service_role;
