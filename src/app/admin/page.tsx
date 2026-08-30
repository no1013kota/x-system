import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card, CardTitle, pageTitleClassName } from "@/components/ui/card";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { pooledQueryable } from "@/lib/db/pool";
import { env } from "@/lib/env";
import {
  JPY_PER_USD,
  readAdminSummary,
  readEntryFunnel,
  readFunnel,
  readHomeVisitorSeries,
  readKpiSeries,
  readMonthCostBreakdown,
  readRecentCancellations,
  readUsersOverview,
} from "@/lib/ops/kpi";

import { KpiChart } from "./kpi-chart";

/**
 * 運営ダッシュボード（T-M8-373・運営者の指示 2026-08-29）。
 *
 * **運営者だけが見る画面**。ログイン済みかつメールが `SUPPORT_EMAIL`（運営者自身）と
 * 一致する利用者にだけ出し、それ以外には**存在ごと隠す**（404。「権限がありません」を
 * 出すと管理画面のURLが当たりだと教えることになる）。
 *
 * 個人開発者向けの最小構成: サマリカード＋ファネル＋時系列3本＋原価内訳＋解約アンケート。
 * 数字の出どころは `src/lib/ops/kpi.ts`（時系列は kpi_daily、それ以外は生データ）。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: `運営ダッシュボード | ${APP_NAME}` };

const SERIES_DAYS = 400;

/**
 * 環境ごとのダッシュボード（T-M8-374・運営者の指示 2026-08-30）。
 *
 * **環境のDBは分離されている**（stgの検証データが本番へ混ざらないための構成・deployment.md）。
 * 1画面から3環境を横断して読むには本番へstgのDB鍵を置くことになるため、
 * **各環境の /admin へ移動する**形にする。表示中の環境は APP_ENV で判定する。
 * URLの正本は deployment.md（STAGING_BASE_URL / PRODUCTION_BASE_URL の値と同じ）。
 */
const ENV_DASHBOARDS = [
  { env: "production", label: "本番", href: "https://exosai.net/admin" },
  { env: "preview", label: "staging", href: "https://x-system-stg.vercel.app/admin" },
  { env: "development", label: "ローカル", href: "http://127.0.0.1:3000/admin" },
] as const;

