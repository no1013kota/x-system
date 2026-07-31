-- 要件04 §6 / CLAUDE.md 原則1（黙って壊れない）/ T-M7-40:
-- news_fetch の**分野ごとの結果**を残す表。
--
-- これが無いと「0件」の意味を誰も説明できない。2026-07-31 の実行で web3・sns が0件になったが、
-- 「該当ニュースが無かった（正常な空）」のか「取得したが規定を満たさず全件破棄した（失敗による空）」
-- のか区別できなかった。除外理由は `console.warn` にしか出ておらず、運営者はログを読めない
-- （2026-07-28 の T-M7-24 と同じ型の見えなさ）。
--
-- `cron_runs` とは責務が違う。`cron_runs` は「同一窓の受付は高々一度」だけを保証し、本処理の成否は
-- 持たない（ADR-0003）。本表は**業務結果**（分野ごとの取得・保存・除外）を持ち、運営者向けの状態
-- 確認（`npm run doctor` / `GET /api/cron/doctor`）が読む。cron の受付判定には使わない。
--
-- service role 専用（cron/worker と運営者向け診断のみが読み書き）。authenticated へは RLS ポリシー・
-- GRANT を付けない（cron_runs / external_api_usage_events と同方針）。
create table news_fetch_outcomes (
  id uuid primary key default gen_random_uuid(),
  window_key text not null,
  category news_category not null,
  -- 分野の処理が例外で終わらなかったか。false は researchNews が投げた場合（既存ニュースは保持）。
  ok boolean not null,
  -- 契約と新しさの検証を通った件数。
  fetched integer not null default 0,
  -- 重複除外後に実際へ保存した件数。
  saved integer not null default 0,
  -- 規定を満たさず捨てた件数。`fetched = 0 and dropped > 0` が「全件破棄」。
  dropped integer not null default 0,
  -- 未来日時だったため published_at を落として取得時刻扱いへ寄せた件数。
  future_adjusted integer not null default 0,
  -- 除外理由の内訳（例 {"title:too_big": 3}）。運営者向け表示の材料。
  drop_reasons jsonb not null default '{}'::jsonb,
  ran_at timestamptz not null default now(),
  constraint news_fetch_outcomes_window_category_unique unique (window_key, category)
);

-- 直近の結果を引く（診断）／保持cleanup（scheduler_tick）で使う。
create index news_fetch_outcomes_ran_at_idx on news_fetch_outcomes (ran_at desc);

alter table news_fetch_outcomes enable row level security;
