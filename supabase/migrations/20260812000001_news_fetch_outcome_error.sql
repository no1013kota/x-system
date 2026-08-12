-- ニュース取得の失敗理由を残せるようにする（T-M8-86）。
--
-- 2026-08-11 に「AIの出力が検証に通らなかったとき、providerが何を返したかを残す」を
-- 生成・学習・画像・提案の4経路へ入れたが、**ニュース取得だけ入れられなかった**。
-- `news_fetch` は `generation_jobs` を持たないため error jsonb が無く、この表にも
-- 理由テキストの列が無かった。結果、ニュースの失敗は「何件落ちたか」までしか分からず、
-- 原因を辿る手段が Sentry しかない（応答本文を Sentry へ送るのは要件01 §8 に反するため送れない）。
--
-- `drop_reasons` へ混ぜる案は採らない。値の型が `Record<string, number>` として
-- 9箇所に固定されており（news-research / news-fetch / diagnostics / daily-summary / news-outcome）、
-- 文字列を混ぜると全経路の型と判定を広げることになる。
--
-- 既存テーブルへの列追加なので GRANT の追加は不要
-- （20260726000002_grant_service_role.sql がテーブル単位の grant と default privileges を入れている）。
-- 保持も既存の ran_at 40日 cleanup がそのまま効く。

alter table news_fetch_outcomes
  add column error_code text,
  add column provider_raw_error text;

comment on column news_fetch_outcomes.error_code is
  '失敗の種別を表す短く安全な識別子（http_429 / InvalidProviderOutputError 等）。providerの応答本文は入れない。運営者向け状態確認（doctor）に出してよい。';

comment on column news_fetch_outcomes.provider_raw_error is
  'providerが実際に返した内容（検証に落ちた item の中身など）。**画面にもHTTP応答にも出さない**（要件01 §8）。上限と切り詰めは src/lib/ai/raw-error.ts が正本。記録が無ければ NULL（「正常な空」と区別する）。';