function yen(v: number): string {
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

function usd(v: number): string {
  return `$${v.toFixed(2)}`;
}

function SummaryCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="min-w-0 px-5 py-4">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-1 text-[22px] font-bold tracking-tight text-ink break-words">{value}</p>
      {note ? <p className="mt-1 text-xs text-ink-2">{note}</p> : null}
    </Card>
  );
}

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const operator = env.SUPPORT_EMAIL;
  if (!operator || (user.email ?? "").toLowerCase() !== operator.toLowerCase()) notFound();

  const db = pooledQueryable();
  const [
    summary,
    funnel,
    mrrSeries,
    usersSeries,
    costSeries,
    byProvider,
    byOperation,
    byUser,
    cancels,
    users,
    entryFunnel,
    homeVisitors,
  ] = await Promise.all([
    readAdminSummary(db),
    readFunnel(db),
    readKpiSeries(db, "mrr_jpy", SERIES_DAYS),
    readKpiSeries(db, "users_total", SERIES_DAYS),
    readKpiSeries(db, "cost_usd", SERIES_DAYS),
    readMonthCostBreakdown(db, "provider", 6),
    readMonthCostBreakdown(db, "operation", 8),
    readMonthCostBreakdown(db, "user", 5),
    readRecentCancellations(db, 10),
    readUsersOverview(db, 200),
    readEntryFunnel(db),
    readHomeVisitorSeries(db, SERIES_DAYS),
  ]);

  const costSeriesJpy = costSeries.map((p) => ({ ...p, value: p.value * JPY_PER_USD }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={pageTitleClassName}>運営ダッシュボード</h1>
          {/* いまどの環境のデータを見ているか（DBは環境ごとに分離されている）。 */}
          <nav aria-label="環境の切替" className="flex items-center gap-1">
            {ENV_DASHBOARDS.map((d) =>
              d.env === env.APP_ENV ? (
                <span
                  key={d.env}
                  aria-current="page"
                  className="rounded-md bg-ink px-2 py-1 text-xs font-bold text-surface"
                >
                  {d.label}
                </span>
              ) : (
                <a
                  key={d.env}
                  className="rounded-md px-2 py-1 text-xs text-ink-2 underline hover:text-ink"
                  href={d.href}
                >
                  {d.label}
                </a>
              ),
            )}
          </nav>
        </div>
        <Link className="text-sm text-ink-2 underline hover:text-ink" href="/app">
          アプリへ戻る
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-2">
        円換算は1ドル={JPY_PER_USD}円（PRDの事業計画と同じ仮定）。時系列は日次スナップショット（400日保持）。
      </p>

      {/* 今月のサマリ */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <SummaryCard label="MRR（月間経常収益）" value={yen(summary.mrrJpy)} note={`課金中 ${summary.paying}人`} />
        <SummaryCard
          label="今月の原価（AI・X API）"
          value={yen(summary.monthCostJpy)}
          note={usd(summary.monthCostUsd)}
        />
        <SummaryCard
          label="今月の粗利（MRR−原価）"
          value={yen(summary.grossProfitJpy)}
          note={summary.grossProfitJpy < 0 ? "原価がMRRを上回っています" : undefined}
        />
        <SummaryCard label="トライアル中" value={`${summary.trialing}人`} />
        <SummaryCard label="登録者（累計）" value={`${summary.usersTotal}人`} />
      </div>

      {/* 入口ファネル（未ログイン含む・直近30日） */}
      <Card as="section" className="mt-6 px-5 py-4">
        <CardTitle as="h2">入口ファネル（直近30日・未ログイン含む）</CardTitle>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-2">
                <th className="py-1 pr-3 font-normal">ページ</th>
                <th className="py-1 pr-3 font-normal text-right">表示回数</th>
                <th className="py-1 pr-3 font-normal text-right">ユニーク（日次合計）</th>
                <th className="py-1 font-normal">前段からの通過率</th>
              </tr>
            </thead>
            <tbody>
              {entryFunnel.map((stage, i) => {
                const prev = i === 0 ? null : entryFunnel[i - 1].uniqueVisitorDays;
                const raw =
                  prev == null || prev === 0
                    ? null
                    : Math.round((stage.uniqueVisitorDays / prev) * 100);
                const rate = raw != null && raw > 100 ? null : raw;
                return (
                  <tr key={stage.path} className="border-t border-hairline">
                    <td className="py-2 pr-3">
                      {stage.label}
                      <span className="ml-1 text-xs text-ink-2">{stage.path}</span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{stage.views}</td>
                    <td className="py-2 pr-3 text-right font-mono">{stage.uniqueVisitorDays}</td>
                    <td className="py-2 text-ink-2">{rate == null ? "—" : `${rate}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-2">
          訪問者はCookieなし・日替わりハッシュで数えるため、ユニークは「日ごとのユニークの合計」です
          （同じ人が別の日に来ると複数回数えます）。botとページ先読みは除外。
        </p>
      </Card>

      {/* ファネル */}
      <Card as="section" className="mt-6 px-5 py-4">
        <CardTitle as="h2">ファネル（いまいる利用者の到達段階）</CardTitle>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-2">
                <th className="py-1 pr-3 font-normal">段階</th>
                <th className="py-1 pr-3 font-normal">人数</th>
                <th className="py-1 font-normal">前段からの通過率</th>
              </tr>
            </thead>
            <tbody>
              {funnel.map((stage, i) => {
                const prev = i === 0 ? null : funnel[i - 1].count;
                // 100%超は出さない（前段より多い＝データの都合で順序が崩れている。
                // テストDBやX連携2アカウント持ちで起き得る。異常な率を出すより無表示が正直）。
                const raw =
                  prev == null ? null : prev === 0 ? null : Math.round((stage.count / prev) * 100);
                const rate = raw != null && raw > 100 ? null : raw;
                return (
                  <tr key={stage.label} className="border-t border-hairline">
                    <td className="py-2 pr-3">{stage.label}</td>
                    <td className="py-2 pr-3 font-bold">{stage.count}人</td>
                    <td className="py-2 text-ink-2">{rate == null ? "—" : `${rate}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-2">
          退会した利用者は元データごと消えるため、累計ではなく「いま残っている人」の数です。
        </p>
      </Card>

      {/* 時系列 */}
      <Card as="section" className="mt-6 space-y-8 px-5 py-4">
        <KpiChart points={mrrSeries} title="MRRの推移" unit="円" />
        <KpiChart points={homeVisitors} title="ホーム来訪者／日（ユニーク・今日を含む）" unit="人" />
        <KpiChart points={usersSeries} title="登録者数（累計）の推移" unit="人" />
        <KpiChart points={costSeriesJpy} title="原価／日（円換算）" unit="円" />
      </Card>

      {/* 原価内訳 */}
      <Card as="section" className="mt-6 px-5 py-4">
        <CardTitle as="h2">今月の原価内訳</CardTitle>
        <div className="mt-3 grid gap-6 md:grid-cols-3">
          {(
            [
              ["提供元別", byProvider],
              ["処理別", byOperation],
              ["利用者別（上位5）", byUser],
            ] as const
          ).map(([label, rows]) => (
            <div key={label} className="min-w-0">
              <h3 className="text-sm font-bold text-ink">{label}</h3>
              {rows.length === 0 ? (
                <p className="mt-2 text-sm text-ink-2">今月の原価はまだありません。</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {rows.map((r) => (
                    <li key={r.key} className="flex justify-between gap-2">
                      <span className="min-w-0 break-words text-ink-2">{r.key}</span>
                      <span className="shrink-0 font-mono">{usd(r.usd)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* 利用者一覧 */}
      <Card as="section" className="mt-6 px-5 py-4">
        <CardTitle as="h2">利用者一覧（登録の新しい順・最大200人）</CardTitle>
        {users.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">まだ利用者がいません。</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-2">
                  <th className="py-1 pr-3 font-normal">メール</th>
                  <th className="py-1 pr-3 font-normal">登録日</th>
                  <th className="py-1 pr-3 font-normal">プラン / 状態</th>
                  <th className="py-1 pr-3 font-normal">X連携</th>
                  <th className="py-1 pr-3 font-normal text-right">生成</th>
                  <th className="py-1 pr-3 font-normal text-right">投稿</th>
                  <th className="py-1 pr-3 font-normal text-right">今月の原価</th>
                  <th className="py-1 font-normal">最終利用</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email} className="border-t border-hairline align-top">
                    <td className="max-w-[220px] break-words py-2 pr-3">
                      {u.email}
                      {u.confirmed ? null : (
                        <span className="ml-1 text-xs text-warn-fg">（メール未確認）</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-ink-2">
                      {u.signedUpDate ?? "—"}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {u.plan ?? "未契約"}
                      <span className="text-xs text-ink-2"> / {u.subscriptionStatus ?? "—"}</span>
                    </td>
                    <td className="max-w-[160px] break-words py-2 pr-3">{u.handles ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono">{u.generations}</td>
                    <td className="py-2 pr-3 text-right font-mono">{u.posts}</td>
                    <td className="py-2 pr-3 text-right font-mono">{usd(u.monthCostUsd)}</td>
                    <td className="whitespace-nowrap py-2 text-ink-2">
                      {u.lastUsedAt
                        ? new Intl.DateTimeFormat("ja-JP", {
                            dateStyle: "short",
                            timeZone: "Asia/Tokyo",
                          }).format(new Date(u.lastUsedAt))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-2">
          生成・投稿は累計（利用枠の消費記録から）。原価は今月のAI・X API実費（USD）。
        </p>
      </Card>

      {/* 解約アンケート */}
      <Card as="section" className="mt-6 px-5 py-4">
        <CardTitle as="h2">解約アンケート（直近10件）</CardTitle>
        {cancels.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">まだありません。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {cancels.map((c) => (
              <li key={`${c.createdAt}:${c.reason}`} className="border-t border-hairline pt-2 text-sm">
                <p className="text-xs text-ink-2">
                  {new Intl.DateTimeFormat("ja-JP", {
                    dateStyle: "medium",
                    timeZone: "Asia/Tokyo",
                  }).format(new Date(c.createdAt))}
                  ・{c.plan ?? "プラン不明"}・{c.proceeded ? "解約へ進んだ" : "思いとどまった"}
                </p>
                <p className="mt-0.5 break-words">
                  {c.reason}
                  {c.detail ? ` — ${c.detail}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
