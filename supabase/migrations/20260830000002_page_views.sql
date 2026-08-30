-- 公開ページの閲覧記録（T-M8-378・運営者の指示 2026-08-30）。
--
-- ファネルの入口（ホーム→新規登録→料金）が見えないと「登録6人」の分母が分からない。
-- ホーム・新規登録・料金の3ページだけを対象に、日次の表示回数とユニーク訪問を数える。
--
-- **個人を追わない設計**: 訪問者の識別は「日替わりの塩＋IP＋UA」のHMACハッシュだけを保存する。
-- 生のIP・UAは保存せず、Cookieも使わない。塩が日替わりなので日をまたいだ突合はできない
-- （ユニークは「日次ユニーク」）。プライバシーポリシーは通信情報（IP・ブラウザの種類)の
-- 取得を開示済みで、外部のアクセス解析ツールは使わない（第4条と整合）。
--
-- 行は40日で消える（要件04 §14）。日次の集計値は kpi_daily が400日持つ。
create table page_views (
  view_date date not null,
  path text not null,
  visitor_hash text not null,
  views integer not null default 1,
  primary key (view_date, path, visitor_hash)
);

-- 運営だけが見る表。`authenticated` へは grant しない（T-M8-252）。
alter table page_views enable row level security;
revoke all on page_views from anon, authenticated;
grant all on page_views to service_role;
